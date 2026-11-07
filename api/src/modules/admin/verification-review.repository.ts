import { query, withTransaction } from '@/db/client'

const IST = `'Asia/Kolkata'`
const TODAY_IST = `(now() AT TIME ZONE ${IST})::date`

export interface ReviewListRow {
  id: string
  driverId: string
  driverName: string | null
  driverPhone: string
  kind: string
  decision: string | null
  decisionReason: string | null
  similarity: number | null
  ocrText: string | null
  priority: number
  reviewState: string
  createdAt: string
}

interface ListRaw {
  id: string; driver_id: string; full_name: string | null; phone: string; kind: string
  decision: string | null; decision_reason: string | null; sim: string | null; ocr_text: string | null
  review_priority: number; review_state: string; created_at: string
}

const LIST_SELECT = `
  SELECT v.id::text, v.driver_id::text, d.full_name, d.phone, v.kind::text, v.decision, v.decision_reason,
         v.match_similarity::text AS sim, v.ocr_text, v.review_priority, v.review_state, v.created_at::text
    FROM driver_verifications v
    JOIN drivers d ON d.id = v.driver_id`

function mapList(r: ListRaw): ReviewListRow {
  return {
    id: r.id, driverId: r.driver_id, driverName: r.full_name, driverPhone: r.phone, kind: r.kind,
    decision: r.decision, decisionReason: r.decision_reason,
    similarity: r.sim == null ? null : Number(r.sim), ocrText: r.ocr_text,
    priority: r.review_priority, reviewState: r.review_state, createdAt: r.created_at,
  }
}

// Fails first, then the least similar, then oldest; a missing similarity (plate, outage) sorts before a low one.
export async function listQueued(limit: number): Promise<ReviewListRow[]> {
  const rows = await query<ListRaw>(
    `${LIST_SELECT}
      WHERE v.review_state = 'queued'
      ORDER BY v.review_priority DESC, v.match_similarity ASC NULLS FIRST, v.created_at ASC
      LIMIT $1`,
    [limit]
  )
  return rows.map(mapList)
}

export async function listResolvedToday(limit: number): Promise<ReviewListRow[]> {
  const rows = await query<ListRaw>(
    `${LIST_SELECT}
      WHERE v.review_state IN ('confirmed_ok', 'confirmed_mismatch')
        AND (v.reviewed_at AT TIME ZONE ${IST})::date = ${TODAY_IST}
      ORDER BY v.reviewed_at DESC
      LIMIT $1`,
    [limit]
  )
  return rows.map(mapList)
}

export interface ReviewCase extends ReviewListRow {
  imageUrl: string
  status: string
  faceQuality: Record<string, number> | null
  registeredPlate: string | null
  referenceUrls: string[]
  history: Array<{ id: string; createdAt: string; decision: string | null; similarity: number | null; reviewState: string; status: string }>
}

export async function getCase(id: bigint): Promise<ReviewCase | null> {
  const rows = await query<ListRaw & { image_url: string; status: string; face_quality: Record<string, number> | null; vehicle_id: string | null; reference_selfie_url: string | null }>(
    `SELECT v.id::text, v.driver_id::text, d.full_name, d.phone, v.kind::text, v.decision, v.decision_reason,
            v.match_similarity::text AS sim, v.ocr_text, v.review_priority, v.review_state, v.created_at::text,
            v.image_url, v.status::text, v.face_quality, v.vehicle_id::text, d.reference_selfie_url
       FROM driver_verifications v JOIN drivers d ON d.id = v.driver_id
      WHERE v.id = $1`,
    [id]
  )
  const r = rows[0]
  if (!r) return null

  const [plate, extras, history] = await Promise.all([
    r.vehicle_id
      ? query<{ number_plate: string }>(`SELECT number_plate FROM driver_vehicles WHERE id = $1`, [r.vehicle_id])
      : Promise.resolve([] as { number_plate: string }[]),
    query<{ image_url: string }>(
      `SELECT image_url FROM driver_face_references WHERE driver_id = $1 ORDER BY created_at DESC, id DESC LIMIT 2`,
      [r.driver_id]
    ),
    query<{ id: string; created_at: string; decision: string | null; sim: string | null; review_state: string; status: string }>(
      `SELECT id::text, created_at::text, decision, match_similarity::text AS sim, review_state, status::text
         FROM driver_verifications WHERE driver_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 10`,
      [r.driver_id, r.kind]
    ),
  ])

  return {
    ...mapList(r),
    imageUrl: r.image_url,
    status: r.status,
    faceQuality: r.face_quality,
    registeredPlate: plate[0]?.number_plate ?? null,
    referenceUrls: [r.reference_selfie_url, ...extras.map((e) => e.image_url)].filter((u): u is string => !!u),
    history: history.map((h) => ({
      id: h.id, createdAt: h.created_at, decision: h.decision,
      similarity: h.sim == null ? null : Number(h.sim), reviewState: h.review_state, status: h.status,
    })),
  }
}

