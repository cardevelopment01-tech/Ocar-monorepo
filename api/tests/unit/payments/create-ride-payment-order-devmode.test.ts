import { describe, it, expect, vi, beforeEach } from 'vitest'

// confirmRidePayment's status flip now runs on a pool.connect() transaction
// client, not directly on pool.query (see payments.service.ts's single-txn
// settlement refactor) — the fake client's rowCount:0 default makes the
// guarded flip a no-op, same intent as the old pool.query rowCount:0 mock.
const fakeClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), get: vi.fn(), del: vi.fn() } }))

const ordersCreate = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: ordersCreate }; payments = { fetch: vi.fn() } },
}))

// Separate file (rather than vi.doMock/resetModules in the sibling test) so the
// dev-mode config value is fixed at module-mock time — see confirm-ride-payment.test.ts
// for why spying on same-module calls (confirmRidePayment) doesn't work under this
// Vitest/ESM setup; we assert on the UPDATE it issues instead.
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' } }))

import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { createRidePaymentOrder } from '@/modules/payments/payments.service'

describe('createRidePaymentOrder (keys not configured — dev mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // rowCount 0 makes confirmRidePayment's guarded UPDATE a no-op, so it returns
    // early without touching deductCommission/creditCashback — keeps this test
    // focused on "did createRidePaymentOrder route through confirmRidePayment".
    fakeClient.query.mockResolvedValue({ rows: [], rowCount: 0 } as never)
  })

  it('auto-confirms the ride payment and returns null without ever calling the gateway', async () => {
    const result = await createRidePaymentOrder(BigInt(101), BigInt(42), 500)

    const confirmUpdate = fakeClient.query.mock.calls.find(
      (c) => (c[0] as string).includes("status = 'completed'")
    )
    expect(confirmUpdate, 'confirmRidePayment was not invoked').toBeTruthy()
    expect(confirmUpdate?.[1]).toEqual([BigInt(101)])

    expect(ordersCreate).not.toHaveBeenCalled()
    expect(redis.set).not.toHaveBeenCalled()
    const orderUpdate = vi.mocked(pool.query).mock.calls.find(
      (c) => (c[0] as string).includes('razorpay_order_id')
    )
    expect(orderUpdate, 'a gateway order UPDATE ran even though keys are unset').toBeFalsy()

    expect(result).toBeNull()
  })
})
