import { describe, it, expect, vi, beforeEach } from 'vitest'

// confirmRidePayment now runs the status flip + billing-mode read + wallet writes
// on ONE client transaction. consumePackageBalance (packages module) and
// accrueDriverEarning (settlements module) mock cleanly across module boundaries.
const fakeClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('15') }))
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
  beforeEach(() => vi.clearAllMocks())

  it('billing_mode_snapshot = package → consumes package balance, never touches the driver commission wallet', async () => {
    fakeClient.query.mockImplementation((sql: string) => {
      if (/UPDATE payments/.test(sql)) return Promise.resolve({ rows: [{ driver_id: '42', user_id: '7', amount: '80.00' }], rowCount: 1 })
      if (/billing_mode_snapshot/.test(sql)) return Promise.resolve({ rows: [{ billing_mode_snapshot: 'package' }], rowCount: 1 })
      if (/SELECT id, balance FROM user_wallets/.test(sql)) return Promise.resolve({ rows: [{ id: 2, balance: '0' }], rowCount: 1 })
      // deductCommission's driver_wallets FOR UPDATE must never run in package mode
      if (/driver_wallets/.test(sql) || /driver_wallet_ledger/.test(sql)) throw new Error(`unexpected driver-wallet query: ${sql}`)
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    const result = await confirmRidePayment(BigInt(1))

    expect(result).toBe(true)
    expect(consumePackageBalance).toHaveBeenCalledWith(BigInt(1), BigInt(42), 80)
    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('driver_wallet_ledger'))).toBe(false)
    expect(sqls.filter(s => s.includes('COMMIT')).length).toBe(1)
  })

  it('billing_mode_snapshot = null (commission) → deducts commission, never calls consumePackageBalance', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ commission_amount: '12.00' }], rowCount: 1 } as never)
    fakeClient.query.mockImplementation((sql: string) => {
      if (/UPDATE payments/.test(sql)) return Promise.resolve({ rows: [{ driver_id: '42', user_id: '7', amount: '80.00' }], rowCount: 1 })
      if (/billing_mode_snapshot/.test(sql)) return Promise.resolve({ rows: [{ billing_mode_snapshot: null }], rowCount: 1 })
      if (/SELECT id, balance, is_frozen/.test(sql)) return Promise.resolve({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
      if (/SELECT id, balance FROM user_wallets/.test(sql)) return Promise.resolve({ rows: [{ id: 2, balance: '0' }], rowCount: 1 })
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    const result = await confirmRidePayment(BigInt(2))

    expect(result).toBe(true)
    expect(consumePackageBalance).not.toHaveBeenCalled()
    const commissionLedger = fakeClient.query.mock.calls.find(
      c => (c[0] as string).includes('driver_wallet_ledger') && (c[1] as unknown[]).includes(BigInt(2))
    )
    expect(commissionLedger, 'commission ledger write must run in commission mode').toBeDefined()
  })
})
