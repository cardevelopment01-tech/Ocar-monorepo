import { pool } from '@/db/client'

// ── Rating tag definitions ────────────────────────────────────────

export async function getTagDefinitions(appliesTo?: string) {
  const params: unknown[] = []
  const where = appliesTo
    ? (params.push(appliesTo), `WHERE is_active = true AND (applies_to = $1 OR applies_to = 'both')`)
    : `WHERE is_active = true`
  const res = await pool.query(
    `SELECT id, tag_key, label, sentiment, applies_to, sort_order
     FROM rating_tag_definitions ${where} ORDER BY sort_order`,
    params
  )
  return res.rows
}

// ── Ratings ───────────────────────────────────────────────────────

export async function getRideBasic(rideId: bigint) {
  const res = await pool.query(
    `SELECT id, status, user_id, driver_id FROM rides WHERE id = $1`,
    [rideId]
  )
  return res.rows[0] ?? null
}

export async function ratingExists(rideId: bigint, direction: string) {
  const res = await pool.query(
    `SELECT id FROM ratings WHERE ride_id = $1 AND direction = $2`,
    [rideId, direction]
  )
  return res.rows.length > 0
}

export async function insertRating(data: {
  ride_id:        bigint
  direction:      string
  score:          number
  from_user_id:   bigint | null
  from_driver_id: bigint | null
  to_user_id:     bigint | null
  to_driver_id:   bigint | null
  comment:        string | null
}) {
  const res = await pool.query(
    `INSERT INTO ratings
       (ride_id, direction, score, from_user_id, from_driver_id,
        to_user_id, to_driver_id, comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      data.ride_id, data.direction, data.score,
      data.from_user_id, data.from_driver_id,
      data.to_user_id, data.to_driver_id,
      data.comment,
    ]
  )
  return res.rows[0]
}

export async function insertRatingTags(ratingId: bigint, tagIds: bigint[]) {
  if (tagIds.length === 0) return
  const placeholders = tagIds.map((_, i) => `($1, $${i + 2})`).join(', ')
  await pool.query(
    `INSERT INTO rating_tags (rating_id, tag_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
    [ratingId, ...tagIds]
  )
}

export async function getTopDriverTags(driverId: bigint, limit = 3) {
  const res = await pool.query<{ label: string; count: string }>(
    `SELECT d.label, COUNT(*)::text AS count
     FROM rating_tags rt
     JOIN ratings r ON r.id = rt.rating_id
     JOIN rating_tag_definitions d ON d.id = rt.tag_id
     WHERE r.to_driver_id = $1 AND d.sentiment = 'positive'
     GROUP BY d.label
     ORDER BY COUNT(*) DESC
     LIMIT $2`,
    [driverId, limit]
  )
  return res.rows.map(r => ({ label: r.label, count: Number(r.count) }))
}

export async function updateDriverRatingAvg(driverId: bigint) {
  await pool.query(
    `UPDATE drivers
     SET rating_avg    = COALESCE((SELECT AVG(score)   FROM ratings WHERE to_driver_id = $1), 0),
         total_ratings =          (SELECT COUNT(*)     FROM ratings WHERE to_driver_id = $1),
         updated_at    = now()
     WHERE id = $1`,
    [driverId]
  )
}

export async function updateUserRatingAvg(userId: bigint) {
  await pool.query(
    `UPDATE users
     SET rating_avg    = COALESCE((SELECT AVG(score)   FROM ratings WHERE to_user_id = $1), 0),
         total_ratings =          (SELECT COUNT(*)     FROM ratings WHERE to_user_id = $1),
         updated_at    = now()
     WHERE id = $1`,
    [userId]
  )
}

// ── SOS ───────────────────────────────────────────────────────────

export async function insertSosAlert(data: {
  ride_id:             bigint
  severity:            string
  triggered_by_user:   bigint | null
  triggered_by_driver: bigint | null
  location_lat:        number | null
  location_lng:        number | null
  notes:               string | null
}) {
  const res = await pool.query(
    `INSERT INTO sos_alerts
       (ride_id, severity, triggered_by_user, triggered_by_driver,
        location_lat, location_lng, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      data.ride_id, data.severity,
      data.triggered_by_user, data.triggered_by_driver,
      data.location_lat, data.location_lng,
      data.notes,
    ]
  )
  return res.rows[0]
}

export async function markRideSosTriggered(rideId: bigint) {
  await pool.query(
    `UPDATE rides SET sos_triggered = true, sos_triggered_at = now() WHERE id = $1`,
    [rideId]
  )
}

export async function getSosAlerts(opts: {
  status?: string
  limit:   number
  offset:  number
}) {
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.status !== undefined) {
    params.push(opts.status)
    conditions.push(`sa.status = $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(opts.limit, opts.offset)
  const lp = params.length

  const res = await pool.query(
    `SELECT sa.*,
            r.origin_address, r.destination_address,
            u.name        AS user_name,   u.phone AS user_phone,
            d.full_name   AS driver_name, d.phone AS driver_phone,
            aa.email      AS acknowledged_by_email,
            ra.email      AS resolved_by_email
     FROM sos_alerts sa
     JOIN rides r   ON r.id = sa.ride_id
     LEFT JOIN users   u  ON u.id = sa.triggered_by_user
     LEFT JOIN drivers d  ON d.id = sa.triggered_by_driver
     LEFT JOIN admins  aa ON aa.id = sa.acknowledged_by
     LEFT JOIN admins  ra ON ra.id = sa.resolved_by
     ${where}
     ORDER BY sa.created_at DESC
     LIMIT $${lp - 1} OFFSET $${lp}`,
    params
  )

  const countRes = await pool.query(
    `SELECT COUNT(*) AS total FROM sos_alerts sa ${where}`,
    params.slice(0, -2)
  )

  return {
    alerts: res.rows,
    total: parseInt(countRes.rows[0]?.total ?? '0'),
  }
}

export async function updateSosStatus(
  id:      bigint,
  status:  string,
  adminId: bigint,
  note?:   string
) {
  const cols: string[] = ['status = $2', 'updated_at = now()']
  const params: unknown[] = [id, status]

  if (status === 'acknowledged') {
    cols.push(`acknowledged_by = $${params.length + 1}`, `acknowledged_at = now()`)
    params.push(adminId)
  } else if (status === 'resolved' || status === 'false_alarm') {
    cols.push(
      `resolved_by = $${params.length + 1}`,
      `resolved_at = now()`,
      `resolution_note = $${params.length + 2}`
    )
    params.push(adminId, note ?? null)
  }

  const res = await pool.query(
    `UPDATE sos_alerts SET ${cols.join(', ')} WHERE id = $1 RETURNING *`,
    params
  )
  return res.rows[0] ?? null
}

// ── Disputes ──────────────────────────────────────────────────────

export async function insertDispute(data: {
  ride_id:             bigint
  initiator:           string
  initiated_by_user:   bigint | null
  initiated_by_driver: bigint | null
  type:                string
  description:         string
  priority:            number
  sla_hours:           number
}) {
  const res = await pool.query(
    `INSERT INTO disputes
       (ride_id, initiator, initiated_by_user, initiated_by_driver,
        type, description, priority, sla_hours,
        sla_due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
             now() + make_interval(hours => $9))
     RETURNING *`,
    [
      data.ride_id, data.initiator,
      data.initiated_by_user, data.initiated_by_driver,
      data.type, data.description, data.priority, data.sla_hours,
      data.sla_hours,
    ]
  )
  return res.rows[0]
}

export async function getDisputes(opts: {
  status?:     string
  assignedTo?: bigint
  limit:       number
  offset:      number
}) {
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.status !== undefined) {
    params.push(opts.status)
    conditions.push(`d.status = $${params.length}`)
  }
  if (opts.assignedTo !== undefined) {
    params.push(opts.assignedTo)
    conditions.push(`d.assigned_to = $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(opts.limit, opts.offset)
  const lp = params.length

  const res = await pool.query(
    `SELECT d.*,
            r.origin_address, r.destination_address,
            u.name       AS user_name,   u.phone AS user_phone,
            dr.full_name AS driver_name, dr.phone AS driver_phone,
            a.email      AS assigned_to_email,
            ra.email     AS resolved_by_email
     FROM disputes d
     JOIN rides r    ON r.id   = d.ride_id
     LEFT JOIN users   u  ON u.id   = d.initiated_by_user
     LEFT JOIN drivers dr ON dr.id  = d.initiated_by_driver
     LEFT JOIN admins  a  ON a.id   = d.assigned_to
     LEFT JOIN admins  ra ON ra.id  = d.resolved_by
     ${where}
     ORDER BY d.priority DESC, d.sla_due_at ASC
     LIMIT $${lp - 1} OFFSET $${lp}`,
    params
  )

  const countRes = await pool.query(
    `SELECT COUNT(*) AS total FROM disputes d ${where}`,
    params.slice(0, -2)
  )

  return {
    disputes: res.rows,
    total: parseInt(countRes.rows[0]?.total ?? '0'),
  }
}

export async function getDisputeById(id: bigint) {
  const res = await pool.query(
    `SELECT d.*,
            r.origin_address, r.destination_address,
            ST_Y(r.origin::geometry)      AS origin_lat,
            ST_X(r.origin::geometry)      AS origin_lng,
            ST_Y(r.destination::geometry) AS destination_lat,
            ST_X(r.destination::geometry) AS destination_lng,
            u.name       AS user_name,   u.phone AS user_phone,
            dr.full_name AS driver_name, dr.phone AS driver_phone,
            a.email      AS assigned_to_email
     FROM disputes d
     JOIN rides r    ON r.id   = d.ride_id
     LEFT JOIN users   u  ON u.id   = d.initiated_by_user
     LEFT JOIN drivers dr ON dr.id  = d.initiated_by_driver
     LEFT JOIN admins  a  ON a.id   = d.assigned_to
     WHERE d.id = $1`,
    [id]
  )
  return res.rows[0] ?? null
}

export async function getGpsTrailForRide(rideId: bigint) {
  const res = await pool.query<{
    lat: number
    lng: number
    recorded_at: string
    speed_kmph: number | null
    heading: number | null
  }>(
    `SELECT
       ST_Y(location::geometry)  AS lat,
       ST_X(location::geometry)  AS lng,
       recorded_at,
       speed_kmph::float8 AS speed_kmph,
       heading::float8    AS heading
     FROM gps_tracks
     WHERE ride_id = $1
     ORDER BY recorded_at ASC`,
    [rideId]
  )
  return res.rows
}

export async function getDisputeActions(disputeId: bigint) {
  const res = await pool.query(
    `SELECT da.*, a.email AS admin_email
     FROM dispute_actions da
     JOIN admins a ON a.id = da.admin_id
     WHERE da.dispute_id = $1
     ORDER BY da.created_at ASC`,
    [disputeId]
  )
  return res.rows
}

export async function updateDisputeStatus(
  id:      bigint,
  status:  string,
  adminId: bigint,
  outcome?: string,
  note?:    string
) {
  const cols: string[] = ['status = $2', 'updated_at = now()']
  const params: unknown[] = [id, status]

  if (outcome !== undefined) {
    params.push(outcome)
    cols.push(`outcome = $${params.length}`)
  }
  if (note !== undefined) {
    params.push(note)
    cols.push(`outcome_note = $${params.length}`)
  }
  if (status === 'resolved') {
    params.push(adminId)
    cols.push(`resolved_by = $${params.length}`, `resolved_at = now()`)
  }
  if (status === 'under_review') {
    params.push(adminId)
    cols.push(`assigned_to = $${params.length}`)
  }

  const res = await pool.query(
    `UPDATE disputes SET ${cols.join(', ')} WHERE id = $1 RETURNING *`,
    params
  )
  return res.rows[0] ?? null
}

export async function insertDisputeAction(data: {
  dispute_id:  bigint
  admin_id:    bigint
  action_type: string
  note:        string | null
}) {
  await pool.query(
    `INSERT INTO dispute_actions (dispute_id, admin_id, action_type, note)
     VALUES ($1,$2,$3,$4)`,
    [data.dispute_id, data.admin_id, data.action_type, data.note]
  )
}

export async function getPaymentForRide(rideId: bigint) {
  const res = await pool.query(
    `SELECT id FROM payments WHERE ride_id = $1 LIMIT 1`,
    [rideId]
  )
  return res.rows[0] ?? null
}

export async function insertRefund(data: {
  payment_id:  bigint
  ride_id:     bigint
  dispute_id:  bigint
  amount:      number
  reason:      string
  initiated_by: bigint
}) {
  const res = await pool.query(
    `INSERT INTO refunds
       (payment_id, ride_id, dispute_id, amount, reason, status, initiated_by)
     VALUES ($1,$2,$3,$4,$5,'requested',$6)
     RETURNING *`,
    [
      data.payment_id, data.ride_id, data.dispute_id,
      data.amount, data.reason, data.initiated_by,
    ]
  )
  return res.rows[0]
}
