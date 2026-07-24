import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { getDriverEarningsSummary } from '@/modules/payments/submodules/settlements/settlements.service'

describe('getDriverEarningsSummary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sums cleared lines as payable balance and returns recent ledger', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ payable_balance: '860.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, entry_type: 'ride_fare_net', amount: '340.00', status: 'cleared' }] })

    const summary = await getDriverEarningsSummary(BigInt(42))
    expect(summary.payableBalance).toBe(860)
    expect(summary.recentLedger).toHaveLength(1)
  })
})