export type ResolveResult =
  | { kind: 'not_found' }
  | { kind: 'already_resolved' }
  | { kind: 'ok'; before: { status: string }; after: { status: string; review_state: string } }

const MAX_EXTRA_REFERENCES = 2

// The state check is part of the UPDATE, so two admins resolving the same case cannot both win.
export async function resolve(params: {
  id: bigint
  adminId: bigint
  outcome: 'ok' | 'mismatch'
  note: string | null
  addReference: boolean
}): Promise<ResolveResult> {
  return withTransaction(async (client) => {
    const cur = await client.query<{ status: string; kind: string; driver_id: string; image_url: string; review_state: string; challenge_id: string | null }>(
      `SELECT status::text, kind::text, driver_id::text, image_url, review_state, challenge_id::text
         FROM driver_verifications WHERE id = $1 FOR UPDATE`,
      [params.id]
    )
    const row = cur.rows[0]
    if (!row) return { kind: 'not_found' } as const
    if (row.review_state !== 'queued') return { kind: 'already_resolved' } as const

    const ok = params.outcome === 'ok'
    // ok on a failed row restores it (the override_* columns record who and why); mismatch fails the row so the
    // driver has to redo the check, which the daily upsert allows.
    const newStatus = ok ? (row.status === 'failed' ? 'passed' : row.status) : 'failed'
    const overriding = ok && row.status === 'failed'
    await client.query(
      `UPDATE driver_verifications
          SET review_state = $2, status = $3::verification_status, reviewed_by = $4, reviewed_at = now(),
              override_by = CASE WHEN $5 THEN $4 ELSE override_by END,
              override_note = CASE WHEN $5 THEN $6 ELSE override_note END,
              overridden_at = CASE WHEN $5 THEN now() ELSE overridden_at END
        WHERE id = $1`,
      [params.id, ok ? 'confirmed_ok' : 'confirmed_mismatch', newStatus, params.adminId, overriding, params.note]
    )

    // A re-check an admin clears is done: the driver can go online (a mismatch leaves it open).
    if (ok && row.challenge_id) {
      await client.query(
        `UPDATE verification_challenges SET status = 'satisfied', satisfied_at = now() WHERE id = $1 AND status = 'open'`,
        [row.challenge_id]
      )
    }
    // Restoring a daily selfie that was failed also clears a re-check left open behind it. A daily row carries no challenge
    // id, so without this the driver would still be refused at go-online. Any other "looks fine" (an old queued row, a
    // borderline one) must not close a re-check it has nothing to do with.
    if (ok && row.kind === 'daily_selfie' && row.status === 'failed') {
      await client.query(
        `UPDATE verification_challenges SET status = 'satisfied', satisfied_at = now() WHERE driver_id = $1 AND status = 'open'`,
        [row.driver_id]
      )
    }
    // A mismatch on a re-check selfie: that challenge was already closed when the photo was accepted, so the driver would
    // otherwise carry on untouched. Open a new one so they must verify again at their next go-online.
    if (!ok && row.kind === 'spot_selfie') {
      await client.query(
        `INSERT INTO verification_challenges (driver_id, reason, trigger_data) VALUES ($1, 'admin', $2::jsonb)
         ON CONFLICT (driver_id) WHERE status = 'open' DO NOTHING`,
        [row.driver_id, JSON.stringify({ fromVerificationId: String(params.id) })]
      )
    }

    if (ok && params.addReference && (row.kind === 'daily_selfie' || row.kind === 'spot_selfie')) {
      await client.query(
        `INSERT INTO driver_face_references (driver_id, image_url, added_by) VALUES ($1, $2, $3)`,
        [row.driver_id, row.image_url, params.adminId]
      )
      // Keep the newest few; the onboarding selfie lives on the driver row and is never replaced.
      await client.query(
        `DELETE FROM driver_face_references
          WHERE driver_id = $1
            AND id NOT IN (SELECT id FROM driver_face_references WHERE driver_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${MAX_EXTRA_REFERENCES})`,
        [row.driver_id]
      )
    }
    return { kind: 'ok', before: { status: row.status }, after: { status: newStatus, review_state: ok ? 'confirmed_ok' : 'confirmed_mismatch' } } as const
  })
}

