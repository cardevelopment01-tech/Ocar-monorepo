// Night allowance: how many nights a trip was driven in, for the flat per-night amount on the rate card.
//
// A "night" is the window from 11 PM to 6 AM India time. A trip is charged once for every night it overlaps, so a trip that drives
// through two nights pays twice, and one that never touches 11 PM-6 AM pays nothing. India has no daylight saving, so IST is a fixed
// +5:30 offset and the arithmetic needs no time-zone library.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const NIGHT_START_HOUR = 23
export const NIGHT_END_HOUR = 6

/** The ride types that earn a night allowance: outstation trips (one-way, which includes Return Cab, and round trip) in standard mode. */
export function earnsNightAllowance(ride: { ride_type: string; trip_mode?: string | null }): boolean {
  return (ride.ride_type === 'one_way' || ride.ride_type === 'round_trip') && (ride.trip_mode ?? 'standard') === 'standard'
}

export interface NightTerms { ride_type: string; trip_mode?: string | null; started_at: string | Date | null; rate: number }

/** What a finished ride owes: nights x the rate on its card, or nothing when the ride type does not earn it, the card has no allowance
 *  (rate 0, which is every ride booked before this existed) or the trip never started. */
export function nightAllowanceFor(t: NightTerms, endedAt: Date): { amount: number; nights: number } {
  if (!t.started_at || !(t.rate > 0) || !earnsNightAllowance(t)) return { amount: 0, nights: 0 }
  const nights = countNights(new Date(t.started_at), endedAt)
  return { amount: Math.round(nights * t.rate * 100) / 100, nights }
}

/** Nights the trip [start, end] overlaps. A trip that only touches a night's edge (ends exactly 11 PM, or starts exactly 6 AM) overlaps nothing. */
export function countNights(start: Date, end: Date): number {
  const s = start.getTime()
  const e = end.getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0
  // Work in IST. The night that begins at 23:00 on IST day d ends at 06:00 on day d+1, so a night that began the evening before the
  // start day can still be running at the start: begin one day early.
  const firstDay = Math.floor((s + IST_OFFSET_MS) / DAY_MS) - 1
  const lastDay = Math.floor((e + IST_OFFSET_MS) / DAY_MS)
  let nights = 0
  for (let d = firstDay; d <= lastDay; d++) {
    const nightStart = d * DAY_MS - IST_OFFSET_MS + NIGHT_START_HOUR * HOUR_MS
    const nightEnd = nightStart + (24 - NIGHT_START_HOUR + NIGHT_END_HOUR) * HOUR_MS
    if (s < nightEnd && e > nightStart) nights += 1
  }
  return nights
}
