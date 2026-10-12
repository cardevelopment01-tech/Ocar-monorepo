import { describe, it, expect, vi, beforeEach } from 'vitest'

// confirmRidePayment's status flip now runs on a pool.connect() transaction
// client (single-txn settlement refactor), not directly on pool.query.
const fakeClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyRidePaymentFailed: vi.fn() }))
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn, error: vi.fn() }) } }))

vi.mock('@/lib/payu', async (orig) => ({
  ...(await orig<typeof import('@/lib/payu')>()),
  fetchPayuStatus: vi.fn(),
  payuConfigured: vi.fn(() => true),
}))

const fetchPayments = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: vi.fn(), fetchPayments }; payments = { fetch: vi.fn() } },
}))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'
import * as payu from '@/lib/payu'
import { notifyRidePaymentFailed } from '@/modules/notifications/notifications.service'

// NOTE: vi.spyOn(svc, 'confirmRidePayment') does NOT intercept confirmRidePayment
// being called internally from reconcilePendingRidePayments (both live in the same
// module file). Instead of trusting a spy, we assert on the real side effect: the
// guarded `UPDATE payments SET status = 'completed' ... WHERE status = 'pending'`
// that confirmRidePayment issues via pool.query.
describe('reconcilePendingRidePayments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never)
  })

  function confirmingUpdateWasIssued(): boolean {
    return fakeClient.query.mock.calls.some(
      (c) => (c[0] as string).includes("SET status = 'completed'")
    )
  }

  it('captured on recheck → confirms, does not notify failure', async () => {
    vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
      const sql = text as string
      if (sql.includes("WHERE status = 'pending'") && sql.includes('razorpay_order_id IS NOT NULL')) {
        return { rows: [{ ride_id: 101, razorpay_order_id: 'order_1', user_id: 42, amount: '500.00' }], rowCount: 1 } as never
      }
      return { rows: [], rowCount: 0 } as never
    })
    fakeClient.query.mockImplementation((sql: string) => {
      if (sql.includes("SET status = 'completed'")) {
        return Promise.resolve({ rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 })
      }
      if (sql.includes('billing_mode_snapshot')) {
        return Promise.resolve({ rows: [{ billing_mode_snapshot: null }], rowCount: 1 })
      }
      if (sql.includes('FROM driver_wallets') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ id: 7, balance: '1000', is_frozen: false }], rowCount: 1 })
      }
      if (sql.includes('FROM user_wallets') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ id: 5, balance: '0' }], rowCount: 1 })
      }
      return Promise.resolve({ rows: [], rowCount: 1 })
    })
    fetchPayments.mockResolvedValue({ items: [{ id: 'pay_9', status: 'captured' }] })

    await svc.reconcilePendingRidePayments()

    expect(confirmingUpdateWasIssued()).toBe(true)
    expect(notifyRidePaymentFailed).not.toHaveBeenCalled()
  })

  it('no capture after grace → marks failed and notifies the rider', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ ride_id: 101, razorpay_order_id: 'order_1', user_id: 42, amount: '500.00' }], rowCount: 1 } as never) // select pending
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never) // UPDATE ... failed (1 row changed)
    fetchPayments.mockResolvedValue({ items: [{ id: 'pay_9', status: 'failed' }] })

    await svc.reconcilePendingRidePayments()

    expect(confirmingUpdateWasIssued()).toBe(false)
    const failUpdate = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes("status = 'failed'"))
    expect(failUpdate).toBeTruthy()
    expect(failUpdate![0] as string).toContain("status = 'pending'") // guarded so a confirmed ride is untouched
    expect(notifyRidePaymentFailed).toHaveBeenCalledWith(BigInt(42), BigInt(101), 500)
  })

  it('fail-UPDATE affects 0 rows (concurrent path already confirmed) → does not notify', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ ride_id: 101, razorpay_order_id: 'order_1', user_id: 42, amount: '500.00' }], rowCount: 1 } as never) // select pending
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // UPDATE ... failed (0 rows — already confirmed elsewhere)
    fetchPayments.mockResolvedValue({ items: [{ id: 'pay_9', status: 'failed' }] })

    await svc.reconcilePendingRidePayments()

    expect(confirmingUpdateWasIssued()).toBe(false)
    const failUpdate = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes("status = 'failed'"))
    expect(failUpdate).toBeTruthy()
    expect(notifyRidePaymentFailed).not.toHaveBeenCalled()
  })
})

