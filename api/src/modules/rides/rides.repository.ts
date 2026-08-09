import { pool } from '@/db/client'
import type { AssignCandidate, BillingMode, DriverSession, NearbyDriver, Ride, RideStop, StopInput } from './rides.types'
import {
  STALE_REQUESTED_MINUTES,
  STALE_ACCEPTED_HOURS,
  STALE_DRIVER_ARRIVED_HOURS,
  STALE_IN_PROGRESS_CEILING_HOURS,
} from '@/constants/limits'

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

// Which driver categories are eligible to serve a ride booked at rideCategoryId:
// the ride's own category, plus any category that lists it as an accepted
// fallback tier (category_fallback_rules.accepts_category_id = rideCategoryId).
export async function getEligibleDriverCategoryIds(rideCategoryId: bigint): Promise<bigint[]> {
  const res = await pool.query<{ category_id: string }>(
    `SELECT category_id FROM category_fallback_rules WHERE accepts_category_id = $1`,
    [rideCategoryId]
  )
  return [rideCategoryId, ...res.rows.map(r => BigInt(r.category_id))]
}

export async function getCategoryDisplayName(categoryId: bigint): Promise<string | null> {
  const res = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM vehicle_categories WHERE id = $1`,
    [categoryId]
  )
  return res.rows[0]?.display_name ?? null
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
  categoryIds: bigint[]
  radiusMetres?: number
  maxDrivers?: number
  minWalletBalance: number
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
     JOIN drivers d ON d.id = ds.driver_id
     -- INNER join: a driver with no assigned operating city (or an inactive
     -- one) can't have gone online (see goOnline's city gate), so they're
     -- correctly excluded from matching here too — no GPS-based fallback.
     JOIN cities dc ON dc.id = d.city_id AND dc.status = 'active'
     LEFT JOIN driver_wallets dw ON dw.driver_id = ds.driver_id
     LEFT JOIN driver_package_wallets dpw ON dpw.driver_id = ds.driver_id
     WHERE dls.is_available = true
       AND ds.status = 'online'
       AND ds.mode = 'standard'
       AND ds.category_id = ANY($3::bigint[])
       AND (
         (dc.billing_mode = 'commission' AND COALESCE(dw.balance, 0) >= $6 AND NOT COALESCE(dw.is_frozen, false))
         OR
         (dc.billing_mode = 'package' AND COALESCE(dpw.balance, 0) > 0 AND NOT COALESCE(dpw.is_frozen, false))
       )
       AND ST_DWithin(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         $4
       )
     ORDER BY distance_metres ASC
     LIMIT $5`,
    [params.lat, params.lng, params.categoryIds, radius, max, params.minWalletBalance]
  )
  return res.rows
}

export async function findAllNearbyDrivers(params: {
  lat: number
  lng: number
  radiusMetres?: number
}): Promise<Array<{ driver_id: string; lat: number; lng: number; category_id: number }>> {
  const radius = params.radiusMetres ?? 8000
  const res = await pool.query(
    `SELECT
       dls.driver_id::text,
       ST_Y(dls.location::geometry) AS lat,
       ST_X(dls.location::geometry) AS lng,
       ds.category_id::int AS category_id
     FROM driver_location_snapshots dls
     JOIN driver_sessions ds ON ds.id = dls.session_id
     WHERE dls.is_available = true
       AND ds.status = 'online'
       AND ST_DWithin(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         $3
       )
     LIMIT 20`,
    [params.lat, params.lng, radius]
  )
  return res.rows
}

export async function findReturnCabDrivers(params: {
  pickupLat: number
  pickupLng: number
  dropLat: number
  dropLng: number
  categoryIds: bigint[]
  minWalletBalance: number
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
     JOIN drivers d ON d.id = rcr.driver_id
     -- INNER join: see findNearbyDrivers above — no assigned active city means
     -- the driver couldn't have gone online, so they're excluded here too.
     JOIN cities dc ON dc.id = d.city_id AND dc.status = 'active'
     LEFT JOIN driver_wallets dw ON dw.driver_id = rcr.driver_id
     LEFT JOIN driver_package_wallets dpw ON dpw.driver_id = rcr.driver_id
     -- nearest active city to the DROP-OFF point (unrelated to dc above, which
     -- is the driver's fixed billing-mode city). Standard nearest-centroid
     -- city classification, same pattern used at go-online.
     LEFT JOIN LATERAL (
       SELECT c.id AS city_id
       FROM cities c
       WHERE c.status = 'active'
       ORDER BY ST_Distance(
         c.centroid,
         ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography
       ) ASC
       LIMIT 1
     ) drop_city ON true
     WHERE rcr.is_active = true
       AND ds.status = 'online'
       AND ds.category_id = ANY($5::bigint[])
       AND (
         (dc.billing_mode = 'commission' AND COALESCE(dw.balance, 0) >= $6 AND NOT COALESCE(dw.is_frozen, false))
         OR
         (dc.billing_mode = 'package' AND COALESCE(dpw.balance, 0) > 0 AND NOT COALESCE(dpw.is_frozen, false))
       )
       -- Pickup: within match_radius_metres (3km) of the driver's return-trip
       -- START point, not the corridor line — a pickup near the destination end
       -- must NOT pass the pickup check. ponytail: no index on origin point;
       -- return_cab_routes is tiny (online return drivers only, partial-indexed
       -- by is_active) so a seq scan is fine — add a functional GiST index only
       -- if this table ever grows.
       AND ST_DWithin(
         ST_SetSRID(ST_MakePoint(rcr.origin_lng::float8, rcr.origin_lat::float8), 4326)::geography,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         rcr.match_radius_metres
       )
       -- Drop-off: anywhere in the destination city — its nearest active city
       -- centroid must be the route's chosen destination city.
       AND drop_city.city_id = rcr.destination_city_id
     ORDER BY distance_metres ASC
     LIMIT 3`,
    [params.pickupLat, params.pickupLng, params.dropLat, params.dropLng, params.categoryIds, params.minWalletBalance]
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
  returnAt?: string
  status?: string
  paymentChannel?: string
  riderName?: string
  riderPhone?: string
}) {
  const res = await pool.query(
    `INSERT INTO rides (
       user_id, category_id, ride_type, is_return_cab,
       origin, destination,
       origin_address, destination_address,
       origin_city_id, destination_city_id,
       rental_package_id, trip_hours, scheduled_for, return_at,
       payment_channel, status, rider_name, rider_phone
     ) VALUES (
       $1, $2, $3, $4,
       ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)::geography,
       CASE WHEN $7::float8 IS NOT NULL AND $8::float8 IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography
         ELSE NULL END,
       $9, $10, $11, $12, $13, $14, $15, $16, $17, COALESCE($18::ride_status, 'requested'::ride_status), $19, $20
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
      data.returnAt ?? null,
      data.paymentChannel ?? 'cash',
      data.status ?? null,
      data.riderName ?? null,
      data.riderPhone ?? null,
    ]
  )
  return res.rows[0]
}

