// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const http = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../api', () => ({ default: http }))
import { downloadCsv } from '../csv-download'

beforeEach(() => {
  http.get.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

describe('downloadCsv', () => {
  it('drops empty params, saves under the server filename and reports the row count', async () => {
    http.get.mockResolvedValue({
      data: new Blob(['a']),
      headers: { 'content-disposition': 'attachment; filename="ocar-drivers-2026-11-26.csv"', 'x-export-rows': '42' },
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const out = await downloadCsv('/x.csv', { status: 'active', search: '', city: undefined })
    expect(http.get.mock.calls[0]![1].params).toEqual({ status: 'active' })
    expect(out).toEqual({ filename: 'ocar-drivers-2026-11-26.csv', rows: 42 })
    expect(click).toHaveBeenCalledOnce()
  })

  it('turns a refused export into the server\'s own message, even though the body is a blob', async () => {
    http.get.mockRejectedValue({ response: { status: 422, data: new Blob([JSON.stringify({ error: 'Narrow the filters.' })]) } })
    await expect(downloadCsv('/x.csv')).rejects.toThrow('Narrow the filters.')
  })

  it('explains throttling and role refusals', async () => {
    http.get.mockRejectedValueOnce({ response: { status: 429 } })
    await expect(downloadCsv('/x.csv')).rejects.toThrow(/Too many exports/)
    http.get.mockRejectedValueOnce({ response: { status: 403 } })
    await expect(downloadCsv('/x.csv')).rejects.toThrow(/cannot export/)
  })
})
