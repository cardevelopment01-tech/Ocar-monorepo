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

describe('deductCommission — wallet-balance notify (no drivers.status side effect)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('balance crosses below minimum → debits wallet, commits, notifies', async () => {
    scriptDeduct({ commission: '150.00', balance: '600.00' }) // 600 -> 450
    await deductCommission(BigInt(1), BigInt(42))

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE driver_wallets'))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(true)
    expect(notifyMock).toHaveBeenCalledWith(BigInt(42), 450, 500)
  })

  it('never touches drivers.status or driver_status_history, regardless of crossing', async () => {
    scriptDeduct({ commission: '150.00', balance: '600.00' })
    await deductCommission(BigInt(1), BigInt(42))

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE drivers'))).toBe(false)
    expect(calls.some(s => s.includes('driver_status_history'))).toBe(false)
  })

  it('balance stays above minimum → no notify', async () => {
    scriptDeduct({ commission: '50.00', balance: '600.00' }) // 600 -> 550
    await deductCommission(BigInt(1), BigInt(42))

    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('balance was already below minimum → not a new crossing, no duplicate notify', async () => {
    scriptDeduct({ commission: '50.00', balance: '300.00' }) // 300 -> 250, never crossed 500 this call
    await deductCommission(BigInt(1), BigInt(42))

    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('a wallet top-up afterwards cannot un-suspend a driver suspended for an unrelated reason — trivially true, since this path never sets drivers.status', async () => {
    scriptDeduct({ commission: '150.00', balance: '600.00' })
    await deductCommission(BigInt(1), BigInt(42))

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.every(s => !s.toLowerCase().includes('drivers set'))).toBe(true)
  })
})
