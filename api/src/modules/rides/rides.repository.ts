import { pool } from '@/db/client'
import type { DriverSession, NearbyDriver, Ride } from './rides.types'

// ── Driver session queries ────────────────────────────────────

export async function getActiveSession(driverId: bigint): Promise<DriverSession | null> {
  const res = await pool.query<DriverSession>(
    `SELECT ds.*, vc.display_name AS category_name
     FROM driver_sessions ds
     JOIN vehicle_categories vc ON vc.id = ds.category_id
     WHERE ds.driver_id = $1
       AND ds.status IN ('online', 'on_trip')`,
    [driverId]
  )
  return res.rows[0] ?? null
}

export async function createSession(data: {
  driverId: bigint
  vehicleId: bigint
  categoryId: bigint
  mode: string
  destinationCityId?: bigint | null
  originLat?: number
  originLng?: number
}) {
  const res = await pool.query(
    `INSERT INTO driver_sessions
       (driver_id, vehicle_id, category_id, mode,
        destination_city_id, origin_lat, origin_lng)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      data.driverId, data.vehicleId, data.categoryId, data.mode,
      data.destinationCityId ?? null,
      data.originLat ?? null,
      data.originLng ?? null,
    ]
  )
  return res.rows[0]
}

export async function endSession(sessionId: bigint, reason: string) {
  await pool.query(
    `UPDATE driver_sessions
     SET status = 'offline',
         went_offline_at = now(),
         offline_reason = $2
     WHERE id = $1`,
    [sessionId, reason]
  )
}

export async function upsertDriverLocation(data: {
  driverId: bigint
  sessionId: bigint
  lat: number
  lng: number
  heading?: number
  speed?: number
  recordedAt: string
  isAvailable: boolean
}) {
  await pool.query(
    `INSERT INTO driver_location_snapshots
       (driver_id, session_id, location,
        heading, speed_kmph, recorded_at, is_available)
     VALUES (
       $1, $2,
       ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography,
       $5, $6, $7, $8
     )
     ON CONFLICT (driver_id) DO UPDATE SET
       session_id   = EXCLUDED.session_id,
       location     = EXCLUDED.location,
       heading      = EXCLUDED.heading,
       speed_kmph   = EXCLUDED.speed_kmph,
       recorded_at  = EXCLUDED.recorded_at,
       is_available = EXCLUDED.is_available,
       updated_at   = now()
     WHERE driver_location_snapshots.recorded_at < EXCLUDED.recorded_at`,
    [
      data.driverId, data.sessionId,
      data.lat, data.lng,
      data.heading ?? null,
      data.speed ?? null,
      data.recordedAt,
      data.isAvailable,
    ]
  )
}

export async function findNearbyDrivers(params: {
  lat: number
  lng: number
  categoryId: bigint
  radiusMetres?: number
  maxDrivers?: number
}): Promise<NearbyDriver[]> {
  const radius = params.radiusMetres ?? 5000
  const max    = params.maxDrivers ?? 5
  const res = await pool.query<NearbyDriver>(
    `SELECT
       dls.driver_id,
       ds.id AS session_id,
       ds.mode,
       ST_Y(dls.location::geometry) AS lat,
       ST_X(dls.location::geometry) AS lng,
       ST_Distance(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography
       ) AS distance_metres
     FROM driver_location_snapshots dls
     JOIN driver_sessions ds ON ds.id = dls.session_id
     WHERE dls.is_available = true
       AND ds.status = 'online'
       AND ds.mode = 'standard'
       AND ds.category_id = $3
       AND ST_DWithin(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         $4
       )
     ORDER BY distance_metres ASC
     LIMIT $5`,
    [params.lat, params.lng, params.categoryId, radius, max]
  )
  return res.rows
}

export async function findReturnCabDrivers(params: {
  pickupLat: number
  pickupLng: number
  dropLat: number
  dropLng: number
  categoryId: bigint
}): Promise<NearbyDriver[]> {
  const res = await pool.query<NearbyDriver>(
    `SELECT
       rcr.driver_id,
       rcr.session_id,
       ds.mode,
       ST_Y(dls.location::geometry) AS lat,
       ST_X(dls.location::geometry) AS lng,
       ST_Distance(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography
       ) AS distance_metres
     FROM return_cab_routes rcr
     JOIN driver_sessions ds ON ds.id = rcr.session_id
     JOIN driver_location_snapshots dls ON dls.driver_id = rcr.driver_id
     WHERE rcr.is_active = true
       AND ds.status = 'online'
       AND ds.category_id = $5
       AND ST_DWithin(
         rcr.corridor,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         rcr.match_radius_metres
       )
       AND ST_DWithin(
         rcr.corridor,
         ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography,
         rcr.match_radius_metres
       )
     ORDER BY distance_metres ASC
     LIMIT 3`,
    [params.pickupLat, params.pickupLng, params.dropLat, params.dropLng, params.categoryId]
  )
  return res.rows
}

// ── Ride queries ─────────────────────────────────────────────

export async function createRide(data: {
  userId: bigint
  categoryId: bigint
  rideType: string
  isReturnCab: boolean
  originLat: number
  originLng: number
  originAddress?: string
  destinationLat?: number | null
  destinationLng?: number | null
  destinationAddress?: string
  originCityId?: bigint
  destinationCityId?: bigint
  rentalPackageId?: bigint
  tripHours?: number
  scheduledFor?: string
}) {
  const res = await pool.query(
    `INSERT INTO rides (
       user_id, category_id, ride_type, is_return_cab,
       origin, destination,
       origin_address, destination_address,
       origin_city_id, destination_city_id,
       rental_package_id, trip_hours, scheduled_for
     ) VALUES (
       $1, $2, $3, $4,
       ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)::geography,
       CASE WHEN $7::float8 IS NOT NULL AND $8::float8 IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography
         ELSE NULL END,
       $9, $10, $11, $12, $13, $14, $15
     )
     RETURNING *`,
    [
      data.userId, data.categoryId, data.rideType, data.isReturnCab,
      data.originLat, data.originLng,
      data.destinationLat ?? null, data.destinationLng ?? null,
      data.originAddress ?? null, data.destinationAddress ?? null,
      data.originCityId ?? null, data.destinationCityId ?? null,
      data.rentalPackageId ?? null,
      data.tripHours ?? null,
      data.scheduledFor ?? null,
    ]
  )
  return res.rows[0]
}

export async function getRideById(rideId: bigint): Promise<Ride | null> {
  const res = await pool.query<Ride>(
    `SELECT
       r.*,
       ST_Y(r.origin::geometry)      AS origin_lat,
       ST_X(r.origin::geometry)      AS origin_lng,
       ST_Y(r.destination::geometry) AS dest_lat,
       ST_X(r.destination::geometry) AS dest_lng,
       u.phone      AS user_phone,
       u.name       AS user_name,
       d.full_name  AS driver_name,
       d.phone      AS driver_phone,
       fs.total_estimated
     FROM rides r
     LEFT JOIN users u           ON u.id = r.user_id
     LEFT JOIN drivers d         ON d.id = r.driver_id
     LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
     WHERE r.id = $1`,
    [rideId]
  )
  return res.rows[0] ?? null
}

export async function updateRideStatus(
  rideId: bigint,
  status: string,
  // Keys must be trusted internal column names — never from user input
  additionalFields?: Record<string, unknown>
) {
  const fields = additionalFields ?? {}
  const setClauses = ['status = $2', 'updated_at = now()']
  const params: unknown[] = [rideId, status]
  let p = 3
  for (const [key, val] of Object.entries(fields)) {
    setClauses.push(`${key} = $${p++}`)
    params.push(val)
  }
  await pool.query(
    `UPDATE rides SET ${setClauses.join(', ')} WHERE id = $1`,
    params
  )
}

export async function logStatusHistory(data: {
  rideId: bigint
  fromStatus: string | null
  toStatus: string
  actor: string
  actorId?: bigint
  note?: string
}) {
  await pool.query(
    `INSERT INTO ride_status_history
       (ride_id, from_status, to_status, actor, actor_id, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      data.rideId,
      data.fromStatus,
      data.toStatus,
      data.actor,
      data.actorId ?? null,
      data.note ?? null,
    ]
  )
}

