import { pool, query, withTransaction } from '@/db/client'

export interface ShareRideRow {
  id: string
  user_id: string
  status: string
}

export interface ShareDTO {
  id: string
  label: string | null
  isSos: boolean
  viewCount: number
  lastViewedAt: string | null
  createdAt: string
}

export interface ShareLookup {
  id: string
  ride_id: string
  is_sos: boolean
  created_at: Date
  revoked_at: Date | null
  status: string
  completed_at: Date | null
  cancelled_at: Date | null
}

export interface NewShare {
  rideId: bigint
  userId: bigint
  tokenHash: string
  label: string | null
  phone: string | null
  isSos: boolean
}

export type InsertResult = { result: 'created'; id: string } | { result: 'limit_ride' | 'limit_hour' }
export type InsertManyResult = { result: 'created'; ids: string[] } | { result: 'limit_ride' | 'limit_hour' }

const SHARE_COLUMNS = `id, recipient_label AS label, is_sos AS "isSos", view_count AS "viewCount",
  last_viewed_at AS "lastViewedAt", created_at AS "createdAt"`

export async function getRideForShare(rideId: bigint): Promise<ShareRideRow | null> {
  const rows = await query<ShareRideRow>('SELECT id, user_id, status::text AS status FROM rides WHERE id = $1', [rideId.toString()])
  return rows[0] ?? null
}

/**
 * Creates the given shares ALL OR NONE, in one transaction: a contact list that does not fit is refused whole instead of leaving the
 * first links created (and texted) before a later one hits a cap. The ride row is locked (FOR UPDATE) so two simultaneous creates
 * cannot both pass the per-ride count, and the hourly count is read in the same transaction. `caps` is omitted for an SOS share:
 * an emergency is never refused.
 */
export function insertShares(inputs: NewShare[], caps?: { perRide: number; perHour: number }): Promise<InsertManyResult> {
  if (inputs.length === 0) return Promise.resolve({ result: 'created', ids: [] })
  const { rideId, userId } = inputs[0]!
  return withTransaction(async (client) => {
    await client.query('SELECT id FROM rides WHERE id = $1 FOR UPDATE', [rideId.toString()])
    if (caps) {
      const active = await client.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM ride_shares WHERE ride_id = $1 AND revoked_at IS NULL',
        [rideId.toString()],
      )
      if (Number(active.rows[0]!.n) + inputs.length > caps.perRide) return { result: 'limit_ride' as const }
      const recent = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ride_shares WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
        [userId.toString()],
      )
      if (Number(recent.rows[0]!.n) + inputs.length > caps.perHour) return { result: 'limit_hour' as const }
    }
    const ids: string[] = []
    for (const input of inputs) {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO ride_shares (ride_id, user_id, token_hash, recipient_label, recipient_phone, is_sos)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [input.rideId.toString(), input.userId.toString(), input.tokenHash, input.label, input.phone, input.isSos],
      )
      ids.push(ins.rows[0]!.id)
    }
    return { result: 'created' as const, ids }
  })
}

export async function insertShare(input: NewShare, caps?: { perRide: number; perHour: number }): Promise<InsertResult> {
  const res = await insertShares([input], caps)
  return res.result === 'created' ? { result: 'created', id: res.ids[0]! } : res
}

export const listActive = (rideId: bigint, userId: bigint) =>
  query<ShareDTO>(
    `SELECT ${SHARE_COLUMNS} FROM ride_shares WHERE ride_id = $1 AND user_id = $2 AND revoked_at IS NULL ORDER BY created_at`,
    [rideId.toString(), userId.toString()],
  )

export async function revokeOne(rideId: bigint, userId: bigint, shareId: bigint): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'UPDATE ride_shares SET revoked_at = now() WHERE id = $1 AND ride_id = $2 AND user_id = $3 AND revoked_at IS NULL RETURNING id',
    [shareId.toString(), rideId.toString(), userId.toString()],
  )
  return rows.length > 0
}

export async function revokeAll(rideId: bigint, userId: bigint): Promise<number> {
  const rows = await query<{ id: string }>(
    'UPDATE ride_shares SET revoked_at = now() WHERE ride_id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
    [rideId.toString(), userId.toString()],
  )
  return rows.length
}

