import { pool } from '@/db/client'
import { logger } from '@/lib/logger'
import { invalidateOffers, releaseRedemption } from './offers.repository'

const log = logger.child({ module: 'offers-worker' })

/**
 * Gives back the budget, global slot and per-user use of reservations whose ride ended without service (cancelled or
 * no_drivers) but whose release was missed: a crash or a database blip between the status change and the release. A ride
 * that is still requested is closed by the stale-request sweep, which lands here next run; a live, scheduled or completed
 * ride keeps its reservation. A completed ride whose payment never succeeds is the payment-reconcile job's to resolve.
 */
export async function releaseStaleReservations(olderThanMinutes = 30): Promise<number> {
  const stale = await pool.query<{ ride_id: string }>(
    `SELECT r.ride_id::text
       FROM offer_redemptions r
       JOIN rides ri ON ri.id = r.ride_id
      WHERE r.status = 'reserved'
        AND r.reserved_at < now() - make_interval(mins => $1::int)
        AND ri.status IN ('cancelled', 'no_drivers')
      ORDER BY r.reserved_at
      LIMIT 200`,
    [olderThanMinutes]
  )
  let released = 0
  for (const row of stale.rows) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (await releaseRedemption(client, BigInt(row.ride_id), 'stale reservation')) released++
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      log.error({ err, rideId: row.ride_id }, 'releasing a stale offer reservation failed')
    } finally {
      client.release()
    }
  }
  if (released > 0) log.warn({ released }, 'released stale offer reservations')
  return released
}

/** Moves active and paused offers past their end time to ended, and clears their cached copies. */
export async function endExpiredOffers(): Promise<number> {
  const res = await pool.query<{ code: string | null }>(
    `UPDATE offers SET status = 'ended'
      WHERE status IN ('active', 'paused') AND ends_at IS NOT NULL AND ends_at <= now()
      RETURNING code::text AS code`
  )
  if (res.rows.length > 0) {
    await invalidateOffers()
    for (const r of res.rows) if (r.code) await invalidateOffers(r.code)
  }
  return res.rowCount ?? 0
}