export async function createRideAssignment(data: {
  rideId: bigint
  driverId: bigint
  sessionId: bigint
  expiresAt: Date
  broadcastRound: number
  driverLat?: number
  driverLng?: number
}) {
  await pool.query(
    `INSERT INTO ride_assignments
       (ride_id, driver_id, session_id, expires_at,
        broadcast_round, driver_lat, driver_lng)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      data.rideId, data.driverId, data.sessionId,
      data.expiresAt, data.broadcastRound,
      data.driverLat ?? null, data.driverLng ?? null,
    ]
  )
}

export async function acceptAssignment(
  rideId: bigint,
  driverId: bigint
): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const rideRes = await client.query(
      `UPDATE rides
       SET status = 'accepted',
           driver_id = $2,
           accepted_at = now()
       WHERE id = $1 AND status = 'requested'
       RETURNING id`,
      [rideId, driverId]
    )

    if (!rideRes.rows.length) {
      await client.query('ROLLBACK')
      return false
    }

    const sessionRes = await client.query(
      `SELECT id FROM driver_sessions
       WHERE driver_id = $1 AND status = 'online'`,
      [driverId]
    )
    const sessionId: bigint | undefined = sessionRes.rows[0]?.id

    await client.query(
      `UPDATE ride_assignments
       SET status = 'cancelled', cancelled_at = now()
       WHERE ride_id = $1 AND driver_id != $2 AND status = 'offered'`,
      [rideId, driverId]
    )

    await client.query(
      `UPDATE ride_assignments
       SET status = 'accepted', responded_at = now()
       WHERE ride_id = $1 AND driver_id = $2`,
      [rideId, driverId]
    )

    if (sessionId) {
      await client.query(
        `UPDATE driver_sessions
         SET status = 'on_trip', went_on_trip_at = now()
         WHERE id = $1`,
        [sessionId]
      )
      await client.query(
        `UPDATE driver_location_snapshots
         SET is_available = false
         WHERE driver_id = $1`,
        [driverId]
      )
    }

    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getUserRideHistory(
  userId: bigint,
  limit: number,
  offset: number
): Promise<{ rows: unknown[]; total: number }> {
  const [dataRes, countRes] = await Promise.all([
    pool.query(
      `SELECT r.id::text, r.status, r.ride_type, r.origin_address, r.destination_address,
              r.requested_at, r.completed_at,
              d.full_name AS driver_name,
              COALESCE(fs.total_final, fs.total_estimated)::text AS fare
       FROM rides r
       LEFT JOIN drivers d         ON d.id = r.driver_id
       LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
       WHERE r.user_id = $1
       ORDER BY r.requested_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM rides WHERE user_id = $1`,
      [userId]
    ),
  ])
  return { rows: dataRes.rows, total: parseInt(countRes.rows[0]!.count, 10) }
}

export async function getDriverTripHistory(
  driverId: bigint,
  limit: number,
  offset: number
): Promise<{ rows: unknown[]; total: number }> {
  const [dataRes, countRes] = await Promise.all([
    pool.query(
      `SELECT r.id::text, r.status, r.ride_type, r.origin_address, r.destination_address,
              r.requested_at, r.started_at, r.completed_at,
              u.name AS user_name,
              COALESCE(fs.total_final, fs.total_estimated)::text AS fare,
              COALESCE(fs.driver_earning, '0')::text AS driver_earning
       FROM rides r
       LEFT JOIN users u           ON u.id = r.user_id
       LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
       WHERE r.driver_id = $1
       ORDER BY r.requested_at DESC
       LIMIT $2 OFFSET $3`,
      [driverId, limit, offset]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM rides WHERE driver_id = $1`,
      [driverId]
    ),
  ])
  return { rows: dataRes.rows, total: parseInt(countRes.rows[0]!.count, 10) }
}
