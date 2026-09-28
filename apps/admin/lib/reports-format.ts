// Formatting + pure KPI helpers for Reports. One place for rupee/percent/date text so the KPI band,
// tables, tooltips and CSV headers agree (plan section 5). Money in tooltips and tables is the full
// en-IN figure; KPI tiles and chart axes use the compact form.

const IN = new Intl.NumberFormat('en-IN')

/** ₹1,22,000 */
export function inr(n: number): string {
  return `₹${IN.format(Math.round(n))}`
}

/** ₹2.2k · ₹1.2L · ₹3.4Cr — for KPI tiles and chart axes. */
export function inrCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  const trim = (x: number) => String(Math.round(x * 10) / 10).replace(/\.0$/, '')
  if (abs >= 1e7) return `${sign}₹${trim(abs / 1e7)}Cr`
  if (abs >= 1e5) return `${sign}₹${trim(abs / 1e5)}L`
  if (abs >= 1e3) return `${sign}₹${trim(abs / 1e3)}k`
  return `${sign}₹${Math.round(abs)}`
}

export function int(n: number): string {
  return IN.format(Math.round(n))
}

/** 0.256 -> "26%". Returns an en dash when the value is unknown. */
export function pct(r: number | null | undefined, digits = 0): string {
  if (r === null || r === undefined || Number.isNaN(r)) return '–'
  return `${(r * 100).toFixed(digits)}%`
}

/** "2026-09-18" -> "18 Sep" */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** "2026-09-18" -> "Fri, 18 Sep 2026" */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

// ── Rates (mirror api/src/modules/analytics/kpi-definitions.ts) ───────────────
export interface CohortTotals { cohort_completed: number; cohort_cancelled: number }

/** completed / (completed + cancelled) among rides requested in the range. null when there are none. */
export function completionRate(t: CohortTotals): number | null {
  const d = t.cohort_completed + t.cohort_cancelled
  return d === 0 ? null : t.cohort_completed / d
}
export function cancellationRate(t: CohortTotals): number | null {
  const d = t.cohort_completed + t.cohort_cancelled
  return d === 0 ? null : t.cohort_cancelled / d
}

// ── Deltas ────────────────────────────────────────────────────────────────────
export interface Delta {
  /** signed change: relative for counts and money, percentage POINTS for rates */
  value: number
  kind: 'relative' | 'points'
  direction: 'up' | 'down' | 'flat'
}

/** Previous value 0 or missing: no delta (never NaN, never +Infinity%). */
export function relativeDelta(current: number, previous: number | null | undefined): Delta | null {
  if (previous === null || previous === undefined || previous === 0) return null
  const value = (current - previous) / previous
  return { value, kind: 'relative', direction: Math.abs(value) < 0.0005 ? 'flat' : value > 0 ? 'up' : 'down' }
}

export function pointsDelta(current: number | null, previous: number | null | undefined): Delta | null {
  if (current === null || previous === null || previous === undefined) return null
  const value = (current - previous) * 100
  return { value, kind: 'points', direction: Math.abs(value) < 0.05 ? 'flat' : value > 0 ? 'up' : 'down' }
}

export function deltaText(d: Delta): string {
  const sign = d.value > 0 ? '+' : d.value < 0 ? '−' : ''
  const abs = Math.abs(d.value)
  return d.kind === 'relative' ? `${sign}${(abs * 100).toFixed(abs >= 0.1 ? 0 : 1)}%` : `${sign}${abs.toFixed(1)} pts`
}
