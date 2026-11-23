import type { FareLine } from '@ocar/mobile-shared'

/**
 * The indented lines under "Ride fare" on a rental's trip-complete card: the package and extra km/time lines, the waiting at
 * the pickup as a line of its own, then whatever is left (surge, stops) as one "Surge and extras" line, so the lines always add
 * up to the fare. Waiting used to fall into that catch-all and was then named a second time in a small note under the commission.
 * `null` when the ride is not a rental (its lines are not shown).
 */
export function rentalBreakdown(rentalLines: FareLine[] | null, fare: number, pickupWaitFare: number, pickupWaitMin: number): FareLine[] | null {
  if (!rentalLines) return null
  const lines = pickupWaitFare > 0
    ? [...rentalLines, { key: 'pickup-wait', label: 'Waiting at pickup', detail: `${pickupWaitMin} min`, amount: pickupWaitFare }]
    : rentalLines
  const rest = fare - lines.reduce((s, l) => s + l.amount, 0)
  return rest >= 1 ? [...lines, { key: 'other', label: 'Surge and extras', amount: rest }] : lines
}
