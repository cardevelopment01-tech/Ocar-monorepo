import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))
// getConfigValue (system_config caching) reads through @/db/redis — without
// this mock it hits a real, reachable local Redis and serves a value cached
// by an earlier test/run instead of falling through to the pg mock above.
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  client: { del: vi.fn().mockResolvedValue(1) },
}))

import { getDriverEarningsSummary } from '@/modules/payments/submodules/settlements/settlements.service'

describe('getDriverEarningsSummary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sums cleared lines as payable balance and returns recent ledger', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ payable_balance: '860.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, entry_type: 'ride_fare_net', amount: '340.00', status: 'cleared' }] })
      .mockResolvedValueOnce({ rows: [{ value: 'false' }] }) // driver_payouts_enabled

    const summary = await getDriverEarningsSummary(BigInt(42))
    expect(summary.payableBalance).toBe(860)
    expect(summary.recentLedger).toHaveLength(1)
    expect(summary.payoutsEnabled).toBe(false)
  })

  it('surfaces payoutsEnabled=true once the kill switch is flipped on', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ payable_balance: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: 'true' }] })

    const summary = await getDriverEarningsSummary(BigInt(42))
    expect(summary.payoutsEnabled).toBe(true)
  })
})
