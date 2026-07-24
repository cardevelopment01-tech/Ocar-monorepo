import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' } }))

import { submitProcessingSettlements } from '@/modules/payments/submodules/settlements/settlements.service'

describe('submitProcessingSettlements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dev mode (no Razorpay keys): marks each queued settlement completed directly', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ id: '901', driver_id: '42', net_payout: '850.00' }] }) // SELECT processing
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements completed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE driver_earnings paid

    await submitProcessingSettlements()

    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes("UPDATE settlements") && s.includes("'completed'"))).toBe(true)
    expect(calls.some(s => s.includes("UPDATE driver_earnings") && s.includes("'paid'"))).toBe(true)
  })
})
