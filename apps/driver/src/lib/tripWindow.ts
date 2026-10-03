// Booked-window clock for hourly round trips. One pure function decides which state the clock is
// in so the driver and rider phones can never disagree; the API sends `bookedUntil` and
// `overtimeGraceMin` (rides.service / lib/trip-window.ts) so no client hardcodes the billing rule.
//
// States, in order: none -> running -> final (last 15 min) -> grace (free minutes after the end)
// -> overtime (billed per minute, mirrors the server: whole started minutes past booked + grace).
//
// The web driver and web rider apps carry a copy of this file (apps/driver/src/lib/tripWindow.ts,
// apps/user/lib/tripWindow.ts) and run the same boundary table: tripWindow.cases.json.

export const FINAL_WINDOW_MS = 15 * 60_000

export type TripWindowState =
  | { kind: 'none' }
  | { kind: 'running'; msLeft: number }
  | { kind: 'final'; msLeft: number }
  | { kind: 'grace'; msToOvertime: number }
  | { kind: 'overtime'; overtimeMs: number; billedMin: number; amount: number | null }

export interface TripWindowInput {
  bookedUntil: string | null | undefined
  graceMin: number | null | undefined
  /** Server-corrected "now" in epoch ms (serverNow()), so a skewed phone clock cannot shift states. */
  now: number
  /** Rupees per hour billed per minute as overtime; null leaves the amount unknown. */
  overtimeRate?: number | null | undefined
}

export function tripWindow({ bookedUntil, graceMin, now, overtimeRate }: TripWindowInput): TripWindowState {
  if (!bookedUntil || graceMin == null) return { kind: 'none' }
  const endMs = new Date(bookedUntil).getTime()
  if (Number.isNaN(endMs)) return { kind: 'none' }

  const msLeft = endMs - now
  if (msLeft > FINAL_WINDOW_MS) return { kind: 'running', msLeft }
  if (msLeft > 0) return { kind: 'final', msLeft }

  const overtimeStart = endMs + graceMin * 60_000
  // Exactly at the end of the grace the server still bills zero (ceil of 0 minutes), so the
  // grace state holds through that instant and overtime begins on the next millisecond.
  if (now <= overtimeStart) return { kind: 'grace', msToOvertime: overtimeStart - now }

  const overtimeMs = now - overtimeStart
  const billedMin = Math.ceil(overtimeMs / 60_000)
  // Whole rupees, same rounding as the server's settleRoundTripOvertime.
  const amount = overtimeRate != null ? Math.round(billedMin * overtimeRate / 60) : null
  return { kind: 'overtime', overtimeMs, billedMin, amount }
}

/** "3h 20m" above an hour, otherwise "12 min" (never "0 min": a started minute reads as 1). */
export function formatTimeLeft(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "4:12" minutes and seconds, for the grace countdown and the running overtime. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export type TripWindowAudience = 'driver' | 'rider'

export interface TripWindowCopy {
  /** Feather icon name: the state is never colour-only. */
  icon: 'clock' | 'bell' | 'plus-circle'
  tone: 'brand' | 'warning'
  label: string
  value: string
  /** Rider only: one line stating the per-minute rate, shown from the final 15 minutes on. */
  note?: string
  /** Full sentence for screen readers (focus and transition announcements). */
  a11y: string
}

/** "₹1.67 a minute" from an hourly rate: the unit riders compare against other apps. */
function perMinute(hourRate: number): string {
  const v = hourRate / 60
  return `₹${Number.isInteger(v) ? v : v.toFixed(2)} a minute`
}

/**
 * Words for each state; `rupees` formats an amount (₹4) so each app keeps its own currency helper.
 * The rider never sees a running charge: extra time is recorded and added to the final fare, and the
 * clock only states the per-minute rate (after the free minutes) so nothing is a surprise.
 */
export function tripWindowCopy(
  state: TripWindowState,
  audience: TripWindowAudience,
  opts: { overtimeRate?: number | null; graceMin?: number | null; rupees: (n: number) => string },
): TripWindowCopy | null {
  const rider = audience === 'rider'
  const rate = opts.overtimeRate != null ? perMinute(opts.overtimeRate) : undefined
  const afterFree = opts.graceMin ? `After ${opts.graceMin} free minutes, extra` : 'Extra'
  const finalNote = rider && rate ? { note: `${afterFree} time is ${rate}.` } : {}
  const graceNote = rider && rate ? { note: `Extra time is ${rate}.` } : {}

  switch (state.kind) {
    case 'none':
      return null
    case 'running': {
      const value = formatTimeLeft(state.msLeft)
      return { icon: 'clock', tone: 'brand', label: 'Booked time left', value, a11y: `Booked time left ${value}` }
    }
    case 'final': {
      const value = formatTimeLeft(state.msLeft)
      return {
        icon: 'clock', tone: 'brand',
        label: rider ? 'Booked time ends in' : 'Booked time ends soon',
        value, ...finalNote,
        a11y: `Booked time ends soon, ${value} left`,
      }
    }
    case 'grace': {
      const value = formatClock(state.msToOvertime)
      return {
        icon: 'clock', tone: 'brand',
        label: rider ? 'Extra time starts in' : 'Booked time ended · Overtime starts in',
        value, ...graceNote,
        a11y: rider ? `Booked time ended. Extra time starts in ${value}` : `Booked time ended. Overtime starts in ${value}`,
      }
    }
    case 'overtime': {
      const clock = formatClock(state.overtimeMs)
      if (rider) {
        return {
          icon: 'plus-circle', tone: 'brand',
          label: 'Extra time', value: clock,
          ...(rate ? { note: `Added to your final fare at ${rate}.` } : {}),
          a11y: `Extra time ${clock}. It is added to your final fare.`,
        }
      }
      const money = state.amount != null ? opts.rupees(state.amount) : null
      return {
        icon: 'plus-circle', tone: 'brand',
        label: 'Overtime',
        value: money ? `${clock} · ${money}` : clock,
        a11y: `Overtime ${clock}${money ? `, ${money}` : ''}`,
      }
    }
  }
}
