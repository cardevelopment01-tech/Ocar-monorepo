import { describe, it, expect, vi, beforeEach } from 'vitest'

// deductCommission/consumePackageBalance/creditCashback all use pool.connect()
// transactions internally — vi.spyOn on the payments.service module namespace
// does not intercept internal same-module calls under Vitest's ESM transform
// (confirmed by the precedent in confirm-ride-payment.test.ts, which asserts on
// the actual DB side-effects instead of spying). consumePackageBalance lives in
// a *different* module (packages.service), so it mocks cleanly; deductCommission
// is same-module, so its branch is verified via the driver_wallets ledger side
// effect it performs.
const fakeClient = {
  query: vi.fn().mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 }),
  release: vi.fn(),
}
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyDriverLowWalletBalance: vi.fn() }))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({
  accrueDriverEarning: vi.fn().mockResolvedValue(undefined),
}))
const consumePackageBalance = vi.fn().mockResolvedValue(undefined)
vi.mock('@/modules/packages/packages.service', () => ({
  consumePackageBalance: (...a: unknown[]) => consumePackageBalance(...a),
}))

import { pool } from '@/db/client'
import { confirmRidePayment } from '@/modules/payments/payments.service'

describe('confirmRidePayment — package-mode branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.query.mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
  })

  it('billing_mode_snapshot = package → consumes package balance, never touches driver commission wallet', async () => {
    vi.mocked(pool.query).mockImplementation((sql: unknown) => {
      const s = sql as string
      if (/UPDATE payments/.test(s)) {
        return Promise.resolve({ rows: [{ driver_id: '42', user_id: '7', amount: '80.00' }], rowCount: 1 } as never)
      }
      if (/billing_mode_snapshot/.test(s)) {
        return Promise.resolve({ rows: [{ billing_mode_snapshot: 'package' }], rowCount: 1 } as never)
      }
      // deductCommission's SELECT commission_amount would land here — must not run
      throw new Error(`unexpected pool.query: ${s}`)
    })

    const result = await confirmRidePayment(BigInt(1))

    expect(result).toBe(true)
    expect(consumePackageBalance).toHaveBeenCalledWith(BigInt(1), BigInt(42), 80)

    // deductCommission's only observable effect is a driver_wallets ledger write —
    // assert it never happened (creditCashback's client.connect for the user side
    // still runs, so we check the driver_wallets side specifically).
    const driverWalletTouch = fakeClient.query.mock.calls.find(
      (c) => (c[0] as string).includes('driver_wallets') || (c[0] as string).includes('driver_wallet_ledger')
    )
    expect(driverWalletTouch, 'deductCommission must not touch driver_wallets in package mode').toBeUndefined()
  })

  it('billing_mode_snapshot = commission (or null) → deducts commission, never calls consumePackageBalance', async () => {
    vi.mocked(pool.query).mockImplementation((sql: unknown) => {
      const s = sql as string
      if (/UPDATE payments/.test(s)) {
        return Promise.resolve({ rows: [{ driver_id: '42', user_id: '7', amount: '80.00' }], rowCount: 1 } as never)
      }
      if (/billing_mode_snapshot/.test(s)) {
        return Promise.resolve({ rows: [{ billing_mode_snapshot: null }], rowCount: 1 } as never)
      }
      if (/SELECT commission_amount FROM payments/.test(s)) {
        return Promise.resolve({ rows: [{ commission_amount: '12.00' }], rowCount: 1 } as never)
      }
      return Promise.resolve({ rows: [], rowCount: 0 } as never)
    })

    const result = await confirmRidePayment(BigInt(2))

    expect(result).toBe(true)
    expect(consumePackageBalance).not.toHaveBeenCalled()

    const driverWalletLedger = fakeClient.query.mock.calls.find(
      (c) => (c[0] as string).includes('driver_wallet_ledger') && (c[1] as unknown[]).includes(BigInt(2))
    )
    expect(driverWalletLedger, 'deductCommission must run the commission ledger write in commission mode').toBeDefined()
  })
})
