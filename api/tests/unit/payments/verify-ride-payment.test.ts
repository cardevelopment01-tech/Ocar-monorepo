import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

// deductCommission/creditCashback (called by confirmRidePayment on success) run
// transactions via pool.connect(), not pool.query — mock both like
// confirm-ride-payment.test.ts does.
const fakeClient = {
  query: vi.fn().mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 }),
  release: vi.fn(),
}
vi.mock('@/db/client', () => ({
  pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) },
}))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), del: vi.fn(), set: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))

const paymentsFetch = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: vi.fn() }; payments = { fetch: paymentsFetch } },
}))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'

const ORDER = 'order_XYZ'
const PAYMENT = 'pay_abc'
const goodSig = createHmac('sha256', 'secret').update(`${ORDER}|${PAYMENT}`).digest('hex')

// NOTE: vi.spyOn(svc, 'confirmRidePayment') does NOT intercept confirmRidePayment
// being called internally from verifyRidePayment (both live in the same module
// file) under this codebase's Vitest/ESM transform — confirmed empirically the
// same way tests/unit/payments/confirm-ride-payment.test.ts documents for a sibling
// case. Instead of trusting a spy, we assert on the real side effect: the guarded
// `UPDATE payments SET status = 'completed' ... WHERE status = 'pending'` that
// confirmRidePayment issues via pool.query.
describe('verifyRidePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.query.mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
    vi.mocked(redis.get).mockResolvedValue('42') // order bound to user 42
    vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
      const sql = text as string
      if (sql.includes('SELECT amount, razorpay_order_id FROM payments')) {
        return { rows: [{ amount: '500.00', razorpay_order_id: ORDER }], rowCount: 1 } as never
      }
      if (sql.includes("SET status = 'completed'")) {
        return { rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 } as never
      }
      return { rows: [], rowCount: 0 } as never
    })
    paymentsFetch.mockResolvedValue({ order_id: ORDER, status: 'captured', amount: 50000 })
  })

  function confirmingUpdateWasIssued(): boolean {
    return vi.mocked(pool.query).mock.calls.some(
      (c) => (c[0] as string).includes("SET status = 'completed'")
    )
  }

  it('rejects a bad signature (no confirm)', async () => {
    await expect(
      svc.verifyRidePayment(BigInt(101), BigInt(42), { orderId: ORDER, paymentId: PAYMENT, signature: 'wrong' })
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(confirmingUpdateWasIssued()).toBe(false)
    expect(redis.del).not.toHaveBeenCalled()
  })

  it('rejects when Razorpay amount != stored fare (client cannot inflate/deflate)', async () => {
    paymentsFetch.mockResolvedValue({ order_id: ORDER, status: 'captured', amount: 100 })
    await expect(
      svc.verifyRidePayment(BigInt(101), BigInt(42), { orderId: ORDER, paymentId: PAYMENT, signature: goodSig })
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(confirmingUpdateWasIssued()).toBe(false)
  })

  it('rejects a cross-user order (bound to a different user)', async () => {
    vi.mocked(redis.get).mockResolvedValue('999')
    await expect(
      svc.verifyRidePayment(BigInt(101), BigInt(42), { orderId: ORDER, paymentId: PAYMENT, signature: goodSig })
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(confirmingUpdateWasIssued()).toBe(false)
  })

  it('valid signature + captured + matching amount → confirms', async () => {
    await svc.verifyRidePayment(BigInt(101), BigInt(42), { orderId: ORDER, paymentId: PAYMENT, signature: goodSig })
    const confirmCall = vi.mocked(pool.query).mock.calls.find(
      (c) => (c[0] as string).includes("SET status = 'completed'")
    )
    expect(confirmCall).toBeTruthy()
    expect(confirmCall![1] as unknown[]).toContain(PAYMENT)
    expect(redis.del).toHaveBeenCalledWith('ride:payment_order:order_XYZ')
  })
})