// ── Ride stops (waypoints) ────────────────────────────────────

// One INSERT per stop inside a transaction, not a single multi-row VALUES —
// this repo has no existing bulk-values helper and the stop count is capped
// at MAX_STOPS_PER_RIDE, so the extra round-trips are negligible.
export async function insertRideStops(
  rideId: bigint,
  stops: Array<StopInput & { chargeApplied: number }>
): Promise<RideStop[]> {
  if (stops.length === 0) return []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const rows: RideStop[] = []
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]!
      const res = await client.query<RideStop>(
        `INSERT INTO ride_stops (ride_id, sequence, location, address, stop_charge_applied)
         VALUES (
           $1, $2,
           ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography,
           $5, $6
         )
         RETURNING id, ride_id, sequence,
           ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
           address, status, arrived_at, reached_at, stop_charge_applied, wait_charge`,
        [rideId, i + 1, stop.lat, stop.lng, stop.address ?? null, stop.chargeApplied]
      )
      rows.push(res.rows[0]!)
    }
    await client.query('COMMIT')
    return rows
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getRideStops(rideId: bigint): Promise<RideStop[]> {
  const res = await pool.query<RideStop>(
    `SELECT id, ride_id, sequence,
       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       address, status, arrived_at, reached_at, stop_charge_applied, wait_charge
     FROM ride_stops
     WHERE ride_id = $1
     ORDER BY sequence ASC`,
    [rideId]
  )
  return res.rows
}

// Inserts one stop onto a ride that already exists (post-booking add), taking
// the next sequence number. Distinct from insertRideStops (pre-booking, bulk,
// caller-supplied sequence via array index) because this must be safe to call
// while other stops already exist and are mid-flight.
export async function appendRideStop(
  rideId: bigint,
  stop: StopInput & { chargeApplied: number }
): Promise<RideStop> {
  const res = await pool.query<RideStop>(
    `INSERT INTO ride_stops (ride_id, sequence, location, address, stop_charge_applied)
     VALUES (
       $1,
       COALESCE((SELECT MAX(sequence) FROM ride_stops WHERE ride_id = $1), 0) + 1,
       ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography,
       $4, $5
     )
     RETURNING id, ride_id, sequence,
       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       address, status, arrived_at, reached_at, stop_charge_applied, wait_charge`,
    [rideId, stop.lat, stop.lng, stop.address ?? null, stop.chargeApplied]
  )
  return res.rows[0]!
}

// Stamp arrival at a stop so wait time can be measured server-side. Idempotent
// (COALESCE) so a re-tap doesn't reset the clock. One-way only in practice —
// the driver app only sends 'arrived' for one-way rides.
export async function markStopArrived(
  rideId: bigint,
  sequence: number
): Promise<RideStop | null> {
  const res = await pool.query<RideStop>(
    `UPDATE ride_stops
     SET arrived_at = COALESCE(arrived_at, now()), updated_at = now()
     WHERE ride_id = $1 AND sequence = $2 AND status = 'pending'
     RETURNING id, ride_id, sequence,
       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       address, status, arrived_at, reached_at, stop_charge_applied, wait_charge`,
    [rideId, sequence]
  )
  return res.rows[0] ?? null
}

