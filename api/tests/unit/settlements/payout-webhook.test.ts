import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({
  accrueDriverEarning: vi.fn(),
}))

import { handleWebhookEvent } from '@/modules/payments/payments.service'

describe('handleWebhookEvent — payout events', () => {
  beforeEach(() => vi.clearAllMocks())

  it('payout.processed: marks settlement completed and its earnings lines paid', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] }) // dedup check (no existing gateway event)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert gateway event log
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE driver_earnings

    await handleWebhookEvent({
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_1', reference_id: '901:42', utr: 'UTR123' } } },
    })

    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE settlements') && s.includes("'completed'"))).toBe(true)
    expect(calls.some(s => s.includes('UPDATE driver_earnings') && s.includes("'paid'"))).toBe(true)
  })

  it('payout.failed: reverts earnings lines to cleared', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements failed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE driver_earnings cleared

    await handleWebhookEvent({
      event: 'payout.failed',
      payload: { payout: { entity: { id: 'pout_2', reference_id: '902:43', failure_reason: 'invalid account' } } },
    })

    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE settlements') && s.includes("'failed'"))).toBe(true)
    expect(calls.some(s => s.includes('UPDATE driver_earnings') && s.includes("'cleared'"))).toBe(true)
  })

  it('payout.processed: UPDATE settlements binds the gateway payout id alongside settlement id', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] }) // dedup check
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert gateway event log
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE driver_earnings

    await handleWebhookEvent({
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_1', reference_id: '901:42', utr: 'UTR123' } } },
    })

    const updateSettlementsCall = poolQuery.mock.calls.find(
      c => (c[0] as string).includes('UPDATE settlements') && (c[0] as string).includes("'completed'")
    )
    expect(updateSettlementsCall).toBeDefined()
    expect(updateSettlementsCall![0]).toContain('razorpay_payout_id')
    expect(updateSettlementsCall![1]).toContain('pout_1')
  })

  it('malformed reference_id on payout.processed: returns early without touching the dedup/insert/update sequence', async () => {
    await handleWebhookEvent({
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_3', reference_id: 'not-a-number:42', utr: 'UTR999' } } },
    })

    expect(poolQuery).not.toHaveBeenCalled()
  })

  it('missing reference_id on payout.processed: returns early without touching the dedup/insert/update sequence', async () => {
    await handleWebhookEvent({
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_4', utr: 'UTR000' } } },
    })

    expect(poolQuery).not.toHaveBeenCalled()
  })
})
