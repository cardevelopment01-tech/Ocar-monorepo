import type { PoolClient } from 'pg'
import { getConfigValue } from '@/lib/system-config'
import { computeBenefit } from './engine'
import { consumeRedemption, releaseRedemption } from './offers.repository'
import type { Benefit, FareComponents } from './offers.types'
import { roundPaise } from './money'

/** Anything with query(): the pool or a transaction's client. */
export type Queryable = Pick<PoolClient, 'query'>

/** What the rider pays for a fare with a discount. The one TypeScript definition; SQL readers use ocar_payable(). */
export function payableOf(row: { total: string | number; discount_amount?: string | number | null }): number {
  return roundPaise(Math.max(Number(row.total) - Number(row.discount_amount ?? 0), 0))
}

type FinaliseRow = {
  discount_amount: string
  total_estimated: string
  total_final: string | null
  base_fare: string; distance_fare: string; time_fare: string; stop_fare: string; hour_surcharge: string
  surge_fare: string; waiting_fare: string | null; overage_fare: string | null
  reserved: string
  benefit: Benefit
}

/**
 * Re-derive a ride's discount after its fare changed (review decisions D15 and D22). Every writer of total_final or
 * total_estimated calls this: early end, extra days, overage, waiting, force-complete and the scheduled re-quote.
 *
 * The discount can shrink but never grow past what was reserved at booking: a final fare of 400 against an estimate
 * of 454 re-derives it on the smaller fare; a final fare of 520 keeps it. The fare's discountable parts are the
 * snapshot's estimate components scaled by final/estimate when the trip came in cheaper (extras land in surge,
 * waiting, stops and overage, which are not discountable by default). When the discount shrinks, the redemption and
 * the offer's budget_spent are trued down by the difference in the same call. Idempotent; a ride with no live
 * redemption is left untouched. Deliberately does not read offers_enabled: settlement must not change meaning when
 * the switch is flipped after booking.
 */
export async function finaliseDiscount(q: Queryable, rideId: bigint): Promise<number> {
  const res = await q.query<FinaliseRow>(
    `SELECT fs.discount_amount::text, fs.total_estimated::text, fs.total_final::text,
            fs.base_fare::text, fs.distance_fare::text, fs.time_fare::text, fs.stop_fare::text, fs.hour_surcharge::text,
            fs.surge_fare::text, fs.waiting_fare::text, fs.overage_fare::text,
            r.discount_amount::text AS reserved, v.benefit
       FROM fare_snapshots fs
       JOIN offer_redemptions r ON r.ride_id = fs.ride_id AND r.status IN ('reserved', 'consumed')
       JOIN offer_versions v ON v.id = r.offer_version_id
      WHERE fs.ride_id = $1`,
    [rideId]
  )
  const row = res.rows[0]
  if (!row || row.benefit == null) return 0

  const current = Number(row.discount_amount)
  const reserved = Number(row.reserved)
  const estimate = Number(row.total_estimated)
  const scale = row.total_final != null && estimate > 0 ? Math.min(Number(row.total_final) / estimate, 1) : 1
  const part = (v: string | null) => Number(v ?? 0) * scale
  const fare: FareComponents = {
    base: part(row.base_fare), distance: part(row.distance_fare), time: part(row.time_fare), stop: part(row.stop_fare),
    hourSurcharge: part(row.hour_surcharge), waiting: part(row.waiting_fare), surge: part(row.surge_fare), overage: part(row.overage_fare),
  }
  const maxPct = parseFloat(await getConfigValue('offers_max_discount_percent', '15'))
  const derived = computeBenefit(row.benefit, fare, Number.isFinite(maxPct) && maxPct >= 0 ? maxPct : 15).discount
  const next = roundPaise(Math.min(derived, reserved))

  if (Math.abs(next - current) < 0.005) return current
  if (next < reserved) {
    // ONE statement: lock the redemption, shrink it and true the budget down by what it actually held. Two overlapping
    // calls (a double-tapped collect, the stranded sweep racing the end-of-ride settle) cannot both subtract the same
    // delta: the second waits on the lock, re-reads the shrunk row and matches nothing.
    await q.query(
      `WITH cur AS (
         SELECT id, offer_id, discount_amount AS old FROM offer_redemptions
          WHERE ride_id = $1 AND status IN ('reserved', 'consumed') AND discount_amount > $2::numeric FOR UPDATE
       ), shrunk AS (
         UPDATE offer_redemptions r SET discount_amount = $2::numeric FROM cur WHERE r.id = cur.id RETURNING cur.offer_id, cur.old
       )
       UPDATE offers o SET budget_spent = GREATEST(o.budget_spent - (shrunk.old - $2::numeric), 0)
         FROM shrunk WHERE o.id = shrunk.offer_id`,
      [rideId, next]
    )
  }
  await q.query(`UPDATE fare_snapshots SET discount_amount = $2 WHERE ride_id = $1`, [rideId, next])
  return next
}

/**
 * The amount this ride's rider pays right now, after making sure the discount matches the final fare. The single reader
 * for the gateway order, the wallet debit, the cash expectation and the payment row.
 */
export async function payableForRide(q: Queryable, rideId: bigint): Promise<number> {
  await finaliseDiscount(q, rideId)
  const res = await q.query<{ payable: string | null }>(
    `SELECT ocar_payable(COALESCE(total_final, total_estimated), discount_amount)::text AS payable FROM fare_snapshots WHERE ride_id = $1`,
    [rideId]
  )
  return Number(res.rows[0]?.payable ?? 0)
}

/**
 * Called inside the settlement transaction once the ride's payment is confirmed or its cash collected: reserved ->
 * consumed. Idempotent. Cashback offers stay off until riders can spend wallet credit (offers_cashback_enabled), so
 * there is nothing to credit yet; the driver is never touched: the discount is already out of the fare they keep.
 */
export async function settleOfferOnPayment(q: Queryable, rideId: bigint): Promise<void> {
  await consumeRedemption(q, rideId)
}

/**
 * A ride was cancelled. With no fee charged the offer is given back (budget, slot and the rider's use). With a
 * cancellation fee the ride did real work, so the offer counts as used and the benefit is lost. Runs inside the
 * cancellation's transaction; idempotent and a no-op for a ride with no offer.
 */
export async function onRideCancelled(q: Queryable, rideId: bigint, feeCharged: boolean): Promise<void> {
  if (feeCharged) await consumeRedemption(q, rideId)
  else await releaseRedemption(q, rideId, 'ride cancelled')
}

/** The ride closed with no driver (no_drivers) or an admin cancelled it: nothing was delivered, give the offer back. */
export async function releaseForRide(q: Queryable, rideId: bigint, reason: string): Promise<void> {
  await releaseRedemption(q, rideId, reason)
}
