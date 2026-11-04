import type { RideDetail } from '@ocar/mobile-shared'

type CashFields = Pick<RideDetail, 'cashDue' | 'discountAmount' | 'totalFinal' | 'totalEstimated'>

function num(v: string | null | undefined): number | null {
  if (v == null) return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/** The cash the driver collects. The server's cash_due is the payable once offers exist; an older server sends
 *  none, so fall back to the settled fare, then the estimate (what the card showed before). */
export function cashDueOf(ride: Partial<CashFields>): number {
  return num(ride.cashDue) ?? num(ride.totalFinal) ?? num(ride.totalEstimated) ?? 0
}

/** Rupees the rider's offer took off this ride; 0 when none (or an older server). */
export function riderOfferDiscount(ride: Partial<CashFields>): number {
  const d = num(ride.discountAmount)
  return d != null && d > 0 ? d : 0
}
