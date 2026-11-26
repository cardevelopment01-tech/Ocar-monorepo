// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const me = vi.hoisted(() => ({ role: 'ops_admin' as string | null }))
vi.mock('../auth-context', () => ({ useAdminAuth: () => ({ admin: me.role ? { role: me.role } : null }) }))
const dl = vi.hoisted(() => ({ downloadCsv: vi.fn() }))
vi.mock('../csv-download', () => dl)
import { useCsvExport, OPS_ROLES, FINANCE_ROLES } from '../use-csv-export'

describe('useCsvExport', () => {
  it('allows only the roles the server allows (and nobody before the admin has loaded)', () => {
    me.role = 'ops_admin'
    expect(renderHook(() => useCsvExport('/x', OPS_ROLES)).result.current.allowed).toBe(true)
    expect(renderHook(() => useCsvExport('/x', FINANCE_ROLES)).result.current.allowed).toBe(false)
    me.role = null
    expect(renderHook(() => useCsvExport('/x', OPS_ROLES)).result.current.allowed).toBe(false)
  })

  it('reports the row count with a correct plural, and the note', async () => {
    me.role = 'ops_admin'
    const { result } = renderHook(() => useCsvExport('/x', OPS_ROLES))
    dl.downloadCsv.mockResolvedValueOnce({ filename: 'a.csv', rows: 2 })
    await act(() => result.current.run({}, 'batch'))
    expect(result.current.result?.text).toMatch(/^Exported 2 batches\./)
    dl.downloadCsv.mockResolvedValueOnce({ filename: 'a.csv', rows: 1 })
    await act(() => result.current.run({}, 'ride', 'last 30 days'))
    expect(result.current.result?.text).toMatch(/^Exported 1 ride \(last 30 days\)\./)
  })

  it('shows the error and clears the busy flag when the download fails', async () => {
    me.role = 'ops_admin'
    const { result } = renderHook(() => useCsvExport('/x', OPS_ROLES))
    dl.downloadCsv.mockRejectedValueOnce(new Error('Too many exports. Wait a minute and try again.'))
    await act(() => result.current.run())
    expect(result.current.result).toEqual({ ok: false, text: 'Too many exports. Wait a minute and try again.' })
    expect(result.current.exporting).toBe(false)
  })
})