/** The share and the ride's state, found by the hash of the token in the link. Revoked rows are returned so the caller can tell them apart. */
export async function findByTokenHash(tokenHash: string): Promise<ShareLookup | null> {
  const rows = await query<ShareLookup>(
    `SELECT s.id, s.ride_id, s.is_sos, s.created_at, s.revoked_at,
            r.status::text AS status, r.completed_at, r.cancelled_at
       FROM ride_shares s JOIN rides r ON r.id = s.ride_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  )
  return rows[0] ?? null
}

/** Counts a view at most once a minute per share, so polling every 5 s does not turn the counter into noise. */
export async function recordView(shareId: string): Promise<void> {
  await pool.query(
    `UPDATE ride_shares
        SET view_count = view_count + 1, last_viewed_at = now(), first_viewed_at = COALESCE(first_viewed_at, now())
      WHERE id = $1 AND (last_viewed_at IS NULL OR last_viewed_at < now() - interval '1 minute')`,
    [shareId],
  )
}

export async function getRiderFirstName(userId: bigint): Promise<string | null> {
  const rows = await query<{ first: string | null }>(`SELECT NULLIF(split_part(COALESCE(name, ''), ' ', 1), '') AS first FROM users WHERE id = $1`, [userId.toString()])
  return rows[0]?.first ?? null
}

/** Shares are removed 30 days after the ride ends; anything older than 37 days (7-day cap + 30) goes regardless. Returns rows deleted. */
export async function purgeOld(): Promise<number> {
  const res = await pool.query(
    `DELETE FROM ride_shares s USING rides r
      WHERE r.id = s.ride_id
        AND (COALESCE(r.completed_at, r.cancelled_at) < now() - interval '30 days' OR s.created_at < now() - interval '37 days')`,
  )
  return res.rowCount ?? 0
}

// ---- The public page's data -------------------------------------------------------------------------------------------
// A dedicated narrow query (design: allow-list, never the full ride row). Only what the page shows is selected.

export interface PublicTripRow {
  status: string
  origin_lat: number
  origin_lng: number
  origin_address: string | null
  destination_lat: number | null
  destination_lng: number | null
  destination_address: string | null
  completed_at: Date | null
  cancelled_at: Date | null
  rider_first_name: string | null
  driver_first_name: string | null
  vehicle_color: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  vehicle_plate: string | null
  driver_lat: number | null
  driver_lng: number | null
  driver_heading: number | null
  driver_updated_at: Date | null
}

export interface PublicStopRow {
  sequence: number
  address: string | null
  status: string
  lat: number
  lng: number
}

export async function getPublicTripRow(rideId: bigint): Promise<PublicTripRow | null> {
  const rows = await query<PublicTripRow>(
    `SELECT r.status::text AS status,
            ST_Y(r.origin::geometry) AS origin_lat, ST_X(r.origin::geometry) AS origin_lng, r.origin_address,
            ST_Y(r.destination::geometry) AS destination_lat, ST_X(r.destination::geometry) AS destination_lng,
            r.destination_address, r.completed_at, r.cancelled_at,
            NULLIF(split_part(COALESCE(u.name, ''), ' ', 1), '') AS rider_first_name,
            NULLIF(split_part(COALESCE(d.full_name, ''), ' ', 1), '') AS driver_first_name,
            dv.color AS vehicle_color, vb.name AS vehicle_brand, vm.name AS vehicle_model, dv.number_plate AS vehicle_plate,
            ST_Y(dls.location::geometry) AS driver_lat, ST_X(dls.location::geometry) AS driver_lng,
            dls.heading::float8 AS driver_heading, dls.recorded_at AS driver_updated_at
       FROM rides r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN drivers d ON d.id = r.driver_id
       LEFT JOIN driver_vehicles dv ON dv.driver_id = r.driver_id AND dv.is_primary = true AND dv.status != 'blacklisted'
       LEFT JOIN vehicle_models vm ON vm.id = dv.model_id
       LEFT JOIN vehicle_brands vb ON vb.id = dv.brand_id
       LEFT JOIN driver_location_snapshots dls ON dls.driver_id = r.driver_id
      WHERE r.id = $1`,
    [rideId.toString()],
  )
  return rows[0] ?? null
}

export const getPublicStops = (rideId: bigint) =>
  query<PublicStopRow>(
    `SELECT sequence::int AS sequence, address, status::text AS status,
            ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
       FROM ride_stops WHERE ride_id = $1 ORDER BY sequence`,
    [rideId.toString()],
  )
