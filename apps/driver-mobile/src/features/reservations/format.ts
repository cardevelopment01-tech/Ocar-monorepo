// Plain-language times for a reserved booking. All pure (the clock is passed in) so they can be tested.

const MIN = 60_000

/** Where a booking is on its way to the pickup. 'later' > 60 min, 'soon' 30-60, 'ready' under 30 (be online near the pickup), 'due' once the time has come. */
export type BookingPhase = 'later' | 'soon' | 'ready' | 'due'

export function phaseOf(pickupMs: number, nowMs: number): BookingPhase {
  const left = pickupMs - nowMs
  if (left <= 0) return 'due'
  if (left <= 30 * MIN) return 'ready'
  if (left <= 60 * MIN) return 'soon'
  return 'later'
}

const clock = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, ' ').toUpperCase()

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** "Today, 6:00 PM", "Tomorrow, 9:30 AM", or "Sat 28 Nov, 6:00 PM". */
export function whenLabel(pickup: Date, now: Date): string {
  const days = Math.round((startOfDay(pickup) - startOfDay(now)) / (24 * 60 * MIN))
  if (days === 0) return `Today, ${clock(pickup)}`
  if (days === 1) return `Tomorrow, ${clock(pickup)}`
  const day = pickup.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')
  return `${day}, ${clock(pickup)}`
}

/** "in 1h 42m", "in 24 min", "now". */
export function inLabel(pickupMs: number, nowMs: number): string {
  const mins = Math.ceil((pickupMs - nowMs) / MIN)
  if (mins <= 0) return 'now'
  if (mins < 60) return `in ${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h >= 24) { const d = Math.floor(h / 24); return `in ${d} day${d === 1 ? '' : 's'}` }
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`
}

/**
 * A booking that was on the list and is gone now, close to its pickup time, has most likely just been handed to this driver as their ride
 * (the other way it leaves the list is being given back or taken off them, which happens by the driver's own tap or well ahead of time).
 * Returns that booking's id, so the app can check for an active ride and open it.
 */
export function bookingThatStarted(prev: { rideId: string; pickupMs: number } | null, list: { rideId: string }[], nowMs: number): string | null {
  if (!prev || list.some((r) => r.rideId === prev.rideId)) return null
  const left = prev.pickupMs - nowMs
  return left <= 20 * MIN && left >= -15 * MIN ? prev.rideId : null
}

/** The one line a driver should read for a booking in this phase. */
export function guidance(phase: BookingPhase, confirmed: boolean): string {
  if (phase === 'due') return 'Your booking time has come. Stay online; it is about to reach you.'
  if (phase === 'ready') return 'Be online and near the pickup. We are not sending rides that would run into this booking.'
  if (!confirmed) return phase === 'soon' ? 'Please confirm now so we know you will be there.' : 'Confirm when you are sure you can make it.'
  return 'You are set. Until then you get only rides that finish in time.'
}
