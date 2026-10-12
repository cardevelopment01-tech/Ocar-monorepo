import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({
  accrueDriverEarning: vi.fn(),
  mapPayoutFailureCode: (raw?: string | null) => (raw ? 'PAYOUT_FAILED' : 'PAYOUT_FAILED'),
}))

import { handleWebhookEvent } from '@/modules/payments/payments.service'

describe('handleWebhookEvent — payout events', () => {
  beforeEach(() => vi.clearAllMocks())

  it('payout.processed: marks settlement completed and its earnings lines paid', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert gateway event log (RETURNING)
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
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert gateway event log (RETURNING)
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
    expect(updateSettlementsCall![1]).toEqual(['901', 'UTR123', 'pout_1'])
  })

  it('payout.processed: settlement id parses fine but does not match razorpay_payout_id — driver_earnings must NOT be touched', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert gateway event log (RETURNING)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE settlements — WHERE clause matched nothing

    await handleWebhookEvent({
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_mismatch', reference_id: '901:42', utr: 'UTR123' } } },
    })

    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE driver_earnings'))).toBe(false)
    expect(poolQuery).toHaveBeenCalledTimes(3)
  })

  it('payout.failed: settlement id parses fine but does not match razorpay_payout_id — driver_earnings must NOT be touched', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert gateway event log (RETURNING)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // UPDATE settlements — WHERE clause matched nothing

    await handleWebhookEvent({
      event: 'payout.failed',
      payload: { payout: { entity: { id: 'pout_mismatch2', reference_id: '902:43', failure_reason: 'invalid account' } } },
    })

    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE driver_earnings'))).toBe(false)
    expect(poolQuery).toHaveBeenCalledTimes(3)
  })

  it('dedups per (entity id, event): payout.processed then payout.reversed for one payout are BOTH applied', async () => {
    const keys: string[] = []
    poolQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      if ((sql as string).includes('INSERT INTO payment_gateway_events')) {
        const key = (params as string[])[1]!
        keys.push(key)
        return { rows: [{ id: keys.length }], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    })

    await handleWebhookEvent({
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_9', reference_id: '905:42', utr: 'UTR9' } } },
    })
    await handleWebhookEvent({
      event: 'payout.reversed',
      payload: { payout: { entity: { id: 'pout_9', reference_id: '905:42', failure_reason: 'reversed' } } },
    })

    expect(keys).toEqual(['pout_9:payout.processed', 'pout_9:payout.reversed'])
    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE settlements') && s.includes("'failed'"))).toBe(true)
  })

  it('a handler that throws leaves the event UNPROCESSED so the gateway retry runs it again', async () => {
    let inserted = false
    poolQuery.mockImplementation(async (sql: unknown) => {
      const q = sql as string
      if (q.includes('INSERT INTO payment_gateway_events')) {
        if (inserted) return { rows: [], rowCount: 0 } // second delivery hits the unique key
        inserted = true
        return { rows: [{ id: 1 }], rowCount: 1 }
      }
      if (q.includes('SELECT processed')) return { rows: [{ processed: false }], rowCount: 1 }
      if (q.includes('UPDATE settlements') && inserted && !q.includes('retried')) {
        throw new Error('db blip')
      }
      return { rows: [], rowCount: 1 }
    })
    const evt = { event: 'payout.processed', payload: { payout: { entity: { id: 'pout_7', reference_id: '907:42', utr: 'U' } } } }

    await expect(handleWebhookEvent(evt)).rejects.toThrow('db blip')
    const markedProcessed = poolQuery.mock.calls.some(c => (c[0] as string).includes('SET processed = true'))
    expect(markedProcessed).toBe(false)
  })

  it('a duplicate delivery of an already-PROCESSED event does nothing', async () => {
    poolQuery.mockImplementation(async (sql: unknown) => {
      const q = sql as string
      if (q.includes('INSERT INTO payment_gateway_events')) return { rows: [], rowCount: 0 }
      if (q.includes('SELECT processed')) return { rows: [{ processed: true }], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    })
    await handleWebhookEvent({
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_8', reference_id: '908:42', utr: 'U' } } },
    })
    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE settlements'))).toBe(false)
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
