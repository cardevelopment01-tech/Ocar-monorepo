import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), get: vi.fn(), del: vi.fn() } }))

const ordersCreate = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: ordersCreate }; payments = { fetch: vi.fn() } },
}))

// config is read live; override per test via vi.doMock is heavy — instead mock the module.
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))

import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { createRidePaymentOrder } from '@/modules/payments/payments.service'

describe('createRidePaymentOrder (keys configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ordersCreate.mockResolvedValue({ id: 'order_XYZ' })
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
  })

  it('creates an order for the fare, persists order id, binds order→user', async () => {
    const result = await createRidePaymentOrder(BigInt(101), BigInt(42), 500)
    expect(ordersCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 50000, currency: 'INR' }))
    expect(result).toEqual({ orderId: 'order_XYZ', key: 'rzp_test', amount: 500 })
    const update = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes('razorpay_order_id'))
    expect(update).toBeTruthy()
    expect(vi.mocked(redis.set)).toHaveBeenCalledWith('ride:payment_order:order_XYZ', '42', 'EX', 1800)
  })
})