export interface ReviewStats {
  queued: number
  queuedToday: number
  resolvedToday: number
  histogram: Array<{ day: string; decision: string; count: number }>
}

export async function getStats(): Promise<ReviewStats> {
  const [counts, hist] = await Promise.all([
    query<{ queued: string; queued_today: string; resolved_today: string }>(
      `SELECT count(*) FILTER (WHERE review_state = 'queued')::text AS queued,
              count(*) FILTER (WHERE review_state <> 'none' AND (created_at AT TIME ZONE ${IST})::date = ${TODAY_IST})::text AS queued_today,
              count(*) FILTER (WHERE review_state IN ('confirmed_ok','confirmed_mismatch') AND (reviewed_at AT TIME ZONE ${IST})::date = ${TODAY_IST})::text AS resolved_today
         FROM driver_verifications
        WHERE review_state <> 'none'`
    ),
    query<{ day: string; decision: string; n: string }>(
      `SELECT ((created_at AT TIME ZONE ${IST})::date)::text AS day, decision, count(*)::text AS n
         FROM driver_verifications
        WHERE decision IS NOT NULL AND created_at > now() - interval '14 days'
        GROUP BY 1, 2 ORDER BY 1 DESC, 2`
    ),
  ])
  const c = counts[0]
  return {
    queued: Number(c?.queued ?? 0),
    queuedToday: Number(c?.queued_today ?? 0),
    resolvedToday: Number(c?.resolved_today ?? 0),
    histogram: hist.map((h) => ({ day: h.day, decision: h.decision, count: Number(h.n) })),
  }
}

// ── Open re-checks ────────────────────────────────────────────────────────────

export interface OpenChallengeRow {
  id: string
  driverId: string
  driverName: string | null
  driverPhone: string
  reason: string
  openedAt: string
}

export async function listOpenChallenges(limit: number): Promise<OpenChallengeRow[]> {
  const rows = await query<{ id: string; driver_id: string; full_name: string | null; phone: string; reason: string; opened_at: string }>(
    `SELECT c.id::text, c.driver_id::text, d.full_name, d.phone, c.reason, c.opened_at::text
       FROM verification_challenges c JOIN drivers d ON d.id = c.driver_id
      WHERE c.status = 'open' ORDER BY c.opened_at ASC LIMIT $1`,
    [limit]
  )
  return rows.map((r) => ({ id: r.id, driverId: r.driver_id, driverName: r.full_name, driverPhone: r.phone, reason: r.reason, openedAt: r.opened_at }))
}

export async function waiveChallenge(id: bigint, adminId: bigint): Promise<{ driverId: string } | null> {
  const rows = await query<{ driver_id: string }>(
    `UPDATE verification_challenges SET status = 'waived', waived_by = $2, waived_at = now()
      WHERE id = $1 AND status = 'open' RETURNING driver_id::text`,
    [id, adminId]
  )
  return rows[0] ? { driverId: rows[0].driver_id } : null
}
