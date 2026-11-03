import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('500') }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyDriverLowWalletBalance: vi.fn() }))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({ accrueDriverEarning: vi.fn() }))
vi.mock('@/modules/packages/packages.service', () => ({ consumePackageBalance: vi.fn() }))

import { deductCommission } from '@/modules/payments/payments.service'

function withCommission(amount: string) {
  fakeClient.query.mockImplementation((sql: string) => {
    if (/SELECT commission_amount FROM payments/.test(sql)) return Promise.resolve({ rows: [{ commission_amount: amount }], rowCount: 1 })
    if (/SELECT id, balance, is_frozen/.test(sql)) return Promise.resolve({ rows: [{ id: 1, balance: '100', is_frozen: false }], rowCount: 1 })
    return Promise.resolve({ rows: [], rowCount: 1 })
  })
}
const sqls = () => fakeClient.query.mock.calls.map(c => c[0] as string)

describe('deductCommission, commission-free ride (0%)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes no ledger line, touches no wallet and reports no low-balance crossing', async () => {
    withCommission('0.00')
    const out = await deductCommission(BigInt(5), BigInt(9), fakeClient as never)

    expect(out).toBeNull()
    expect(sqls().some(s => s.includes('driver_wallet_ledger'))).toBe(false)
    expect(sqls().some(s => /driver_wallets/.test(s))).toBe(false)
  })

  it('still debits a positive commission and writes the ledger line', async () => {
    withCommission('15.00')
    await deductCommission(BigInt(5), BigInt(9), fakeClient as never)
    expect(sqls().some(s => s.includes('driver_wallet_ledger'))).toBe(true)
  })

  it.each(['-5.00', 'abc'])('does not silently skip a corrupt amount (%s): it goes down the normal debit path', async (bad) => {
    withCommission(bad)
    await deductCommission(BigInt(5), BigInt(9), fakeClient as never).catch(() => {})
    expect(sqls().some(s => /SELECT id, balance, is_frozen/.test(s))).toBe(true)
  })
})
