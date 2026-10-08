import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

import { consumePackageBalance, creditPackageBalance, adjustPackageBalance } from '@/modules/packages/packages.service'

function scriptConsume(currentBalance: string) {
  client.query.mockReset()
  client.query.mockImplementation((sql: string) => {
    if (sql.includes('SELECT id, balance, is_frozen')) {
      return Promise.resolve({ rows: [{ id: 9, balance: currentBalance, is_frozen: false }], rowCount: 1 })
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}

function scriptBalanceOnly(currentBalance: string) {
  client.query.mockReset()
  client.query.mockImplementation((sql: string) => {
    if (sql.includes('SELECT id, balance FROM driver_package_wallets')) {
      return Promise.resolve({ rows: [{ id: 9, balance: currentBalance }], rowCount: 1 })
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}

describe('consumePackageBalance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows balance to go negative when the final fare exceeds remaining balance', async () => {
    scriptConsume('50.00')
    await consumePackageBalance(BigInt(1), BigInt(42), 80)

    const updateCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE driver_package_wallets'))
    expect(updateCall).toBeDefined()
    expect(updateCall?.[1]).toEqual([9, -30, 80])
  })

  it('writes a ride_consumption ledger row with direction debit', async () => {
    scriptConsume('200.00')
    await consumePackageBalance(BigInt(2), BigInt(42), 80)

    const ledgerCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO driver_package_ledger'))
    expect(ledgerCall).toBeDefined()
    expect(ledgerCall?.[0]).toContain("'ride_consumption'")
    expect(ledgerCall?.[0]).toContain("'debit'")
  })
})

describe('creditPackageBalance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds the topup amount onto the current balance and writes a topup credit ledger row', async () => {
    scriptBalanceOnly('100.00')
    await creditPackageBalance(BigInt(1), 500, 'pay_abc123')

    const updateCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE driver_package_wallets'))
    expect(updateCall).toBeDefined()
    expect(updateCall?.[1]).toEqual([9, 600, 500])

    const ledgerCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO driver_package_ledger'))
    expect(ledgerCall).toBeDefined()
    expect(ledgerCall?.[0]).toContain("'topup'")
    expect(ledgerCall?.[0]).toContain("'credit'")
  })

  it('a second call with the same referenceId credits nothing (ledger dedupe under the wallet lock)', async () => {
    client.query.mockReset()
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, balance FROM driver_package_wallets')) {
        return Promise.resolve({ rows: [{ id: 9, balance: '600.00' }], rowCount: 1 })
      }
      if (sql.includes('FROM driver_package_ledger WHERE wallet_id')) {
        return Promise.resolve({ rows: [{ id: 77 }], rowCount: 1 }) // already credited
      }
      return Promise.resolve({ rows: [], rowCount: 0 })
    })
    await creditPackageBalance(BigInt(1), 500, 'pay_abc123')

    const sqls = client.query.mock.calls.map((c: unknown[]) => c[0] as string)
    const dupeCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('FROM driver_package_ledger WHERE wallet_id'))
    expect(dupeCall?.[1]).toEqual([9, 'pay_abc123'])
    expect(sqls.some(s => s.includes('UPDATE driver_package_wallets'))).toBe(false)
    expect(sqls.some(s => s.includes('INSERT INTO driver_package_ledger'))).toBe(false)
    expect(sqls).toContain('ROLLBACK')
    expect(sqls).not.toContain('COMMIT')
  })
})

describe('adjustPackageBalance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('credits balance for a positive signedAmount and writes admin_adjustment credit ledger row', async () => {
    scriptBalanceOnly('100.00')
    await adjustPackageBalance(BigInt(1), 100, 'goodwill credit', BigInt(7))

    const updateCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE driver_package_wallets'))
    expect(updateCall).toBeDefined()
    expect(updateCall?.[1]).toEqual([9, 200])

    const ledgerCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO driver_package_ledger'))
    expect(ledgerCall).toBeDefined()
    expect(ledgerCall?.[0]).toContain("'admin_adjustment'")
    expect(ledgerCall?.[0]).toContain("'credit'")
  })

  it('debits balance for a negative signedAmount and writes admin_adjustment debit ledger row', async () => {
    scriptBalanceOnly('100.00')
    await adjustPackageBalance(BigInt(1), -50, 'correction', BigInt(7))

    const updateCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE driver_package_wallets'))
    expect(updateCall).toBeDefined()
    expect(updateCall?.[1]).toEqual([9, 50])

    const ledgerCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO driver_package_ledger'))
    expect(ledgerCall).toBeDefined()
    expect(ledgerCall?.[0]).toContain("'admin_adjustment'")
    expect(ledgerCall?.[0]).toContain("'debit'")
  })
})
