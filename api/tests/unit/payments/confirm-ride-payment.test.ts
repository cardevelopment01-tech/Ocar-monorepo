import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = { query: vi.fn().mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 }), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))

import { pool } from '@/db/client'
import * as svc from '@/modules/payments/payments.service'
const { confirmRidePayment } = svc

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
      .mockResolvedValueOnce({ rows: [{ billing_mode_snapshot: null }], rowCount: 1 } as never) // ride's billing mode lookup (null → commission)
      .mockResolvedValueOnce({ rows: [{ commission_amount: '50.00' }], rowCount: 1 } as never) // deductCommission's own payments SELECT
      .mockResolvedValue({ rows: [], rowCount: 0 } as never) // subsequent config lookups (defaults apply)
    const result = await confirmRidePayment(BigInt(101), 'pay_abc123')
    expect(result).toBe(true)
    const updateCall = vi.mocked(pool.query).mock.calls[0]!
    expect(updateCall[0] as string).toContain("status = 'pending'")
    expect(updateCall[0] as string).toContain('razorpay_payment_id')
    expect(updateCall[1] as unknown[]).toContain('pay_abc123')

    // deductCommission/creditCashback are the only callers of pool.connect() in this
    // path — vi.spyOn on the module namespace does not intercept these internal
    // same-module calls under Vitest's ESM transform (verified empirically), so we
    // assert on the transaction side-effects those two functions actually perform.
    expect(pool.connect).toHaveBeenCalledTimes(2) // one wallet transaction each
    const clientCalls = fakeClient.query.mock.calls
    const driverWalletInsert = clientCalls.find(
      (c) => (c[0] as string).includes('INSERT INTO driver_wallets') && (c[1] as unknown[]).includes(BigInt(9))
    )
    const userWalletInsert = clientCalls.find(
      (c) => (c[0] as string).includes('INSERT INTO user_wallets') && (c[1] as unknown[]).includes(BigInt(42))
    )
    const commissionLedgerInsert = clientCalls.find(
      (c) => (c[0] as string).includes('driver_wallet_ledger') && (c[1] as unknown[]).includes(BigInt(101))
    )
    const cashbackLedgerInsert = clientCalls.find(
      (c) => (c[0] as string).includes('user_wallet_ledger') && (c[1] as unknown[]).includes(BigInt(101))
    )
    expect(driverWalletInsert, 'deductCommission never touched driver_wallets').toBeDefined()
    expect(userWalletInsert, 'creditCashback never touched user_wallets').toBeDefined()
    expect(commissionLedgerInsert, 'deductCommission never wrote a ledger entry').toBeDefined()
    expect(cashbackLedgerInsert, 'creditCashback never wrote a ledger entry').toBeDefined()
  })
})
