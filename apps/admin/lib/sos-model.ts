import type { SosAlert, SosCounts } from './safety-api'

export const ACTIVE_STATUSES = new Set(['triggered', 'acknowledged', 'responding'])

export function activeCount(c: SosCounts): number {
  return c.triggered + c.acknowledged + c.responding
}

export function totalCount(c: SosCounts): number {
  return activeCount(c) + c.resolved + c.false_alarm
}

/** How long ago, to the minute and never rounded down to a vague "1h ago": 40 min, 2h 10m, 3d 4h. */
export function elapsedLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const m = Math.max(0, Math.floor((now - t) / 60_000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 === 0 ? `${h}h ago` : `${h}h ${m % 60}m ago`
  const d = Math.floor(h / 24)
  return h % 24 === 0 ? `${d}d ago` : `${d}d ${h % 24}h ago`
}

/** Local date and time for a tooltip / detail line. */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function hasLocation(a: Pick<SosAlert, 'location_lat' | 'location_lng'>): boolean {
  if (a.location_lat == null || a.location_lng == null) return false
  const lat = parseFloat(a.location_lat)
  const lng = parseFloat(a.location_lng)
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
}

/** Who is dealing with an alert, for the card and the table: "Acknowledged by x", "Resolved by x", or the empty string. */
export function handledBy(a: Pick<SosAlert, 'status' | 'acknowledged_by_email' | 'resolved_by_email'>): string {
  if (a.status === 'resolved' || a.status === 'false_alarm') {
    const verb = a.status === 'resolved' ? 'Resolved' : 'Dismissed'
    return a.resolved_by_email ? `${verb} by ${a.resolved_by_email}` : verb
  }
  return a.acknowledged_by_email ? `Acknowledged by ${a.acknowledged_by_email}` : ''
}

/** "04:12" / "1:02:05": a live stopwatch for an alert nobody has picked up yet. */
export function waitingClock(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** How late an unacknowledged alert is: ok under a minute (the target), late to five minutes (the server then pages every admin), overdue after. */
export const ACK_TARGET_MS = 60_000
export const ACK_OVERDUE_MS = 5 * 60_000
export function waitingTone(iso: string, now: number = Date.now()): 'ok' | 'late' | 'overdue' {
  const ms = now - new Date(iso).getTime()
  return ms >= ACK_OVERDUE_MS ? 'overdue' : ms >= ACK_TARGET_MS ? 'late' : 'ok'
}

/** Alerts in `current` the page has not announced yet. The first load only records what is already there, so opening the page never sounds the alarm for old alerts. */
export function unannounced(seen: Set<string> | null, current: { id: string; status: string }[]): { ids: string[]; seen: Set<string> } {
  const next = new Set(seen ?? [])
  const fresh = current.filter(a => a.status === 'triggered' && !next.has(a.id)).map(a => a.id)
  for (const a of current) next.add(a.id)
  return { ids: seen === null ? [] : fresh, seen: next }
}

export type SosFilter = 'all' | 'active' | 'resolved' | 'false_alarm'
export const SOS_FILTERS: { key: SosFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'active', label: 'Open' }, { key: 'resolved', label: 'Resolved' }, { key: 'false_alarm', label: 'False alarms' },
]

export type TimelineEntry = { at: string; text: string; tone: 'danger' | 'info' | 'success' }
/** The alert's own story, oldest first, from the stamps on the alert. */
export function timeline(a: Pick<SosAlert, 'created_at' | 'acknowledged_at' | 'acknowledged_by_email' | 'resolved_at' | 'resolved_by_email' | 'status' | 'resolution_note' | 'triggered_by_driver'>): TimelineEntry[] {
  const out: TimelineEntry[] = [{ at: a.created_at, text: a.triggered_by_driver ? 'Driver pressed SOS' : 'Rider pressed SOS', tone: 'danger' }]
  if (a.acknowledged_at) out.push({ at: a.acknowledged_at, text: `Acknowledged${a.acknowledged_by_email ? ` by ${a.acknowledged_by_email}` : ''}`, tone: 'info' })
  if (a.resolved_at) {
    const verb = a.status === 'false_alarm' ? 'Dismissed as a false alarm' : 'Resolved'
    out.push({ at: a.resolved_at, text: `${verb}${a.resolved_by_email ? ` by ${a.resolved_by_email}` : ''}${a.resolution_note ? `: ${a.resolution_note}` : ''}`, tone: 'success' })
  }
  return out
}
