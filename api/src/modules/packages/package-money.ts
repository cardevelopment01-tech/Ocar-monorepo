// Money and lot rules for driver ride-credit packages, kept pure so they are unit-tested without a database.

const r2 = (n: number) => Math.round(n * 100) / 100

/** GST is added on top of the package price: 40 at 18% -> 7.20 GST, 47.20 charged. The ride value credited is unchanged. */
export function packagePricing(price: number, gstPercent: number): { price: number; gstPercent: number; gstAmount: number; total: number } {
  const p = r2(price)
  const gstAmount = r2((p * gstPercent) / 100)
  return { price: p, gstPercent, gstAmount, total: r2(p + gstAmount) }
}

export type LotRow = { id: string; remaining: number }

/**
 * How a ride's fare draws on the driver's live credit lots. Lots arrive soonest-expiry first; each is used up before the next.
 * Whatever the lots cannot cover is `uncovered` (it still reduces the wallet balance, which may go negative, exactly as before lots).
 */
export function allocateFare(lots: readonly LotRow[], fare: number): { takes: Array<{ id: string; take: number }>; uncovered: number } {
  let left = r2(fare)
  const takes: Array<{ id: string; take: number }> = []
  for (const lot of lots) {
    if (left <= 0) break
    const take = r2(Math.min(lot.remaining, left))
    if (take <= 0) continue
    takes.push({ id: lot.id, take })
    left = r2(left - take)
  }
  return { takes, uncovered: Math.max(left, 0) }
}

/** When a lot bought at `from` expires: `days` later (whole days; the driver sees the date, so no time-of-day surprises in either direction). */
export function lotExpiry(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000)
}

/** A driver's vehicle group for plan selection: autos have their own plans, every car type shares the cab plans. */
export function vehicleGroupOf(categorySlug: string | null | undefined): 'cab' | 'auto' {
  return categorySlug === 'auto' || categorySlug === 'auto_rickshaw' ? 'auto' : 'cab'
}