export async function markStopStatus(
  rideId: bigint,
  sequence: number,
  status: 'reached' | 'skipped',
  ratePerMin = 0,
  freeMinutes = 0
): Promise<RideStop | null> {
  // wait_charge is derived from server timestamps (now() - arrived_at), never
  // from client-supplied durations. Non-one-way callers pass ratePerMin=0, and
  // their stops never have arrived_at, so wait_charge stays 0 either way.
  const res = await pool.query<RideStop>(
    `UPDATE ride_stops
     SET status = $3::stop_status,
         reached_at = CASE WHEN $3::stop_status = 'reached' THEN now() ELSE reached_at END,
         wait_charge = CASE
           WHEN $3::stop_status = 'reached' AND arrived_at IS NOT NULL
             THEN round(GREATEST(0::numeric, EXTRACT(EPOCH FROM (now() - arrived_at)) / 60.0 - $4::numeric) * $5::numeric, 2)
           ELSE wait_charge END,
         updated_at = now()
     WHERE ride_id = $1 AND sequence = $2 AND status = 'pending'
     RETURNING id, ride_id, sequence,
       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       address, status, arrived_at, reached_at, stop_charge_applied, wait_charge`,
    [rideId, sequence, status, freeMinutes, ratePerMin]
  )
  return res.rows[0] ?? null
}

// The ride's per-minute rate from its frozen snapshot's rate card — used as the
// wait rate for metered stop wait (the per-minute value of the driver's time).
export async function getRideRatePerMin(rideId: bigint): Promise<number> {
  const res = await pool.query<{ rate_per_min: string }>(
    `SELECT rc.rate_per_min
     FROM fare_snapshots fs JOIN rate_cards rc ON rc.id = fs.rate_card_id
     WHERE fs.ride_id = $1`,
    [rideId]
  )
  return parseFloat(res.rows[0]?.rate_per_min ?? '0')
}

// Sum of metered wait charges across a ride's stops, folded into the final fare
// at settlement. 0 for round-trip/rental (their stops never accrue wait_charge).
export async function getStopWaitTotal(rideId: bigint): Promise<number> {
  const res = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(wait_charge), 0)::text AS total FROM ride_stops WHERE ride_id = $1`,
    [rideId]
  )
  return parseFloat(res.rows[0]?.total ?? '0')
}

// Per-status staleness cutoffs so an orphaned ride (broadcast job never ran,
// dev/test session interrupted, etc.) can't get treated as "active" forever
// and trap the user's client on reload. Gated on updated_at, NOT requested_at
// — advance-booking rides sit in 'scheduled' with an old requested_at until
// the dispatch buffer flips them to 'requested' (updateRideStatusCAS bumps
// updated_at at that moment), so requested_at would wrongly look stale for a
// ride that just started broadcasting. Windows are generous vs. real timings:
// requested resolves within ~2min (3 broadcast rounds), in_progress already
// has its own dedicated GPS-heartbeat sweep (cleanup.worker.ts) that force-
// cancels after 30min — this is just a last-resort ceiling for it.
export async function getActiveRideIdForUser(userId: bigint): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM rides
     WHERE user_id = $1
       AND (
         (status = 'requested'      AND updated_at > now() - ($2 || ' minutes')::interval) OR
         (status = 'accepted'       AND updated_at > now() - ($3 || ' hours')::interval)    OR
         (status = 'driver_arrived' AND updated_at > now() - ($4 || ' hours')::interval)    OR
         (status = 'in_progress'    AND updated_at > now() - ($5 || ' hours')::interval)    OR
         (status = 'returning'      AND updated_at > now() - ($5 || ' hours')::interval)
       )
     ORDER BY requested_at DESC
     LIMIT 1`,
    [
      userId,
      STALE_REQUESTED_MINUTES,
      STALE_ACCEPTED_HOURS,
      STALE_DRIVER_ARRIVED_HOURS,
      STALE_IN_PROGRESS_CEILING_HOURS,
    ]
  )
  return res.rows[0]?.id ?? null
}

