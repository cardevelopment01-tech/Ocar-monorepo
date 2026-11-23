// Ops staff read ride times as the riders and drivers lived them: Indian Standard Time, whatever the admin's own device clock says.
const IST = 'Asia/Kolkata'

export function fmtIst(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' })
}

export function fmtIstClock(d: Date): string {
  return d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Today's date in IST as YYYY-MM-DD, offset by `daysAgo`. Date filters are calendar days, so the presets must be IST days too. */
export function istDay(daysAgo = 0, now: Date = new Date()): string {
  const shifted = new Date(now.getTime() - daysAgo * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(shifted)
}

/** Seconds between two instants as "12s" / "1m 05s"; null when either is missing. */
export function elapsed(from: string | null, to: string | null): string | null {
  if (!from || !to) return null
  const s = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000)
  if (!Number.isFinite(s) || s < 0) return null
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const timeOnly = (d: Date) => d.toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?(am|pm)$/i, m => m.trim().toLowerCase().padStart(3, ' ')).replace('  ', ' ')
/** "6:30 pm" in India time. */
export const fmtIstTime = (d: Date) => timeOnly(d)

/** "Today, 6:30 pm" / "Tomorrow, 6:30 pm" / "Thu 26 Nov, 6:30 pm", all in IST. */
export function fmtIstDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const day = (x: Date) => istDay(0, x)
  const time = timeOnly(d)
  if (day(d) === day(now)) return `Today, ${time}`
  if (day(d) === istDay(-1, now)) return `Tomorrow, ${time}`
  if (day(d) === istDay(1, now)) return `Yesterday, ${time}`
  return `${d.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`
}

/** "2026-11-24T18:30" for a datetime-local box, showing India time whatever zone the admin's computer is in. */
export function toIstInput(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

/** The instant a datetime-local value means when read as India time; null if it is not a date. */
export function fromIstInput(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null
  const d = new Date(`${v}:00+05:30`)
  return Number.isNaN(d.getTime()) ? null : d
}
