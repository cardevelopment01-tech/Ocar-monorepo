import { describe, it, expect, vi } from 'vitest'

const audit = vi.hoisted(() => ({ recordAuditLog: vi.fn(async () => undefined) }))
vi.mock('@/lib/audit-log', () => audit)
import { collectRows, sendCsvExport, EXPORT_MAX_ROWS } from '@/lib/csv-export'

function fakeRes() {
  const r = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn(), send: vi.fn() }
  r.status.mockReturnValue(r)
  return r
}
const req = { admin: { id: 7n } } as never
const columns = [{ header: 'N', value: (r: { n: number }) => r.n }]

describe('collectRows', () => {
  it('pages through a list until a short page and returns every row', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i)
    const calls: number[] = []
    const out = await collectRows(async (limit, offset) => { calls.push(offset); return all.slice(offset, offset + limit) })
    expect(out).toHaveLength(2500)
    expect(calls).toEqual([0, 1000, 2000])
  })

  it('stops one row past the cap, so the caller can tell the result was too big', async () => {
    const out = await collectRows(async (limit) => Array.from({ length: limit }, () => 1))
    expect(out).toHaveLength(EXPORT_MAX_ROWS + 1)
  })

  it('an empty list is an empty result', async () => {
    expect(await collectRows(async () => [])).toEqual([])
  })
})

describe('sendCsvExport', () => {
  it('refuses a result over the cap with 422 and writes no audit row or file', async () => {
    const res = fakeRes()
    audit.recordAuditLog.mockClear()
    await sendCsvExport(req, res as never, { entity: 'x', targetTable: 't', filters: {}, columns, rows: Array.from({ length: EXPORT_MAX_ROWS + 1 }, (_, n) => ({ n })) })
    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.json.mock.calls[0]![0].code).toBe('EXPORT_TOO_LARGE')
    expect(res.send).not.toHaveBeenCalled()
    expect(audit.recordAuditLog).not.toHaveBeenCalled()
  })

  it('sends the CSV, the row count header, and audits "<entity>.export"', async () => {
    const res = fakeRes()
    audit.recordAuditLog.mockClear()
    await sendCsvExport(req, res as never, { entity: 'x', targetTable: 't', filters: { a: 1 }, columns, rows: [{ n: 1 }, { n: 2 }] })
    expect(res.setHeader).toHaveBeenCalledWith('X-Export-Rows', '2')
    expect(res.send.mock.calls[0]![0]).toContain('N\r\n1\r\n2')
    expect(audit.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'x.export', afterState: { filters: { a: 1 }, rows: 2 } }))
  })
})

describe('exportPhone', () => {
  it('writes an Indian mobile as text a spreadsheet will not turn into a formula or 9.19E+11', async () => {
    const { exportPhone } = await import('@/lib/csv-export')
    const { toCsv } = await import('@/modules/analytics/csv')
    expect(exportPhone('+919700000001')).toBe('91 9700000001')
    expect(toCsv(['P'], [[exportPhone('+919700000001')]])).toContain('\r\n91 9700000001\r\n')
    expect(exportPhone(null)).toBe('')
    expect(exportPhone('12345')).toBe('12345')
  })
})

describe('exportMoney', () => {
  it('keeps a negative amount a number, so it is not prefixed with an apostrophe and still sums', async () => {
    const { exportMoney } = await import('@/lib/csv-export')
    const { toCsv } = await import('@/modules/analytics/csv')
    expect(exportMoney('-12.50')).toBe(-12.5)
    expect(toCsv(['A'], [[exportMoney('-12.50')]])).toContain('-12.5')
    expect(exportMoney(null)).toBe('')
    expect(exportMoney('abc')).toBe('')
  })
})