export async function getActiveRideForDriver(driverId: bigint): Promise<Ride | null> {
  const res = await pool.query<Ride>(
    `SELECT
       r.*,
       ST_Y(r.origin::geometry)      AS origin_lat,
       ST_X(r.origin::geometry)      AS origin_lng,
       ST_Y(r.destination::geometry) AS dest_lat,
       ST_X(r.destination::geometry) AS dest_lng,
       u.phone      AS user_phone,
       u.name       AS user_name,
       u.rating_avg AS user_rating,
       d.full_name  AS driver_name,
       d.phone      AS driver_phone,
       fs.total_estimated
     FROM rides r
     LEFT JOIN users u           ON u.id = r.user_id
     LEFT JOIN drivers d         ON d.id = r.driver_id
     LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
     WHERE r.driver_id = $1
       AND r.status IN ('accepted', 'driver_arrived', 'in_progress', 'returning')
     ORDER BY r.accepted_at DESC
     LIMIT 1`,
    [driverId]
  )
  return res.rows[0] ?? null
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
       u.rating_avg AS user_rating,
       d.full_name  AS driver_name,
       d.phone      AS driver_phone,
       d.rating_avg           AS driver_rating,
       d.reference_selfie_url AS driver_photo,
       fs.total_estimated,
       fs.total_final, fs.base_fare, fs.distance_fare, fs.time_fare, fs.stop_fare,
       fs.hour_surcharge, fs.overage_fare, fs.surge_fare, fs.surge_multiplier,
       fs.actual_km, fs.actual_min,
       rc.reason      AS cancellation_reason,
       rc.reason_code AS cancellation_reason_code,
       ur.score AS user_rating_given,
       dv.number_plate  AS vehicle_number_plate,
       dv.color         AS vehicle_color,
       dv.vehicle_name  AS vehicle_name,
       vm.name          AS vehicle_model,
       vb.name          AS vehicle_brand,
       ST_Y(dls.location::geometry) AS driver_current_lat,
       ST_X(dls.location::geometry) AS driver_current_lng,
       p.status AS payment_status,
       p.commission_percent, p.commission_amount, p.driver_earning
     FROM rides r
     LEFT JOIN users u             ON u.id = r.user_id
     LEFT JOIN drivers d           ON d.id = r.driver_id
     LEFT JOIN fare_snapshots fs   ON fs.ride_id = r.id
     LEFT JOIN ride_cancellations rc ON rc.ride_id = r.id
     LEFT JOIN ratings ur ON ur.ride_id = r.id AND ur.direction = 'user_to_driver'
     LEFT JOIN driver_vehicles dv  ON dv.driver_id = r.driver_id AND dv.is_primary = true AND dv.status != 'blacklisted'
     LEFT JOIN vehicle_models vm   ON vm.id = dv.model_id
     LEFT JOIN vehicle_brands vb   ON vb.id = dv.brand_id
     LEFT JOIN driver_location_snapshots dls ON dls.driver_id = r.driver_id
     LEFT JOIN payments p          ON p.ride_id = r.id
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

// ── Advance booking ───────────────────────────────────────────

// CAS transition — only succeeds if the row is still in `expectedStatus`.
// Returns null (no rows touched) if another caller already moved it on —
// callers must treat null as "lost the race, no-op" rather than an error.
export async function updateRideStatusCAS(
  rideId: bigint,
  expectedStatus: string,
  newStatus: string,
  // Keys must be trusted internal column names — never from user input
  additionalFields?: Record<string, unknown>
): Promise<Ride | null> {
  const fields = additionalFields ?? {}
  const setClauses = ['status = $3', 'updated_at = now()']
  const params: unknown[] = [rideId, expectedStatus, newStatus]
  let p = 4
  for (const [key, val] of Object.entries(fields)) {
    setClauses.push(`${key} = $${p++}`)
    params.push(val)
  }
  const res = await pool.query<Ride>(
    `UPDATE rides SET ${setClauses.join(', ')}
     WHERE id = $1 AND status = $2
     RETURNING *`,
    params
  )
  return res.rows[0] ?? null
}

export interface AdvanceMeta {
  id: string
  ride_id: string
  status: 'pending_driver' | 'driver_confirmed' | 'dispatched' | 'completed' | 'cancelled'
  dispatch_buffer_minutes: number
  dispatch_job_id: string | null
  claimed_by_driver_id: string | null
  claimed_at: string | null
  reminder_24h_sent_at: string | null
  reminder_1h_sent_at: string | null
  rate_card_id_at_booking: string | null
  created_at: string
  updated_at: string
}

export async function createAdvanceMeta(data: {
  rideId: bigint
  dispatchBufferMinutes: number
  rateCardIdAtBooking?: bigint
}) {
  const res = await pool.query<AdvanceMeta>(
    `INSERT INTO ride_advance_meta (ride_id, dispatch_buffer_minutes, rate_card_id_at_booking)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.rideId, data.dispatchBufferMinutes, data.rateCardIdAtBooking ?? null]
  )
  return res.rows[0]
}

export async function getAdvanceMeta(rideId: bigint): Promise<AdvanceMeta | null> {
  const res = await pool.query<AdvanceMeta>(
    `SELECT * FROM ride_advance_meta WHERE ride_id = $1`,
    [rideId]
  )
  return res.rows[0] ?? null
}

export async function setAdvanceMetaJobId(rideId: bigint, jobId: string) {
  await pool.query(
    `UPDATE ride_advance_meta SET dispatch_job_id = $2 WHERE ride_id = $1`,
    [rideId, jobId]
  )
}

export async function updateAdvanceMetaStatus(
  rideId: bigint,
  status: AdvanceMeta['status']
) {
  await pool.query(
    `UPDATE ride_advance_meta SET status = $2 WHERE ride_id = $1`,
    [rideId, status]
  )
}

export interface DueScheduledRide {
  id: string
  user_id: string
  category_id: string
  ride_type: string
  is_return_cab: boolean
  origin_lat: number
  origin_lng: number
  dest_lat: number | null
  dest_lng: number | null
}

// Rows whose scheduled_for has entered their own dispatch buffer window.
// Backs both the delayed BullMQ job (optimization) and the repeatable sweep
// (source of truth) — see docs/ADVANCE_BOOKING_PLAN.md §4.3.
export async function getDueScheduledRides(): Promise<DueScheduledRide[]> {
  const res = await pool.query<DueScheduledRide>(
    `SELECT
       r.id, r.user_id, r.category_id, r.ride_type, r.is_return_cab,
       ST_Y(r.origin::geometry)      AS origin_lat,
       ST_X(r.origin::geometry)      AS origin_lng,
       ST_Y(r.destination::geometry) AS dest_lat,
       ST_X(r.destination::geometry) AS dest_lng
     FROM rides r
     JOIN ride_advance_meta ram ON ram.ride_id = r.id
     WHERE r.status = 'scheduled'
       AND r.scheduled_for IS NOT NULL
       AND r.scheduled_for <= now() + (ram.dispatch_buffer_minutes || ' minutes')::interval`
  )
  return res.rows
}

// ── Stuck ride review (stale driver heartbeat sweeper) ────────

export interface StaleRideRow {
  id: string
  driver_id: string
  review_flagged_at: string | null
}

export async function findStaleInProgressRides(staleSeconds: number): Promise<StaleRideRow[]> {
  const res = await pool.query<StaleRideRow>(
    `SELECT r.id, r.driver_id, r.review_flagged_at
     FROM rides r
     JOIN driver_location_snapshots dls ON dls.driver_id = r.driver_id
     WHERE r.status IN ('in_progress', 'returning')
       AND now() - dls.recorded_at > ($1 || ' seconds')::interval`,
    [staleSeconds]
  )
  return res.rows
}

// Orphaned rides: broadcast job died mid-flight (requested), or the driver
// accepted/arrived and the flow was interrupted before in_progress (crash,
// force-quit, network drop). Neither has a GPS heartbeat to key off, unlike
// the in_progress sweeper above — just how long they've sat in that status.
export async function findStaleRequestedRides(minutes: number): Promise<{ id: string }[]> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM rides
     WHERE status = 'requested'
       AND updated_at < now() - ($1 || ' minutes')::interval`,
    [minutes]
  )
  return res.rows
}

export interface StaleAcceptedOrArrivedRow {
  id: string
  status: 'accepted' | 'driver_arrived'
  driver_id: string
}

export async function findStaleAcceptedOrArrivedRides(
  acceptedHours: number,
  arrivedHours: number
): Promise<StaleAcceptedOrArrivedRow[]> {
  const res = await pool.query<StaleAcceptedOrArrivedRow>(
    `SELECT id, status, driver_id FROM rides
     WHERE (status = 'accepted'       AND updated_at < now() - ($1 || ' hours')::interval)
        OR (status = 'driver_arrived' AND updated_at < now() - ($2 || ' hours')::interval)`,
    [acceptedHours, arrivedHours]
  )
  return res.rows
}

export async function flagRideForReview(rideId: bigint, reason: string) {
  await pool.query(
    `UPDATE rides SET review_flagged_at = now(), review_reason = $2
     WHERE id = $1 AND review_flagged_at IS NULL`,
    [rideId, reason]
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
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (ride_id, driver_id) DO NOTHING`,
    [
      data.rideId, data.driverId, data.sessionId,
      data.expiresAt, data.broadcastRound,
      data.driverLat ?? null, data.driverLng ?? null,
    ]
  )
}

export async function acceptAssignment(
  rideId: bigint,
  driverId: bigint,
  billingMode: BillingMode
): Promise<string[] | false> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const rideRes = await client.query(
      `UPDATE rides
       SET status = 'accepted',
           driver_id = $2,
           accepted_at = now(),
           billing_mode_snapshot = $3
       WHERE id = $1 AND status = 'requested'
       RETURNING id`,
      [rideId, driverId, billingMode]
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

    const cancelRes = await client.query<{ driver_id: string }>(
      `UPDATE ride_assignments
       SET status = 'cancelled', cancelled_at = now()
       WHERE ride_id = $1 AND driver_id != $2 AND status = 'offered'
       RETURNING driver_id::text`,
      [rideId, driverId]
    )
    const cancelledDriverIds = cancelRes.rows.map(r => r.driver_id)

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
    return cancelledDriverIds
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Called when a still-broadcasting ('requested') ride is cancelled — mirrors
// the cleanup acceptAssignment() does for the drivers who lost the accept
// race, so drivers holding an unanswered incoming-request card get told to
// dismiss it instead of waiting out the full broadcast window.
export async function cancelAllAssignments(rideId: bigint): Promise<string[]> {
  const res = await pool.query<{ driver_id: string }>(
    `UPDATE ride_assignments
     SET status = 'cancelled', cancelled_at = now()
     WHERE ride_id = $1 AND status = 'offered'
     RETURNING driver_id::text`,
    [rideId]
  )
  return res.rows.map(r => r.driver_id)
}

export async function getCityBillingMode(cityId: bigint): Promise<BillingMode> {
  const res = await pool.query<{ billing_mode: BillingMode }>(
    `SELECT billing_mode FROM cities WHERE id = $1`,
    [cityId]
  )
  if (!res.rows.length) {
    throw Object.assign(new Error('City not found'), { httpStatus: 404 })
  }
  return res.rows[0]!.billing_mode
}

export async function hasRideGpsActivity(rideId: bigint): Promise<boolean> {
  const res = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM gps_tracks WHERE ride_id = $1) AS exists`,
    [rideId]
  )
  return res.rows[0]?.exists ?? false
}

// Every driver in the ride's city, eligible or not — the admin picker shows
// ineligible drivers greyed out with a reason rather than hiding them.
// Mirrors the same gates findNearbyDrivers() uses for broadcast, minus the
// geo-radius cutoff (admin is intentionally picking outside auto-match range).
export async function getAssignCandidates(params: {
  cityId: bigint
  rideLat: number
  rideLng: number
  categoryIds: bigint[]
  minWalletBalance: number
}): Promise<AssignCandidate[]> {
  const res = await pool.query<Omit<AssignCandidate, 'eligible'>>(
    `SELECT
       d.id::text AS driver_id,
       d.full_name AS driver_name,
       d.phone AS driver_phone,
       ds.id::text AS session_id,
       ds.category_id::text AS category_id,
       vc.display_name AS category_name,
       (ds.id IS NOT NULL AND ds.status = 'online' AND ds.mode = 'standard') AS is_online,
       (ds.category_id = ANY($4::bigint[])) AS category_ok,
       COALESCE(
         (dc.billing_mode = 'commission' AND COALESCE(dw.balance, 0) >= $5 AND NOT COALESCE(dw.is_frozen, false))
         OR
         (dc.billing_mode = 'package' AND COALESCE(dpw.balance, 0) > 0 AND NOT COALESCE(dpw.is_frozen, false)),
         false
       ) AS wallet_ok,
       CASE WHEN dls.location IS NOT NULL THEN
         ST_Distance(
           dls.location,
           ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography
         )
       ELSE NULL END AS distance_metres
     FROM drivers d
     JOIN cities dc ON dc.id = d.city_id AND dc.status = 'active'
     LEFT JOIN driver_sessions ds ON ds.driver_id = d.id AND ds.status = 'online'
     LEFT JOIN driver_location_snapshots dls ON dls.session_id = ds.id
     LEFT JOIN vehicle_categories vc ON vc.id = ds.category_id
     LEFT JOIN driver_wallets dw ON dw.driver_id = d.id
     LEFT JOIN driver_package_wallets dpw ON dpw.driver_id = d.id
     WHERE d.city_id = $1
     ORDER BY distance_metres ASC NULLS LAST, d.full_name ASC
     LIMIT 50`,
    [params.cityId, params.rideLat, params.rideLng, params.categoryIds, params.minWalletBalance]
  )
  return res.rows.map(r => ({ ...r, eligible: r.is_online && r.category_ok && r.wallet_ok }))
}

export async function setForceAssignGraceJob(rideId: bigint, jobId: string): Promise<void> {
  await pool.query(`UPDATE rides SET force_assign_grace_job_id = $2 WHERE id = $1`, [rideId, jobId])
}

export async function clearForceAssignGraceJob(rideId: bigint): Promise<void> {
  await pool.query(`UPDATE rides SET force_assign_grace_job_id = NULL WHERE id = $1`, [rideId])
}

// Reverts a force-assigned ride back to unassigned if the driver never showed
// activity within the grace window. CAS on (driver_id, status='accepted') so
// a ride that already progressed (driver_arrived/in_progress/etc.) is left alone.
export async function revertForceAssign(rideId: bigint, driverId: bigint): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const res = await client.query(
      `UPDATE rides
       SET status = 'requested', driver_id = NULL, accepted_at = NULL,
           force_assign_grace_job_id = NULL, updated_at = now()
       WHERE id = $1 AND driver_id = $2 AND status = 'accepted'
       RETURNING id`,
      [rideId, driverId]
    )

    if (!res.rows.length) {
      await client.query('ROLLBACK')
      return false
    }

    await client.query(
      `UPDATE driver_sessions SET status = 'online' WHERE driver_id = $1 AND status = 'on_trip'`,
      [driverId]
    )
    await client.query(
      `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
      [driverId]
    )

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

export interface FareRecomputeInput {
  category_id:      number
  ride_type:        string
  is_return_cab:    boolean
  estimated_km:     number
  estimated_min:    number
  stop_count:       number
  trip_hours:       number
  rental_package_id: number | null
  origin_city_id:   number | null
  total_estimated:  number
}

export async function getFareRecomputeInput(rideId: bigint): Promise<FareRecomputeInput | null> {
  const res = await pool.query(
    `SELECT r.category_id::int, r.origin_city_id::int,
            fs.ride_type, fs.is_return_cab, fs.estimated_km::float8, fs.estimated_min::float8,
            fs.stop_count::int, fs.trip_hours::float8, fs.rental_package_id::int,
            fs.total_estimated::float8
     FROM fare_snapshots fs
     JOIN rides r ON r.id = fs.ride_id
     WHERE fs.ride_id = $1`,
    [rideId]
  )
  return (res.rows[0] as FareRecomputeInput | undefined) ?? null
}

export async function updateFareSnapshotEstimate(
  rideId: bigint,
  fareEstimate: {
    rate_card_id: number
    surge_event_id: number | null
    surge_multiplier: number
    breakdown: {
      base_fare: number; distance_fare: number; time_fare: number
      stop_fare: number; hour_surcharge: number; surge_fare: number; total: number
    }
  }
): Promise<void> {
  await pool.query(
    `UPDATE fare_snapshots
     SET rate_card_id     = $2,
         surge_event_id   = $3,
         surge_multiplier = $4,
         base_fare        = $5,
         distance_fare    = $6,
         time_fare        = $7,
         stop_fare        = $8,
         hour_surcharge   = $9,
         surge_fare       = $10,
         total_estimated  = $11
     WHERE ride_id = $1`,
    [
      rideId,
      fareEstimate.rate_card_id,
      fareEstimate.surge_event_id,
      fareEstimate.surge_multiplier,
      fareEstimate.breakdown.base_fare,
      fareEstimate.breakdown.distance_fare,
      fareEstimate.breakdown.time_fare,
      fareEstimate.breakdown.stop_fare,
      fareEstimate.breakdown.hour_surcharge,
      fareEstimate.breakdown.surge_fare,
      fareEstimate.breakdown.total,
    ]
  )
}

export async function getUpcomingRides(userId: bigint): Promise<unknown[]> {
  const res = await pool.query(
    `SELECT r.id::text, r.ride_type, r.origin_address, r.destination_address,
            r.scheduled_for,
            fs.total_estimated::text AS fare
     FROM rides r
     LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
     WHERE r.user_id = $1 AND r.status = 'scheduled'
     ORDER BY r.scheduled_for ASC`,
    [userId]
  )
  return res.rows
}

export async function countScheduledRidesForUser(userId: bigint): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count FROM rides WHERE user_id = $1 AND status = 'scheduled'`,
    [userId]
  )
  return (res.rows[0] as { count: number }).count
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
              COALESCE(p.driver_earning, 0)::text AS driver_earning
       FROM rides r
       LEFT JOIN users u           ON u.id = r.user_id
       LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
       LEFT JOIN payments p        ON p.ride_id = r.id
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

export interface PendingAssignment {
  ride_id: string
  expires_at: string
  origin_address: string | null
  destination_address: string | null
  origin_lat: number
  origin_lng: number
  dest_lat: number | null
  dest_lng: number | null
  total_estimated: string | null
  ride_type: string
  is_return_cab: boolean
  distance_to_pickup_metres: number
  return_at: string | null
  trip_hours: number | null
  stop_count: number
}

export async function getPendingAssignmentsForDriver(
  driverId: bigint
): Promise<PendingAssignment[]> {
  const res = await pool.query<PendingAssignment>(
    `SELECT
       ra.ride_id::text,
       ra.expires_at,
       r.origin_address,
       r.destination_address,
       ST_Y(r.origin::geometry)      AS origin_lat,
       ST_X(r.origin::geometry)      AS origin_lng,
       ST_Y(r.destination::geometry) AS dest_lat,
       ST_X(r.destination::geometry) AS dest_lng,
       r.ride_type,
       r.is_return_cab,
       r.return_at,
       r.trip_hours,
       (SELECT COUNT(*)::int FROM ride_stops rs WHERE rs.ride_id = r.id) AS stop_count,
       fs.total_estimated,
       COALESCE(
         CASE
           WHEN ra.driver_lat IS NOT NULL AND ra.driver_lng IS NOT NULL
             THEN ST_Distance(
               ST_SetSRID(ST_MakePoint(ra.driver_lng::float8, ra.driver_lat::float8), 4326)::geography,
               r.origin
             )
         END,
         0
       ) AS distance_to_pickup_metres
     FROM ride_assignments ra
     JOIN rides r ON r.id = ra.ride_id
     LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
     WHERE ra.driver_id = $1
       AND ra.expires_at > now()
       AND r.status = 'requested'
       AND ra.status NOT IN ('accepted', 'cancelled')`,
    [driverId]
  )
  return res.rows
}

// ── Driver earnings summary ───────────────────────────────────

export async function getDriverEarningsSummary(
  driverId: bigint,
  period: 'today' | 'week' | 'month'
): Promise<{
  total_earnings: number
  trip_count: number
  online_hours: string
  rating: number | null
  chart: number[]
  chart_labels: string[]
  breakdown: { base_fare: number; tips: number; incentives: number; platform_fee: number }
}> {
  const IST = `'Asia/Kolkata'`
  const rangeFrom = period === 'today'
    ? `DATE_TRUNC('day', NOW() AT TIME ZONE ${IST}) AT TIME ZONE ${IST}`
    : period === 'week'
      ? `DATE_TRUNC('day', (NOW() - INTERVAL '6 days') AT TIME ZONE ${IST}) AT TIME ZONE ${IST}`
      : `DATE_TRUNC('day', (NOW() - INTERVAL '29 days') AT TIME ZONE ${IST}) AT TIME ZONE ${IST}`
  const rangeTo = period === 'today'
    ? `DATE_TRUNC('day', NOW() AT TIME ZONE ${IST}) AT TIME ZONE ${IST} + INTERVAL '1 day'`
    : `NOW()`

  const where = `r.driver_id = $1 AND r.status = 'completed'
                 AND r.completed_at >= ${rangeFrom} AND r.completed_at < ${rangeTo}`

  const [summaryRes, hoursRes, chartRes, ratingRes] = await Promise.all([
    pool.query<{ total_earnings: string; trip_count: string; total_fare: string }>(
      `SELECT
         COALESCE(SUM(p.driver_earning)::numeric, 0)::text                                AS total_earnings,
         COUNT(r.id)::text                                                                  AS trip_count,
         COALESCE(SUM(COALESCE(fs.total_final, fs.total_estimated)::numeric), 0)::text     AS total_fare
       FROM rides r
       LEFT JOIN payments p        ON p.ride_id = r.id
       LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
       WHERE ${where}`,
      [driverId]
    ),
    pool.query<{ online_hours: string }>(
      `SELECT COALESCE(
         EXTRACT(EPOCH FROM SUM(COALESCE(went_offline_at, NOW()) - went_online_at)) / 3600,
         0
       )::text AS online_hours
       FROM driver_sessions
       WHERE driver_id = $1
         AND went_online_at >= ${rangeFrom} AND went_online_at < ${rangeTo}`,
      [driverId]
    ),
    period === 'today'
      ? pool.query<{ bucket: number; earnings: string }>(
          `SELECT EXTRACT(HOUR FROM r.completed_at AT TIME ZONE ${IST})::int AS bucket,
                  COALESCE(SUM(p.driver_earning)::numeric, 0)::text          AS earnings
           FROM rides r
           LEFT JOIN payments p ON p.ride_id = r.id
           WHERE ${where}
           GROUP BY bucket ORDER BY bucket`,
          [driverId]
        )
      : pool.query<{ bucket: string; earnings: string }>(
          `SELECT (DATE_TRUNC('day', r.completed_at AT TIME ZONE ${IST}) AT TIME ZONE ${IST})::date::text AS bucket,
                  COALESCE(SUM(p.driver_earning)::numeric, 0)::text                                       AS earnings
           FROM rides r
           LEFT JOIN payments p ON p.ride_id = r.id
           WHERE ${where}
           GROUP BY bucket ORDER BY bucket`,
          [driverId]
        ),
    pool.query<{ rating_avg: string | null }>(
      `SELECT rating_avg::text FROM drivers WHERE id = $1`,
      [driverId]
    ),
  ])

  const totalEarnings = parseFloat(summaryRes.rows[0]?.total_earnings ?? '0')
  const tripCount     = parseInt(summaryRes.rows[0]?.trip_count ?? '0', 10)
  const totalFare     = parseFloat(summaryRes.rows[0]?.total_fare ?? '0')
  const rawHours      = parseFloat(hoursRes.rows[0]?.online_hours ?? '0')
  const rating        = ratingRes.rows[0]?.rating_avg != null ? parseFloat(ratingRes.rows[0]!.rating_avg) : null

  const h = Math.floor(rawHours)
  const m = Math.round((rawHours - h) * 60)
  const onlineHours = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ''}` : `${m}m`

  // Build chart + labels
  let chart: number[]
  let chartLabels: string[]

  if (period === 'today') {
    const map = new Map<number, number>()
    for (const row of chartRes.rows as { bucket: number; earnings: string }[]) {
      const slot = Math.floor(row.bucket / 3)
      map.set(slot, (map.get(slot) ?? 0) + parseFloat(row.earnings))
    }
    chart = Array.from({ length: 8 }, (_, i) => map.get(i) ?? 0)
    chartLabels = ['12AM', '3AM', '6AM', '9AM', '12PM', '3PM', '6PM', '9PM']
  } else {
    const days = period === 'week' ? 7 : 30
    const map = new Map<string, number>()
    for (const row of chartRes.rows as { bucket: string; earnings: string }[]) {
      map.set(row.bucket, parseFloat(row.earnings))
    }
    chart = []
    chartLabels = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const iso = d.toISOString().split('T')[0]!
      chart.push(map.get(iso) ?? 0)
      if (period === 'week') {
        chartLabels.push(d.toLocaleDateString('en-IN', { weekday: 'short' }))
      } else {
        chartLabels.push(i % 5 === 0 ? String(d.getDate()) : '')
      }
    }
  }

  return {
    total_earnings: totalEarnings,
    trip_count: tripCount,
    online_hours: onlineHours,
    rating,
    chart,
    chart_labels: chartLabels,
    breakdown: {
      base_fare: totalFare,
      tips: 0,
      incentives: 0,
      platform_fee: Math.max(0, Math.round((totalFare - totalEarnings) * 100) / 100),
    },
  }
}

// ── GPS-derived actual distance ─────────────────────────────────

/**
 * Actual distance driven during a ride, computed from GPS breadcrumbs
 * (gps_tracks), not client-reported values. Returns null if fewer than
 * 2 points were recorded (insufficient to form a path — e.g. GPS outage,
 * a very short-lived test ride) so callers can fall back appropriately.
 *
 * `since` (pass the ride's started_at) is not just a filter — gps_tracks is
 * monthly range-partitioned on recorded_at, and without a recorded_at
 * predicate Postgres can't prune partitions, so it'd probe every partition
 * that has ever existed. No upper bound is needed: ride_id already scopes
 * this to one ride.
 */
export async function getGpsTrackedDistanceKm(rideId: bigint, since: Date): Promise<number | null> {
  const res = await pool.query<{ km: string | null }>(
    `SELECT
       CASE WHEN count(*) >= 2
         THEN ST_Length(ST_MakeLine(location::geometry ORDER BY recorded_at)::geography) / 1000
         ELSE NULL
       END AS km
     FROM gps_tracks
     WHERE ride_id = $1 AND recorded_at >= $2`,
    [rideId, since]
  )
  const km = res.rows[0]?.km
  return km != null ? parseFloat(km) : null
}

// ── ETA accuracy instrumentation ────────────────────────────────
// Logs the routing engine's predicted ETA at the start of a leg, for later
// comparison against the actual elapsed time (already available from
// rides.accepted_at/driver_arrived_at/started_at/completed_at — nothing new
// needed there). Best-effort, never blocks the ride flow — see call sites in
// rides.service.ts's acceptRide/verifyStartOTP.
export async function insertEtaSnapshot(
  rideId: bigint,
  leg: 'to_pickup' | 'to_destination',
  predictedDurationMin: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO ride_eta_snapshots (ride_id, leg, predicted_duration_min)
     VALUES ($1, $2, $3)
     ON CONFLICT (ride_id, leg) DO NOTHING`,
    [rideId, leg, predictedDurationMin]
  )
}