describe('reconcilePendingRidePayments - PayU rows', () => {
  const row = { ride_id: '101', razorpay_order_id: null, gateway: 'payu', gateway_txn_id: 'R101xabc', user_id: '5', amount: '500.00', stale_60m: false }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(payu.payuConfigured).mockReturnValue(true)
    fakeClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
  })

  const confirmed = () => fakeClient.query.mock.calls.some(c => (c[0] as string).includes("SET status = 'completed'"))
  const failedUpdate = () => vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status = 'failed'"))
  const select = (...rows: object[]) => vi.mocked(pool.query).mockResolvedValueOnce({ rows } as never)
  const status = (state: 'captured' | 'failed' | 'pending' | 'unknown', amountPaise = 0) =>
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue({ state, amountPaise, mihpayid: state === 'captured' ? '555' : null } as never)

  it('selects past the updated_at grace in random order with a limit', async () => {
    await svc.reconcilePendingRidePayments()
    const q = vi.mocked(pool.query).mock.calls[0]![0] as string
    expect(q).toContain("updated_at < now() - interval '10 minutes'")
    expect(q).not.toContain('created_at < now()')
    // random(): untouched pending/young-unknown/mismatch rows keep an old
    // updated_at and would otherwise starve newer rows forever.
    expect(q).toContain('ORDER BY random()')
    expect(q).not.toContain('ORDER BY updated_at')
    expect(q).toContain('LIMIT 50')
  })

  it('warns (count only) when the batch is full', async () => {
    select(...Array.from({ length: 50 }, (_, i) => ({ ...row, ride_id: String(200 + i) }))); status('pending')
    await svc.reconcilePendingRidePayments()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toEqual({ count: 50 })
  })

  it('does not warn for a partial batch', async () => {
    select(row); status('pending')
    await svc.reconcilePendingRidePayments()
    expect(warn).not.toHaveBeenCalled()
  })

  it('captured + matching amount confirms with gateway payu', async () => {
    select(row); status('captured', 50000)
    await svc.reconcilePendingRidePayments()
    expect(confirmed()).toBe(true)
    expect(fakeClient.query.mock.calls.some(c => (c[0] as string).includes('gateway_payment_id = $2'))).toBe(true)
  })

  it('captured + mismatching amount is never confirmed', async () => {
    select(row); status('captured', 100)
    await svc.reconcilePendingRidePayments()
    expect(confirmed()).toBe(false)
    expect(failedUpdate()).toBe(false)
  })

  it('failed at PayU fails + notifies immediately', async () => {
    select(row); status('failed')
    await svc.reconcilePendingRidePayments()
    expect(failedUpdate()).toBe(true)
    expect(notifyRidePaymentFailed).toHaveBeenCalledWith(BigInt(5), BigInt(101), 500)
  })

  it('unknown at 30 min is left alone', async () => {
    select(row); status('unknown')
    await svc.reconcilePendingRidePayments()
    expect(failedUpdate()).toBe(false)
    expect(notifyRidePaymentFailed).not.toHaveBeenCalled()
  })

  it('unknown at 90 min is failed + notified', async () => {
    select({ ...row, stale_60m: true }); status('unknown')
    await svc.reconcilePendingRidePayments()
    expect(failedUpdate()).toBe(true)
    expect(notifyRidePaymentFailed).toHaveBeenCalled()
  })

  it.each([false, true])('pending is never failed (stale=%s)', async (stale) => {
    select({ ...row, stale_60m: stale }); status('pending')
    await svc.reconcilePendingRidePayments()
    expect(failedUpdate()).toBe(false)
    expect(confirmed()).toBe(false)
  })

  it('a PayU API error on one row does not abort the sweep', async () => {
    select(row, { ...row, ride_id: '102', gateway_txn_id: 'R102xabc' })
    vi.mocked(payu.fetchPayuStatus)
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce({ state: 'failed', amountPaise: 0, mihpayid: null } as never)
    await svc.reconcilePendingRidePayments()
    expect(payu.fetchPayuStatus).toHaveBeenCalledTimes(2)
    expect(notifyRidePaymentFailed).toHaveBeenCalledWith(BigInt(5), BigInt(102), 500)
  })
})

