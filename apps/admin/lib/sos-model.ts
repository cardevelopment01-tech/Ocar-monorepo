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
