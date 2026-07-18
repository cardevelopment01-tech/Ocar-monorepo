import { describe, it, expect, vi, beforeEach } from 'vitest'

// deductCommission/creditCashback (called by confirmRidePayment on success) run
// transactions via pool.connect(), not pool.query — mock both like
// confirm-ride-payment.test.ts / verify-ride-payment.test.ts do.
const fakeClient = {
  query: vi.fn().mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 }),
  release: vi.fn(),
}
vi.mock('@/db/client', () => ({
  pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) },
}))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' } }))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'

function capturedPayload(paymentId: string, orderId: string) {
  return { event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, status: 'captured' } } } }
}

// NOTE: vi.spyOn(svc, 'confirmRidePayment') does NOT intercept confirmRidePayment
// being called internally from handleWebhookEvent (both live in the same module
// file) under this codebase's Vitest/ESM transform — same finding documented in
// confirm-ride-payment.test.ts / verify-ride-payment.test.ts. Instead of trusting
// a spy, we assert on the real side effect: the guarded
// `UPDATE payments SET status = 'completed' ... WHERE status = 'pending'` that
// confirmRidePayment issues via pool.query. Empirically verified: temporarily
// removing the confirmRidePayment call from the webhook handler made test 2 fail
// (no confirming UPDATE issued) and restoring it made it pass again.
describe('handleWebhookEvent — payment.captured', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.query.mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
  })

  function confirmingUpdateWasIssued(): boolean {
    return vi.mocked(pool.query).mock.calls.some(
      (c) => (c[0] as string).includes("SET status = 'completed'")
    )
  }

  it('duplicate event (already logged) → no confirm', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 } as never) // dedupe hit
    await svc.handleWebhookEvent(capturedPayload('pay_1', 'order_1'))
    expect(confirmingUpdateWasIssued()).toBe(false)
  })

  it('new captured event with a pending payment → confirms that ride', async () => {
    vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
      const sql = text as string
      if (sql.includes('SELECT id FROM payment_gateway_events')) {
        return { rows: [], rowCount: 0 } as never // dedupe: not seen
      }
      if (sql.includes('INSERT INTO payment_gateway_events')) {
        return { rows: [], rowCount: 1 } as never
      }
      if (sql.includes('FROM payments') && sql.includes('razorpay_order_id')) {
        return { rows: [{ ride_id: 101 }], rowCount: 1 } as never // pending payment for order
      }
      if (sql.includes("SET status = 'completed'")) {
        return { rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 } as never
      }
      return { rows: [], rowCount: 0 } as never
    })
    await svc.handleWebhookEvent(capturedPayload('pay_1', 'order_1'))
    const confirmCall = vi.mocked(pool.query).mock.calls.find(
      (c) => (c[0] as string).includes("SET status = 'completed'")
    )
    expect(confirmCall).toBeTruthy()
    expect(confirmCall![1] as unknown[]).toEqual([BigInt(101), 'pay_1'])
  })

  it('captured event but no pending payment (already completed) → no confirm', async () => {
    vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
      const sql = text as string
      if (sql.includes('SELECT id FROM payment_gateway_events')) {
        return { rows: [], rowCount: 0 } as never // dedupe: not seen
      }
      if (sql.includes('INSERT INTO payment_gateway_events')) {
        return { rows: [], rowCount: 1 } as never
      }
      if (sql.includes('FROM payments') && sql.includes('razorpay_order_id')) {
        return { rows: [], rowCount: 0 } as never // no pending payment
      }
      return { rows: [], rowCount: 0 } as never
    })
    await svc.handleWebhookEvent(capturedPayload('pay_1', 'order_1'))
    expect(confirmingUpdateWasIssued()).toBe(false)
  })
})
