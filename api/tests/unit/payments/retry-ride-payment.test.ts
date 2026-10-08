import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { PAYU_KEY: 'testkey', PAYU_SALT: 'testsalt', PAYU_ENV: 'test', API_BASE_URL: 'https://api.example' } }))

vi.mock('@/lib/payu', async (orig) => ({
  ...(await orig<typeof import('@/lib/payu')>()),
  fetchPayuStatus: vi.fn(),
  payuConfigured: vi.fn(() => true),
}))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'
import * as payu from '@/lib/payu'

// Route pool.query by SQL fragment so tests don't depend on call ordering.
// `payment` is the row returned by the initial `SELECT ... FROM payments`.
function mockPool(payment: Record<string, unknown>) {
  vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
    const sql = text as string
    if (sql.startsWith('SELECT user_id, channel, status, amount')) return { rows: [payment], rowCount: 1 } as never
    if (sql.includes("SET status='pending'")) return { rows: [], rowCount: 1 } as never       // reset UPDATE
    if (sql.includes('FROM users')) return { rows: [{ name: 'Asha', email: null, phone: '9999999999' }], rowCount: 1 } as never
    if (sql.includes('gateway_txn_id')) return { rows: [], rowCount: 1 } as never               // txn id write
    if (sql.includes('system_config')) return { rows: [], rowCount: 0 } as never                // getConfigValue → fallback
    return { rows: [], rowCount: 0 } as never
  })
}

// client.query (pool.connect) drives payFromUserWallet / confirmRidePayment's
// shared-transaction flip + deductCommission + creditCashback — same fake
// client instance every time pool.connect() is called, matched by SQL shape.
function mockClient(balance: string) {
  client.query.mockReset()
  client.query.mockImplementation(async (text: unknown) => {
    const sql = text as string
    if (sql.includes('FROM user_wallets') && sql.includes('FOR UPDATE')) return { rows: [{ id: 5, balance }], rowCount: 1 } as never
    if (sql.includes('FROM driver_wallets') && sql.includes('FOR UPDATE')) return { rows: [{ id: 7, balance: '10000', is_frozen: false }], rowCount: 1 } as never
    if (sql.includes("entry_type = 'ride_debit'")) return { rows: [], rowCount: 0 } as never    // dedupe check
    if (sql.includes("SET status = 'completed'")) return { rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 } as never
    if (sql.includes('billing_mode_snapshot')) return { rows: [{ billing_mode_snapshot: null }], rowCount: 1 } as never
    return { rows: [], rowCount: 0 } as never
  })
}

describe('retryRidePayment', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(payu.payuConfigured).mockReturnValue(true) })

  it('online: resets the row and mints a fresh PayU form', async () => {
    mockPool({ user_id: 42, channel: 'payu_online', status: 'failed', amount: '500.00' })
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status='pending'"))).toBe(true)
    expect(result).toEqual({ channel: 'online', order: { payu: expect.objectContaining({ action: expect.any(String) }), amount: 500 } })
  })

  it('legacy razorpay_online row retried: still returns a PayU order', async () => {
    mockPool({ user_id: 42, channel: 'razorpay_online', status: 'failed', amount: '500.00' })
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(result).toEqual({ channel: 'online', order: { payu: expect.objectContaining({ action: expect.any(String) }), amount: 500 } })
  })

  it('wallet with enough balance → debits, confirms, returns paid:true', async () => {
    mockPool({ user_id: 42, channel: 'platform_wallet', status: 'failed', amount: '500.00' })
    mockClient('1000.00')
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(result).toEqual({ channel: 'wallet', paid: true })
    expect(client.query.mock.calls.some(c => (c[0] as string).includes("SET status = 'completed'"))).toBe(true)
  })

  it('wallet still insufficient → returns paid:false, does not confirm', async () => {
    mockPool({ user_id: 42, channel: 'platform_wallet', status: 'failed', amount: '500.00' })
    mockClient('100.00')
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(result).toEqual({ channel: 'wallet', paid: false })
    expect(vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status = 'completed'"))).toBe(false)
  })

  it('rejects a payment owned by a different user', async () => {
    mockPool({ user_id: 99, channel: 'razorpay_online', status: 'failed', amount: '500.00' })
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('rejects a cash-channel payment', async () => {
    mockPool({ user_id: 42, channel: 'cash_direct', status: 'pending', amount: '500.00' })
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects an already-completed payment', async () => {
    mockPool({ user_id: 42, channel: 'razorpay_online', status: 'completed', amount: '500.00' })
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 400 })
  })
})

describe('retryRidePayment — previous PayU txn still in flight', () => {
  const inFlight = { user_id: 42, channel: 'payu_online', status: 'pending', amount: '500.00', gateway: 'payu', gateway_txn_id: 'R101xold' }
  const resetIssued = () => vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status='pending'"))
  const status = (state: 'captured' | 'failed' | 'pending' | 'unknown') =>
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue({ state, amountPaise: state === 'captured' ? 50000 : 0, mihpayid: null })

  beforeEach(() => { vi.clearAllMocks(); vi.mocked(payu.payuConfigured).mockReturnValue(true) })

  it('captured → 409, row untouched, no new form', async () => {
    mockPool(inFlight); status('captured')
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 409, message: 'Payment is already being confirmed' })
    expect(payu.fetchPayuStatus).toHaveBeenCalledWith('R101xold')
    expect(resetIssued()).toBe(false)
  })

  it('pending → 409 "still being processed", row untouched', async () => {
    mockPool(inFlight); status('pending')
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({
      httpStatus: 409, message: 'Your previous payment is still being processed. Please wait a few minutes.',
    })
    expect(resetIssued()).toBe(false)
  })

  it.each(['failed', 'unknown'] as const)('%s → proceeds with the retry', async (state) => {
    mockPool({ ...inFlight, status: 'failed' }); status(state)
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(resetIssued()).toBe(true)
    expect(result).toMatchObject({ channel: 'online', order: { amount: 500 } })
  })

  it('PayU status fetch throws → 503 (fail closed), row untouched', async () => {
    mockPool(inFlight); vi.mocked(payu.fetchPayuStatus).mockRejectedValue(new Error('timeout'))
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({
      httpStatus: 503, message: 'Could not check your previous payment. Please try again shortly.',
    })
    expect(resetIssued()).toBe(false)
  })

  it('legacy razorpay_online row (no gateway txn) is not checked', async () => {
    mockPool({ user_id: 42, channel: 'razorpay_online', status: 'failed', amount: '500.00', gateway: null, gateway_txn_id: null })
    await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(payu.fetchPayuStatus).not.toHaveBeenCalled()
    expect(resetIssued()).toBe(true)
  })

  it('wallet channel is not checked', async () => {
    mockPool({ user_id: 42, channel: 'platform_wallet', status: 'failed', amount: '500.00', gateway: null, gateway_txn_id: null })
    mockClient('1000.00')
    expect(await svc.retryRidePayment(BigInt(101), BigInt(42))).toEqual({ channel: 'wallet', paid: true })
    expect(payu.fetchPayuStatus).not.toHaveBeenCalled()
  })

  it('no PayU keys (dev) skips the check', async () => {
    vi.mocked(payu.payuConfigured).mockReturnValue(false)
    mockPool({ ...inFlight, status: 'failed' })
    await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(payu.fetchPayuStatus).not.toHaveBeenCalled()
    expect(resetIssued()).toBe(true)
  })
})
