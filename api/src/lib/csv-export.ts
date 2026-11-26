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
