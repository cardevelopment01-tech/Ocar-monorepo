import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = { query: vi.fn().mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 }), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))

import { pool } from '@/db/client'
import { confirmRidePayment } from '@/modules/payments/payments.service'

describe('confirmRidePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.query.mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
  })

  it('already-completed (no pending row) → returns false, runs no commission/cashback', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // guarded UPDATE hits nothing
    const result = await confirmRidePayment(BigInt(101))
    expect(result).toBe(false)
    expect(pool.connect).not.toHaveBeenCalled() // deductCommission/creditCashback never started
  })

  it('pending → completed: returns true and records razorpay_payment_id when provided', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 } as never) // guarded UPDATE wins
      .mockResolvedValue({ rows: [], rowCount: 0 } as never) // subsequent config/select lookups
    const result = await confirmRidePayment(BigInt(101), 'pay_abc123')
    expect(result).toBe(true)
    const updateCall = vi.mocked(pool.query).mock.calls[0]!
    expect(updateCall[0] as string).toContain("status = 'pending'")
    expect(updateCall[0] as string).toContain('razorpay_payment_id')
    expect(updateCall[1] as unknown[]).toContain('pay_abc123')
  })
})
