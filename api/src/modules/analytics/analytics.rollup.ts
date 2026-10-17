// Rollup reads for the Reports / Analytics pages (migration 117). Days before the last refresh come from the pre-aggregated
// `rpt_*` views; the days since (normally just today) come from the raw queries in analytics.repository.ts, so the numbers
// stay live. Anything the views cannot answer (a filter they have no column for) falls back to the raw queries, and any
// problem reading the views falls back too: the rollups can only make a report faster, never different.
import { analyticsPool } from '@/db/client'
import type { QueryResultRow } from 'pg'
import { logger } from '@/lib/logger'
import { istDateOf, istDayStartUtc, type KpiFilters, type TimeRange } from './kpi-definitions'

export const ROLLUP_VIEWS = ['rpt_completed', 'rpt_driver', 'rpt_requested', 'rpt_heat', 'rpt_cancel', 'rpt_driver_req', 'rpt_offers'] as const

// ── cutoff ───────────────────────────────────────────────────────────────────
// IST date of the last refresh START. Every IST day before it was over when that refresh began, so the views hold it in full.
let cutoffCache: { value: string | null; at: number } | null = null
const CUTOFF_TTL_MS = 30_000

export function resetRollupCutoffCache(): void { cutoffCache = null }

export async function getRollupCutoffDate(now: number = Date.now()): Promise<string | null> {
  if (cutoffCache && now - cutoffCache.at < CUTOFF_TTL_MS) return cutoffCache.value
  let value: string | null = null
  try {
    const res = await analyticsPool.query<{ refreshed_at: Date }>('SELECT refreshed_at FROM rpt_rollup_meta WHERE id = 1')
    if (res.rows[0]) value = istDateOf(res.rows[0].refreshed_at)
  } catch (err) {
    logger.warn({ err }, 'report rollups unavailable, using raw queries')
  }
  cutoffCache = { value, at: now }
  return value
}

export interface RangeSplit {
  /** IST dates, [fromDay, toDay): read from the views */
  rollup: { fromDay: string; toDay: string; range: TimeRange } | null
  /** read from the raw tables */
  live: TimeRange | null
}

export function splitRange(range: TimeRange, cutoffDate: string | null): RangeSplit {
  if (cutoffDate === null) return { rollup: null, live: range }
  const rollupEnd = new Date(Math.min(range.end.getTime(), istDayStartUtc(cutoffDate).getTime()))
  if (rollupEnd.getTime() <= range.start.getTime()) return { rollup: null, live: range }
  const rollupRange = { start: range.start, end: rollupEnd }
  const live = rollupEnd.getTime() < range.end.getTime() ? { start: rollupEnd, end: range.end } : null
  return { rollup: { fromDay: istDateOf(range.start), toDay: istDateOf(rollupEnd), range: rollupRange }, live }
}

// ── filters the views support ────────────────────────────────────────────────
export const hasFilters = (f?: KpiFilters): boolean => !!f && ((f.cityIds && f.cityIds.length > 0) || f.categoryId !== undefined)
export const hasCategory = (f?: KpiFilters): boolean => f?.categoryId !== undefined

/** SQL on a view with city_id / category_id columns; placeholders start at `firstParam`. */
export function viewFilterSql(f: KpiFilters | undefined, firstParam: number, opts: { city?: boolean; category?: boolean } = { city: true, category: true }): { sql: string; params: unknown[] } {
  const parts: string[] = []
  const params: unknown[] = []
  if (opts.city !== false && f?.cityIds && f.cityIds.length > 0) {
    params.push(f.cityIds)
    parts.push(`AND city_id = ANY($${firstParam + params.length - 1}::bigint[])`)
  }
  if (opts.category !== false && f?.categoryId !== undefined) {
    params.push(f.categoryId)
    parts.push(`AND category_id = $${firstParam + params.length - 1}`)
  }
  return { sql: parts.join(' '), params }
}

// ── query helper (same pattern as analyticsQuery: its own pool, raised timeout, read-only intent) ──
export async function rollupQuery<T extends QueryResultRow>(text: string, params: unknown[], timeoutMs = 60_000): Promise<T[]> {
  const client = await analyticsPool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`)
    const res = await client.query<T>(text, params)
    await client.query('COMMIT')
    return res.rows
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    client.release()
  }
}

/** Run the rollup-aware path; on ANY error use the raw path instead (and say so once per failure). */
export async function withRawFallback<T>(name: string, rollupPath: () => Promise<T>, rawPath: () => Promise<T>): Promise<T> {
  try {
    return await rollupPath()
  } catch (err) {
    logger.warn({ err, report: name }, 'report rollup path failed, using raw queries')
    return rawPath()
  }
}
