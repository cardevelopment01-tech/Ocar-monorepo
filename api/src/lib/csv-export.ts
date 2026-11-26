import type { Request, Response } from 'express'
import { toCsv } from '@/modules/analytics/csv'
import { recordAuditLog } from '@/lib/audit-log'

// One place every admin list export goes through: same cap, same headers, same audit row.
export const EXPORT_MAX_ROWS = 20_000

export interface CsvColumn<T> {
  header: string
  value: (row: T) => unknown
}

export function exportDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/** Money arrives from pg as text. A negative one (refund, adjustment) would get the formula guard's ' prefix and stop summing, so send a number. */
export function exportMoney(v: unknown): number | '' {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? n : ''
}

/**
 * "+919700000001" -> "91 9700000001". A cell that starts with "+" is guarded against spreadsheet formulas (it would read
 * "'+91..."), and a bare 12-digit number turns into 9.19700E+11 in Excel. With the plus dropped and a space after the
 * country code it stays text, shows as written and cannot run as a formula.
 */
export function exportPhone(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const s = String(v)
  const m = /^\+(\d{1,3})(\d{10})$/.exec(s)
  return m ? `${m[1]} ${m[2]}` : s
}

/**
 * Sends `rows` as a CSV download and writes an audit row (`<entity>.export`) with the filters and row count.
 * Callers fetch at most EXPORT_MAX_ROWS + 1 rows: a longer result is refused with 422 instead of silently cut short.
 */
export async function sendCsvExport<T>(
  req: Request,
  res: Response,
  opts: { entity: string; targetTable: string; filters: Record<string, unknown>; columns: CsvColumn<T>[]; rows: T[] },
): Promise<void> {
  if (opts.rows.length > EXPORT_MAX_ROWS) {
    res.status(422).json({
      error: `More than ${EXPORT_MAX_ROWS.toLocaleString('en-IN')} rows match. Narrow the filters and try again.`,
      code: 'EXPORT_TOO_LARGE',
    })
    return
  }
  const csv = toCsv(opts.columns.map(c => c.header), opts.rows.map(r => opts.columns.map(c => c.value(r))))
  await recordAuditLog({
    adminId: req.admin!.id,
    action: `${opts.entity}.export`,
    targetTable: opts.targetTable,
    afterState: { filters: opts.filters, rows: opts.rows.length },
  })
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="ocar-${opts.entity}-${new Date().toISOString().slice(0, 10)}.csv"`)
  res.setHeader('X-Export-Rows', String(opts.rows.length))
  res.send(csv)
}

/**
 * Collects up to EXPORT_MAX_ROWS + 1 rows from a paged list query (so an over-cap result is detected, not cut), reusing the
 * list's own repository function: the file always means exactly what the screen means by its filters.
 */
export async function collectRows<T>(fetchPage: (limit: number, offset: number) => Promise<T[]>): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  while (out.length <= EXPORT_MAX_ROWS) {
    const page = await fetchPage(Math.min(PAGE, EXPORT_MAX_ROWS + 1 - out.length), out.length)
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}
