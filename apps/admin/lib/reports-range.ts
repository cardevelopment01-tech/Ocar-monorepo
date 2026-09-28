// URL state for the Reports page (plan section 5): every filter lives in the query string so a link
// is shareable and back/forward works. Dates are IST calendar days ('YYYY-MM-DD').

export type RangePreset = '7d' | '30d' | '90d' | 'month' | 'lastmonth' | 'custom'
export type ReportTab = 'overview' | 'demand' | 'drivers' | 'finance'
export type Compare = 'prev' | 'off'

export const TABS: ReportTab[] = ['overview', 'demand', 'drivers', 'finance']
export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
]

export interface ReportFilters {
  tab: ReportTab
  range: RangePreset
  from: string // resolved IST dates, inclusive
  to: string
  cityIds: string[]
  categoryId: string | null
  compare: Compare
}

const DAY_MS = 86_400_000
const IST_MS = 5.5 * 3600_000

export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_MS).toISOString().slice(0, 10)
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export function resolvePreset(range: RangePreset, now: Date = new Date()): { from: string; to: string } {
  const today = istToday(now)
  if (range === '7d') return { from: shift(today, -6), to: today }
  if (range === '90d') return { from: shift(today, -89), to: today }
  if (range === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (range === 'lastmonth') {
    const firstThis = `${today.slice(0, 7)}-01`
    const lastPrev = shift(firstThis, -1)
    return { from: `${lastPrev.slice(0, 7)}-01`, to: lastPrev }
  }
  return { from: shift(today, -29), to: today } // 30d (and the fallback)
}

/** Parse the query string into filters. Bad values fall back to defaults (never throw). */
export function parseFilters(params: URLSearchParams, now: Date = new Date()): ReportFilters {
  const tabRaw = params.get('tab') as ReportTab | null
  const tab = tabRaw && TABS.includes(tabRaw) ? tabRaw : 'overview'
  const rangeRaw = params.get('range') as RangePreset | null
  const from = params.get('from')
  const to = params.get('to')
  let range: RangePreset = rangeRaw && [...RANGE_PRESETS.map(p => p.key), 'custom'].includes(rangeRaw) ? rangeRaw : '30d'
  let resolved: { from: string; to: string }
  if (range === 'custom' || (isDate(from) && isDate(to) && !rangeRaw)) {
    if (isDate(from) && isDate(to)) { range = 'custom'; resolved = { from, to } }
    else { range = '30d'; resolved = resolvePreset('30d', now) }
  } else {
    resolved = resolvePreset(range, now)
  }
  const cityIds = (params.get('city') ?? '').split(',').filter(s => /^\d+$/.test(s))
  const cat = params.get('cat')
  return {
    tab, range, from: resolved.from, to: resolved.to, cityIds,
    categoryId: cat && /^\d+$/.test(cat) ? cat : null,
    compare: params.get('cmp') === 'off' ? 'off' : 'prev',
  }
}

/** Query string fragment for a change; defaults are omitted so URLs stay short. */
export function toSearchParams(f: ReportFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.tab !== 'overview') p.set('tab', f.tab)
  if (f.range !== '30d') p.set('range', f.range)
  if (f.range === 'custom') { p.set('from', f.from); p.set('to', f.to) }
  if (f.cityIds.length) p.set('city', f.cityIds.join(','))
  if (f.categoryId) p.set('cat', f.categoryId)
  if (f.compare === 'off') p.set('cmp', 'off')
  return p
}

/** Custom-range problems as text the user can act on; null when valid. */
export function validateRange(from: string, to: string): string | null {
  if (!isDate(from) || !isDate(to)) return 'Enter both dates.'
  if (from > to) return 'The start date must be on or before the end date.'
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1
  if (days > 366) return 'The range can be at most 366 days.'
  return null
}

/** Params for the API: from/to always (the API resolves IST days), plus filters. */
export function apiParams(f: ReportFilters): Record<string, string> {
  const p: Record<string, string> = { from: f.from, to: f.to, compare: f.compare }
  if (f.cityIds.length) p['cityIds'] = f.cityIds.join(',')
  if (f.categoryId) p['categoryId'] = f.categoryId
  return p
}
