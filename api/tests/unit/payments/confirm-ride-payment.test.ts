import { describe, it, expect, vi, beforeEach } from 'vitest'

// Everything now runs on ONE client transaction. The client mock answers every
// query by SQL shape; pool.query still serves the read-only pre-computation
// (deductCommission's commission_amount SELECT, config reads).
const fakeClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({
  pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) },
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('15') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyDriverLowWalletBalance: vi.fn(),
}))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({
  accrueDriverEarning: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/packages/packages.service', () => ({
  consumePackageBalance: vi.fn().mockResolvedValue(undefined),
}))

import { pool } from '@/db/client'
import { confirmRidePayment } from '@/modules/payments/payments.service'

// Client answers by SQL: the guarded flip, the billing-mode lookup, the wallet
// FOR UPDATE reads, and everything else (BEGIN/INSERT/UPDATE/COMMIT) → generic ok.
function scriptClientHappyPath() {
  fakeClient.query.mockReset()
  fakeClient.query.mockImplementation((sql: string) => {
    if (/UPDATE payments/.test(sql)) {
      return Promise.resolve({ rows: [{ driver_id: '9', user_id: '42', amount: '500.00' }], rowCount: 1 })
    }
    if (/billing_mode_snapshot/.test(sql)) {
      return Promise.resolve({ rows: [{ billing_mode_snapshot: null }], rowCount: 1 })
    }
    if (/SELECT id, balance, is_frozen/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
    }
    if (/SELECT id, balance FROM user_wallets/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 2, balance: '0' }], rowCount: 1 })
    }
    return Promise.resolve({ rows: [], rowCount: 1 })
  })
}

describe('confirmRidePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // pool.query serves deductCommission's commission_amount SELECT.
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ commission_amount: '50.00' }], rowCount: 1 } as never)
  })

  it('already-completed (guarded flip hits 0 rows) → rolls back, returns false, no settlement', async () => {
    fakeClient.query.mockReset()
    fakeClient.query.mockImplementation((sql: string) => {
      if (/UPDATE payments/.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 })
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    const result = await confirmRidePayment(BigInt(101))

    expect(result).toBe(false)
    const calls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('BEGIN'))).toBe(true)
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(false)
    // no wallet writes happened
    expect(calls.some(s => s.includes('driver_wallet_ledger'))).toBe(false)
  })

  it('pending → completed: one transaction, records razorpay_payment_id, commits all four steps', async () => {
    scriptClientHappyPath()

    const result = await confirmRidePayment(BigInt(101), 'pay_abc123')

    expect(result).toBe(true)
    expect(pool.connect).toHaveBeenCalledTimes(1) // ONE shared transaction, not one per step

    const calls = fakeClient.query.mock.calls
    const sqls = calls.map(c => c[0] as string)
    const flip = calls.find(c => (c[0] as string).includes('UPDATE payments'))!
    expect(flip[0] as string).toContain("status = 'pending'")
    expect(flip[0] as string).toContain('razorpay_payment_id')
    expect(flip[1] as unknown[]).toContain('pay_abc123')

    // commission + cashback ledger writes ran on the SAME client, inside BEGIN/COMMIT
    expect(sqls.some(s => s.includes('driver_wallet_ledger'))).toBe(true)
    expect(sqls.some(s => s.includes('user_wallet_ledger'))).toBe(true)
    expect(sqls.filter(s => s.includes('BEGIN')).length).toBe(1)
    expect(sqls.filter(s => s.includes('COMMIT')).length).toBe(1)
    expect(sqls.some(s => s.includes('ROLLBACK'))).toBe(false)
  })

  it('a settlement step throwing rolls the whole transaction back (status flip not left committed)', async () => {
    scriptClientHappyPath()
    // Make the LAST settlement write (cashback ledger) blow up mid-transaction.
    fakeClient.query.mockImplementation((sql: string) => {
      if (/UPDATE payments/.test(sql)) {
        return Promise.resolve({ rows: [{ driver_id: '9', user_id: '42', amount: '500.00' }], rowCount: 1 })
      }
      if (/billing_mode_snapshot/.test(sql)) return Promise.resolve({ rows: [{ billing_mode_snapshot: null }], rowCount: 1 })
      if (/SELECT id, balance, is_frozen/.test(sql)) return Promise.resolve({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
      if (/SELECT id, balance FROM user_wallets/.test(sql)) return Promise.resolve({ rows: [{ id: 2, balance: '0' }], rowCount: 1 })
      if (/INSERT INTO user_wallet_ledger/.test(sql)) return Promise.reject(new Error('db exploded mid-settlement'))
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    await expect(confirmRidePayment(BigInt(101))).rejects.toThrow('db exploded mid-settlement')

    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(sqls.some(s => s.includes('COMMIT'))).toBe(false)
    expect(fakeClient.release).toHaveBeenCalledTimes(1)
  })
})
