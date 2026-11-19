// Pure helpers for the surge screen. Surges are never flipped to 'active' by the server (the time window alone decides
// whether one applies, see getActiveSurge), so "live" is derived from the clock, not from `status`.

export type SurgeLike = { status: string; starts_at: string; ends_at: string }
export type SurgeState = 'live' | 'upcoming' | 'ended' | 'cancelled'

export function surgeState(s: SurgeLike, now: number): SurgeState {
  if (s.status === 'cancelled') return 'cancelled'
  const start = Date.parse(s.starts_at)
  const end = Date.parse(s.ends_at)
  if (s.status === 'expired' || now >= end) return 'ended'
  return now < start ? 'upcoming' : 'live'
}

export const surgePct = (mult: number): number => Math.round((mult - 1) * 100)

/** What a base fare becomes under a multiplier, to the rupee. */
export const fareAfterSurge = (base: number, mult: number): number => Math.round(base * mult)

export function formatDuration(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h >= 24) { const d = Math.floor(h / 24); const rh = h % 24; return rh ? `${d} d ${rh} h` : `${d} d` }
  return m ? `${h} h ${m} min` : `${h} h`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Value for <input type="datetime-local"> in the viewer's local time. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A window that starts now and runs for `hours`, as datetime-local values. */
export function presetWindow(now: Date, hours: number): { starts_at: string; ends_at: string } {
  return { starts_at: toLocalInput(now), ends_at: toLocalInput(new Date(now.getTime() + hours * 3_600_000)) }
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

function dayWord(d: Date, now: Date): string {
  if (sameDay(d, now)) return 'Today'
  if (sameDay(d, new Date(now.getTime() + 86_400_000))) return 'Tomorrow'
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const clock = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])m$/i, (_m, x: string) => ` ${x.toUpperCase()}M`)

/** "Today 7:26 AM to 11:26 AM", or both days when the window crosses midnight. */
export function windowLabel(startIso: string, endIso: string, now: Date): string {
  const s = new Date(startIso)
  const e = new Date(endIso)
  return sameDay(s, e)
    ? `${dayWord(s, now)} ${clock(s)} to ${clock(e)}`
    : `${dayWord(s, now)} ${clock(s)} to ${dayWord(e, now)} ${clock(e)}`
}
