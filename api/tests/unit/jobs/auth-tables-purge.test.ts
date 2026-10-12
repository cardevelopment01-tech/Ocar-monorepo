import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }))

import { processPurgeAuthTables } from '@/jobs/processors/auth-tables-purge.processor'

describe('processPurgeAuthTables', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('purges refresh_tokens and otp_requests in bounded batches', async () => {
    poolQuery.mockResolvedValue({ rowCount: 3 })
    await processPurgeAuthTables()
    const sqls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('DELETE FROM refresh_tokens'))).toBe(true)
    expect(sqls.some(s => s.includes('DELETE FROM otp_requests'))).toBe(true)
    expect(sqls.every(s => s.includes('LIMIT'))).toBe(true) // never an unbounded DELETE
  })

  it('keeps going while full batches come back, then stops', async () => {
    poolQuery
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 10 }) // refresh_tokens done after 3 batches
      .mockResolvedValue({ rowCount: 0 })
    await processPurgeAuthTables()
    const refreshCalls = poolQuery.mock.calls.filter(c => (c[0] as string).includes('refresh_tokens')).length
    expect(refreshCalls).toBe(3)
  })

  it('keeps revoked tokens long enough for reuse detection (30 days) and expired ones for a week', async () => {
    poolQuery.mockResolvedValue({ rowCount: 0 })
    await processPurgeAuthTables()
    const call = poolQuery.mock.calls.find(c => (c[0] as string).includes('refresh_tokens'))!
    expect(call[1]).toEqual([7, 30, 5000])
  })
})
