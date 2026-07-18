import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyRidePaymentFailed: vi.fn() }))

const fetchPayments = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: vi.fn(), fetchPayments }; payments = { fetch: vi.fn() } },
}))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'
import { notifyRidePaymentFailed } from '@/modules/notifications/notifications.service'

// NOTE: vi.spyOn(svc, 'confirmRidePayment') does NOT intercept confirmRidePayment
// being called internally from reconcilePendingRidePayments (both live in the same
// module file). Instead of trusting a spy, we assert on the real side effect: the
// guarded `UPDATE payments SET status = 'completed' ... WHERE status = 'pending'`
// that confirmRidePayment issues via pool.query.
describe('reconcilePendingRidePayments', () => {
  beforeEach(() => vi.clearAllMocks())

  function confirmingUpdateWasIssued(): boolean {
    return vi.mocked(pool.query).mock.calls.some(
      (c) => (c[0] as string).includes("SET status = 'completed'")
    )
  }

  it('captured on recheck → confirms, does not notify failure', async () => {
    vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
      const sql = text as string
      if (sql.includes("WHERE status = 'pending'") && sql.includes('razorpay_order_id IS NOT NULL')) {
        return { rows: [{ ride_id: 101, razorpay_order_id: 'order_1', user_id: 42, amount: '500.00' }], rowCount: 1 } as never
      }
      if (sql.includes("SET status = 'completed'")) {
        return { rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 } as never
      }
      return { rows: [], rowCount: 0 } as never
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
})
