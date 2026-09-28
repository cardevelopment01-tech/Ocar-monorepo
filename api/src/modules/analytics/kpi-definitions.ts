// Single source of truth for the numbers shown by Reports, the admin Overview dashboard,
// the CSV export and the daily digest (CEO E1, eng D4). Nothing else may re-derive these.
//
// Clocks (eng D4):
//   * money (gross bookings, commission), completed rides and active drivers use
//     rides.completed_at (the day the ride finished);
//   * requested / cancelled rides and the completion and cancellation RATES are a
//     requested cohort: every ride is bucketed by rides.requested_at.
// All range bounds are half-open [start, end) UTC instants derived from IST calendar days,
// so predicates stay sargable (no AT TIME ZONE cast wrapping the column).
//
// Definitions:
//   gross bookings   = SUM(payments.amount)            payments.status = 'completed', ride completed
//   commission       = SUM(payments.commission_amount) same filter
//   completed rides  = rides.status = 'completed'
//   active drivers   = distinct rides.driver_id among completed rides in the range (EE-D2)
//   completion rate  = cohort_completed / (cohort_completed + cohort_cancelled)   (requested cohort)
//   cancellation rate= cohort_cancelled / (cohort_completed + cohort_cancelled)   (requested cohort)
//   take rate        = commission / gross bookings
// A completed ride whose payment is not 'completed' yet counts as a completed ride and adds 0
// to money until the payment completes.

const IST_OFFSET_MS = 5.5 * 3600_000
const DAY_MS = 86_400_000

export interface TimeRange {
  /** inclusive */
  start: Date
  /** exclusive */
  end: Date
}

/** 'YYYY-MM-DD' (an IST calendar date) -> midnight IST as a UTC instant. */
export function istDayStartUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS)
}

/** The IST calendar date ('YYYY-MM-DD') containing the given instant. */
export function istDateOf(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

export function todayIstDate(now: Date = new Date()): string {
  return istDateOf(now)
}

/** Inclusive IST dates [from, to] -> half-open UTC range. */
export function rangeFromIstDates(from: string, to: string): TimeRange {
  return { start: istDayStartUtc(from), end: new Date(istDayStartUtc(to).getTime() + DAY_MS) }
}

/** The equally long window immediately before `range`. */
export function previousRange(range: TimeRange): TimeRange {
  const len = range.end.getTime() - range.start.getTime()
  return { start: new Date(range.start.getTime() - len), end: range.start }
}

export interface KpiFilters {
  cityIds?: number[]
  categoryId?: number
}

/**
 * SQL predicate fragment on `rides` aliased as `r` for the optional city/category filters.
 * `firstParam` is the index of the first placeholder to use ($3 when $1/$2 are the bounds).
 */
export function ridesFilterSql(
  filters: KpiFilters | undefined,
  firstParam: number
): { sql: string; params: unknown[] } {
  const parts: string[] = []
  const params: unknown[] = []
  if (filters?.cityIds && filters.cityIds.length > 0) {
    params.push(filters.cityIds)
    parts.push(`AND r.origin_city_id = ANY($${firstParam + params.length - 1}::bigint[])`)
  }
  if (filters?.categoryId !== undefined) {
    params.push(filters.categoryId)
    parts.push(`AND r.category_id = $${firstParam + params.length - 1}`)
  }
  return { sql: parts.join(' '), params }
}

export interface KpiTotals {
  gross_bookings: number
  commission: number
  completed_rides: number
  active_drivers: number
  cohort_completed: number
  cohort_cancelled: number
}

/**
 * One-row SELECT producing every KpiTotals column for [startParam, endParam).
 * `filterSql` is the output of ridesFilterSql (or '').
 */
export function kpiTotalsSql(startParam: string, endParam: string, filterSql = ''): string {
  return `
    SELECT
      (SELECT COALESCE(SUM(p.amount), 0)
         FROM rides r JOIN payments p ON p.ride_id = r.id AND p.status = 'completed'
        WHERE r.status = 'completed'
          AND r.completed_at >= ${startParam} AND r.completed_at < ${endParam} ${filterSql}
      )::numeric AS gross_bookings,
      (SELECT COALESCE(SUM(p.commission_amount), 0)
         FROM rides r JOIN payments p ON p.ride_id = r.id AND p.status = 'completed'
        WHERE r.status = 'completed'
          AND r.completed_at >= ${startParam} AND r.completed_at < ${endParam} ${filterSql}
      )::numeric AS commission,
      (SELECT COUNT(*) FROM rides r
        WHERE r.status = 'completed'
          AND r.completed_at >= ${startParam} AND r.completed_at < ${endParam} ${filterSql}
      )::int AS completed_rides,
      (SELECT COUNT(DISTINCT r.driver_id) FROM rides r
        WHERE r.status = 'completed'
          AND r.completed_at >= ${startParam} AND r.completed_at < ${endParam} ${filterSql}
      )::int AS active_drivers,
      (SELECT COUNT(*) FROM rides r
        WHERE r.status = 'completed'
          AND r.requested_at >= ${startParam} AND r.requested_at < ${endParam} ${filterSql}
      )::int AS cohort_completed,
      (SELECT COUNT(*) FROM rides r
        WHERE r.status = 'cancelled'
          AND r.requested_at >= ${startParam} AND r.requested_at < ${endParam} ${filterSql}
      )::int AS cohort_cancelled`
}

export function parseKpiTotals(row: Record<string, unknown> | undefined): KpiTotals {
  const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))
  return {
    gross_bookings: n(row?.['gross_bookings']),
    commission: n(row?.['commission']),
    completed_rides: n(row?.['completed_rides']),
    active_drivers: n(row?.['active_drivers']),
    cohort_completed: n(row?.['cohort_completed']),
    cohort_cancelled: n(row?.['cohort_cancelled']),
  }
}

/** completed / (completed + cancelled) among rides requested in the range; 0 when none. */
export function completionRate(t: Pick<KpiTotals, 'cohort_completed' | 'cohort_cancelled'>): number {
  const d = t.cohort_completed + t.cohort_cancelled
  return d === 0 ? 0 : t.cohort_completed / d
}

/** cancelled / (completed + cancelled) among rides requested in the range; 0 when none. */
export function cancellationRate(t: Pick<KpiTotals, 'cohort_completed' | 'cohort_cancelled'>): number {
  const d = t.cohort_completed + t.cohort_cancelled
  return d === 0 ? 0 : t.cohort_cancelled / d
}

/** commission / gross bookings; 0 when there is no gross. */
export function takeRate(t: Pick<KpiTotals, 'gross_bookings' | 'commission'>): number {
  return t.gross_bookings === 0 ? 0 : t.commission / t.gross_bookings
}
