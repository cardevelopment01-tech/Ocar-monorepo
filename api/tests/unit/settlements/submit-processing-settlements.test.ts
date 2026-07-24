import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

// config is read live; the dev-mode test below overrides it per-test via vi.mock,
// same pattern as tests/unit/payments/create-ride-payment-order.test.ts.
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAYX_ACCOUNT_NUMBER: '' } }))

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

describe('submitProcessingSettlements (live gateway, keys configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.doMock('@/config', () => ({
      config: {
        RAZORPAY_KEY_ID: 'rzp_test_live',
        RAZORPAY_KEY_SECRET: 'secret',
        RAZORPAYX_ACCOUNT_NUMBER: '2323230012345678',
      },
    }))
    vi.doMock('@/db/client', () => ({
      pool: { query: (...args: unknown[]) => poolQuery(...args) },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('success: claims the row, submits to the gateway, stores the real payout id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'pout_123' }) })
    vi.stubGlobal('fetch', fetchMock)
    poolQuery
      .mockResolvedValueOnce({ rows: [{ id: '901', driver_id: '42', net_payout: '850.00' }] }) // SELECT processing
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // claim UPDATE (placeholder)
      .mockResolvedValueOnce({ rows: [{ gateway_fund_account_id: 'fa_1' }] }) // bank account lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements with real payout id

    const { submitProcessingSettlements: submit } = await import(
      '@/modules/payments/submodules/settlements/settlements.service'
    )
    await submit()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.razorpay.com/v1/payouts')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Authorization']).toMatch(/^Basic /)
    expect(opts.headers['X-Payout-Idempotency']).toBe('901:42')
    const body = JSON.parse(opts.body)
    expect(body.account_number).toBe('2323230012345678')
    expect(body.fund_account_id).toBe('fa_1')
    expect(body.amount).toBe(85000)

    const finalUpdate = poolQuery.mock.calls[3]
    expect(finalUpdate[0]).toContain('UPDATE settlements SET razorpay_payout_id = $2')
    expect(finalUpdate[1]).toEqual(['901', 'pout_123'])
  })

  it('failure: reverts settlement to failed with razorpay_payout_id cleared, and earnings back to cleared', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'Invalid fund account' })
    vi.stubGlobal('fetch', fetchMock)
    poolQuery
      .mockResolvedValueOnce({ rows: [{ id: '901', driver_id: '42', net_payout: '850.00' }] }) // SELECT processing
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // claim UPDATE (placeholder)
      .mockResolvedValueOnce({ rows: [{ gateway_fund_account_id: 'fa_1' }] }) // bank account lookup
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements failed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE driver_earnings reverted

    const { submitProcessingSettlements: submit } = await import(
      '@/modules/payments/submodules/settlements/settlements.service'
    )
    await submit()

    const failUpdate = poolQuery.mock.calls[3]
    expect(failUpdate[0]).toContain("status = 'failed'")
    expect(failUpdate[0]).toContain('razorpay_payout_id = NULL')
    expect(failUpdate[1][0]).toBe('901')
    expect(failUpdate[1][1]).toContain('Invalid fund account')

    const earningsRevert = poolQuery.mock.calls[4]
    expect(earningsRevert[0]).toContain("status = 'cleared'")
    expect(earningsRevert[0]).toContain('settlement_id = NULL')
    expect(earningsRevert[1]).toEqual(['901'])
  })
})