describe('reconcilePendingPayuPurchases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(payu.payuConfigured).mockReturnValue(true)
    fakeClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
  })

  const select = (...txnIds: string[]) =>
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: txnIds.map(t => ({ gateway_txn_id: t })) } as never)
  const status = (state: 'captured' | 'failed' | 'pending' | 'unknown', amountPaise = 0) =>
    vi.mocked(payu.fetchPayuStatus).mockResolvedValue({ state, amountPaise, mihpayid: state === 'captured' ? '555' : null } as never)
  const completingUpdates = () => vi.mocked(pool.query).mock.calls.filter(c =>
    /UPDATE (wallet_topup_orders|package_purchase_orders)/.test(c[0] as string))
  const ledgerInserts = () => fakeClient.query.mock.calls.filter(c => (c[0] as string).includes('INSERT INTO driver_wallet_ledger'))

  it('selects the pending purchase/top-up union inside 10 min .. 3 days, random order, limit 50', async () => {
    await svc.reconcilePendingPayuPurchases()
    const q = vi.mocked(pool.query).mock.calls[0]![0] as string
    expect(q).toContain('FROM package_purchase_orders')
    expect(q).toContain("gateway = 'payu'")
    expect(q).toContain('gateway_txn_id IS NOT NULL')
    expect(q).toContain('FROM wallet_topup_orders')
    expect(q).toContain('UNION')
    expect(q.match(/status = 'pending'/g)).toHaveLength(2)
    expect(q.match(/created_at < now\(\) - interval '10 minutes'/g)).toHaveLength(2)
    expect(q.match(/created_at > now\(\) - interval '3 days'/g)).toHaveLength(2)
    expect(q).toContain('ORDER BY random()')
    expect(q).toContain('LIMIT 50')
    expect(payu.fetchPayuStatus).not.toHaveBeenCalled() // empty batch
  })

  it('returns early when PayU is not configured', async () => {
    vi.mocked(payu.payuConfigured).mockReturnValue(false)
    await svc.reconcilePendingPayuPurchases()
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('warns (count only) on a full batch', async () => {
    select(...Array.from({ length: 50 }, (_, i) => `W${i}xabc`)); status('pending')
    await svc.reconcilePendingPayuPurchases()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toEqual({ count: 50 })
  })

  it.each(['pending', 'failed', 'unknown'] as const)('PayU %s leaves every row untouched', async (st) => {
    select('W7xabc', 'P7xabc'); status(st)
    await svc.reconcilePendingPayuPurchases()
    expect(vi.mocked(payu.fetchPayuStatus).mock.calls.map(c => c[0])).toEqual(['W7xabc', 'P7xabc'])
    expect(completingUpdates()).toHaveLength(0)
    expect(ledgerInserts()).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a captured top-up with no Redis binding is credited from the DB row and marked completed', async () => {
    vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
      const sql = text as string
      if (sql.includes('UNION')) return { rows: [{ gateway_txn_id: 'W7xabc' }], rowCount: 1 } as never
      if (sql.includes('FROM wallet_topup_orders WHERE gateway_txn_id')) {
        return { rows: [{ driver_id: '7', amount: '500.00', status: 'pending' }], rowCount: 1 } as never
      }
      return { rows: [], rowCount: 0 } as never
    })
    fakeClient.query.mockImplementation(async (q: string) =>
      (q.includes('FROM driver_wallet_ledger WHERE wallet_id')
        ? { rows: [], rowCount: 0 }
        : { rows: [{ id: 1, balance: '1000' }], rowCount: 1 }) as never)
    status('captured', 50000)
    await svc.reconcilePendingPayuPurchases()
    expect(ledgerInserts()).toHaveLength(1)
    expect(ledgerInserts()[0]![1]).toContain('W7xabc')
    expect(completingUpdates().map(c => c[1])).toEqual([['W7xabc']])
  })

  it('one failing row does not abort the rest of the sweep', async () => {
    select('W7xabc', 'W8xabc')
    vi.mocked(payu.fetchPayuStatus)
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce({ state: 'pending', amountPaise: 0, mihpayid: null } as never)
    await svc.reconcilePendingPayuPurchases()
    expect(vi.mocked(payu.fetchPayuStatus).mock.calls.map(c => c[0])).toEqual(['W7xabc', 'W8xabc'])
  })
})
