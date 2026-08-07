import { pool, withTransaction } from '@/db/client'

export interface RideCallMask {
  id: bigint
  rideId: bigint
  virtualNumber: string
  driverPhone: string
  riderPhone: string
  callCount: number
  expiresAt: Date
}

function toRideCallMask(row: {
  id: string
  ride_id: string
  virtual_number: string
  driver_phone: string
  rider_phone: string
  call_count: number
  expires_at: Date
}): RideCallMask {
  return {
    id: BigInt(row.id),
    rideId: BigInt(row.ride_id),
    virtualNumber: row.virtual_number,
    driverPhone: row.driver_phone,
    riderPhone: row.rider_phone,
    callCount: row.call_count,
    expiresAt: row.expires_at,
  }
}

export async function allocateNumber(params: {
  rideId: bigint
  driverPhone: string
  riderPhone: string
  ttlMinutes: number
}): Promise<RideCallMask | null> {
  return withTransaction(async (client) => {
    // SKIP LOCKED so concurrent ride-accepts never fight over the same row —
    // same pattern as the broadcast fan-out's driver-candidate locking.
    const { rows: poolRows } = await client.query(
      `SELECT id, virtual_number FROM exotel_number_pool
       WHERE status = 'available'
       ORDER BY id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    )
    if (poolRows.length === 0) return null

    const poolNumberId = poolRows[0].id as string
    const virtualNumber = poolRows[0].virtual_number as string

    await client.query(
      `UPDATE exotel_number_pool SET status = 'allocated', updated_at = now() WHERE id = $1`,
      [poolNumberId]
    )

    const { rows: maskRows } = await client.query(
      `INSERT INTO ride_call_masks
         (ride_id, pool_number_id, virtual_number, driver_phone, rider_phone, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)
       RETURNING id, ride_id, virtual_number, driver_phone, rider_phone, call_count, expires_at`,
      [params.rideId, poolNumberId, virtualNumber, params.driverPhone, params.riderPhone, params.ttlMinutes]
    )

    return toRideCallMask(maskRows[0])
  })
}

export async function getActiveMaskForRide(rideId: bigint): Promise<RideCallMask | null> {
  const { rows } = await pool.query(
    `SELECT id, ride_id, virtual_number, driver_phone, rider_phone, call_count, expires_at
     FROM ride_call_masks WHERE ride_id = $1 AND status = 'active'`,
    [rideId]
  )
  if (rows.length === 0) return null
  return toRideCallMask(rows[0])
}

export async function incrementCallCount(maskId: bigint): Promise<void> {
  await pool.query(
    `UPDATE ride_call_masks SET call_count = call_count + 1, updated_at = now() WHERE id = $1`,
    [maskId]
  )
}

export async function releaseByRideId(rideId: bigint): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE ride_call_masks SET status = 'released', released_at = now(), updated_at = now()
       WHERE ride_id = $1 AND status = 'active'
       RETURNING pool_number_id`,
      [rideId]
    )
    if (rows.length > 0) {
      await client.query(
        `UPDATE exotel_number_pool SET status = 'available', updated_at = now() WHERE id = $1`,
        [rows[0].pool_number_id]
      )
    }
  })
}

// Safety net for rides that never hit a terminal status cleanly (mirrors the
// scheduler worker's sweep pattern) — releases any mask past its TTL.
export async function releaseExpiredMasks(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE ride_call_masks SET status = 'released', released_at = now(), updated_at = now()
       WHERE status = 'active' AND expires_at < now()
       RETURNING pool_number_id`
    )
    for (const row of rows) {
      await client.query(
        `UPDATE exotel_number_pool SET status = 'available', updated_at = now() WHERE id = $1`,
        [row.pool_number_id]
      )
    }
    return rows.length
  })
}

export async function recordCallEvent(params: {
  rideCallMaskId: bigint
  callSid: string
  callStatus?: string
  durationSec?: number
  priceInr?: number
  rawPayload: unknown
}): Promise<boolean> {
  const { rows } = await pool.query(
    `INSERT INTO exotel_call_events (ride_call_mask_id, call_sid, call_status, duration_sec, price_inr, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (call_sid) DO NOTHING
     RETURNING id`,
    [
      params.rideCallMaskId,
      params.callSid,
      params.callStatus ?? null,
      params.durationSec ?? null,
      params.priceInr ?? null,
      JSON.stringify(params.rawPayload),
    ]
  )
  return rows.length > 0
}

export async function getTodaySpendInr(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(price_inr), 0) AS total FROM exotel_call_events WHERE created_at >= date_trunc('day', now())`
  )
  return Number(rows[0].total)
}
