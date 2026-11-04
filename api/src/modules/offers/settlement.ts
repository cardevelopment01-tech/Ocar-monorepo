import type { PoolClient } from 'pg'
import { getConfigValue } from '@/lib/system-config'
import { computeBenefit } from './engine'
import { consumeRedemption } from './offers.repository'
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
  await q.query(`UPDATE fare_snapshots SET discount_amount = $2 WHERE ride_id = $1`, [rideId, next])
  if (next < reserved) {
    await q.query(
      `UPDATE offers SET budget_spent = GREATEST(budget_spent - ($2::numeric - $3::numeric), 0)
        WHERE id = (SELECT offer_id FROM offer_redemptions WHERE ride_id = $1 AND status IN ('reserved', 'consumed'))`,
      [rideId, reserved, next]
    )
    await q.query(
      `UPDATE offer_redemptions SET discount_amount = $2 WHERE ride_id = $1 AND status IN ('reserved', 'consumed')`,
      [rideId, next]
    )
  }
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
  await consumeRedemption(q as PoolClient, rideId)
}
