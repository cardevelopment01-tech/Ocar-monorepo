import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { approveSettlementPeriod, placeDriverPayoutHold, createManualAdjustment } from '@/modules/payments/submodules/settlements/settlements.service'

describe('admin settlement controls', () => {
  beforeEach(() => vi.clearAllMocks())

  it('approveSettlementPeriod bulk-flips pending -> processing for one period', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 4 })
    const count = await approveSettlementPeriod('2026-07-23', '2026-07-24', BigInt(1))
    expect(count).toBe(4)
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = 'processing'")
  })

  it('placeDriverPayoutHold requires a reason and records the admin', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await placeDriverPayoutHold(BigInt(42), 'fraud review', BigInt(1))
    const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO driver_payout_holds')
    expect(params).toContain('fraud review')
  })

  it('createManualAdjustment inserts a signed, reasoned earnings line', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    await createManualAdjustment(BigInt(42), 100, 'goodwill credit', BigInt(1))
    const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('adjustment')
    expect(params).toContain(100)
  })
})
