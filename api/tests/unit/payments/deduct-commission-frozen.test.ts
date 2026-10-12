import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('500') }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyDriverLowWalletBalance: vi.fn() }))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({ accrueDriverEarning: vi.fn() }))
vi.mock('@/modules/packages/packages.service', () => ({ consumePackageBalance: vi.fn() }))

import { deductCommission } from '@/modules/payments/payments.service'

describe('deductCommission — frozen wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.query.mockImplementation((sql: string) => {
      if (/SELECT commission_amount FROM payments/.test(sql)) return Promise.resolve({ rows: [{ commission_amount: '50.00' }], rowCount: 1 })
      if (/SELECT id, balance, is_frozen/.test(sql)) return Promise.resolve({ rows: [{ id: 1, balance: '100', is_frozen: true }], rowCount: 1 })
      return Promise.resolve({ rows: [], rowCount: 1 })
    })
  })

  it('still debits the commission (a freeze must not waive the platform fee); balance may go negative', async () => {
    await deductCommission(BigInt(5), BigInt(9), fakeClient as never)

    const ledger = fakeClient.query.mock.calls.find(c => (c[0] as string).includes('driver_wallet_ledger'))
    expect(ledger, 'commission ledger row must be written even when the wallet is frozen').toBeDefined()
    expect(ledger![1]).toEqual(expect.arrayContaining([50, 50])) // amount 50, balance_after 100 - 50
  })

  it('reads the payment row on the shared client (it may only exist inside the caller\'s open transaction)', async () => {
    await deductCommission(BigInt(5), BigInt(9), fakeClient as never)
    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('SELECT commission_amount FROM payments'))).toBe(true)
  })
})
