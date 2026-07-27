import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

const notifyMock = vi.fn()
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyDriverLowWalletBalance: (...args: unknown[]) => notifyMock(...args),
}))

import { deductCommission } from '@/modules/payments/payments.service'

// Config: driver_minimum_balance = 500 in every scenario below.
function scriptDeduct(opts: { commission: string; balance: string }) {
  poolQuery.mockReset()
  poolQuery
    .mockResolvedValueOnce({ rows: [{ commission_amount: opts.commission }], rowCount: 1 }) // SELECT payments
    .mockResolvedValueOnce({ rows: [{ value: '500' }], rowCount: 1 })                        // system_config

  client.query.mockReset()
  client.query.mockImplementation((sql: string) => {
    if (sql.includes('SELECT id, balance, is_frozen')) {
      return Promise.resolve({ rows: [{ id: 9, balance: opts.balance, is_frozen: false }], rowCount: 1 })
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}

describe('deductCommission — negative balance (cash dues)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lets balance go negative when commission exceeds current balance', async () => {
    scriptDeduct({ commission: '150.00', balance: '100.00' }) // 100 - 150 = -50, must NOT floor to 0
    await deductCommission(BigInt(1), BigInt(42))

    const updateCall = client.query.mock.calls.find(c => (c[0] as string).includes('UPDATE driver_wallets'))
    expect(updateCall).toBeDefined()
    expect(updateCall?.[1]).toEqual([9, -50, 150])
  })
})
