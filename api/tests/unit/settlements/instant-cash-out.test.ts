import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))
// getConfigValue (system_config caching) reads through @/db/redis — without
// this mock it hits a real, reachable local Redis and serves a value cached
// by an earlier test/run instead of falling through to the pg mock above.
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  client: { del: vi.fn().mockResolvedValue(1) },
}))

import { instantCashOut } from '@/modules/payments/submodules/settlements/settlements.service'

const lockedEarningsRows = [
  { id: '301', amount: '400.00' },
  { id: '302', amount: '-10.00' }, // the fee row inserted in this same transaction
]

function baseMockImpl(overrides?: { bankRows?: unknown[]; holdRows?: unknown[]; lockedRows?: unknown[] }) {
  return (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM driver_bank_accounts') && sql.includes('FOR UPDATE')) {
      return Promise.resolve({ rows: overrides?.bankRows ?? [{ id: '5' }] })
    }
    if (sql.includes('driver_payout_holds')) {
      return Promise.resolve({ rows: overrides?.holdRows ?? [] })
    }
    if (sql.includes('INSERT INTO driver_earnings')) {
      return Promise.resolve({ rows: [], rowCount: 1 })
    }
    if (sql.includes('SELECT id, amount FROM driver_earnings') && sql.includes('FOR UPDATE')) {
      return Promise.resolve({ rows: overrides?.lockedRows ?? lockedEarningsRows })
    }
    if (sql.includes('INSERT INTO settlements')) {
      return Promise.resolve({ rows: [{ id: '900' }] })
    }
    return Promise.resolve({ rows: [], rowCount: 1 })
  }
}

describe('instantCashOut', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when the driver_payouts_enabled kill switch is off, before touching any locks', async () => {
    client.query.mockImplementation(baseMockImpl())
    poolQuery.mockResolvedValueOnce({ rows: [{ value: 'false' }] }) // driver_payouts_enabled

    await expect(instantCashOut(42n)).rejects.toThrow('Instant cash-out is not available yet')
    expect(client.query).not.toHaveBeenCalled()
  })

  it('throws when no verified primary bank account is on file', async () => {
    client.query.mockImplementation(baseMockImpl({ bankRows: [] }))
    poolQuery
      .mockResolvedValueOnce({ rows: [{ value: 'true' }] }) // driver_payouts_enabled
      .mockResolvedValueOnce({ rows: [{ value: '10' }] }) // instant_payout_fee

    await expect(instantCashOut(42n)).rejects.toThrow('No verified bank account on file')

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(false)
  })

  it('throws when the driver has an active payout hold', async () => {
    client.query.mockImplementation(baseMockImpl({ holdRows: [{ '?column?': 1 }] }))
    poolQuery
      .mockResolvedValueOnce({ rows: [{ value: 'true' }] })
      .mockResolvedValueOnce({ rows: [{ value: '10' }] })

    await expect(instantCashOut(42n)).rejects.toThrow('Payouts are on hold for this account')

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(false)
  })

  it('throws when locked earnings rows sum to zero or less', async () => {
    client.query.mockImplementation(baseMockImpl({ lockedRows: [] }))
    poolQuery
      .mockResolvedValueOnce({ rows: [{ value: 'true' }] })
      .mockResolvedValueOnce({ rows: [{ value: '10' }] })

    await expect(instantCashOut(42n)).rejects.toThrow('No payable balance')

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(false)
  })

  it('inserts the fee row, creates an instant/processing settlement, and sweeps exactly the locked ids', async () => {
    client.query.mockImplementation(baseMockImpl())
    poolQuery
      .mockResolvedValueOnce({ rows: [{ value: 'true' }] })
      .mockResolvedValueOnce({ rows: [{ value: '10' }] })

    const settlementId = await instantCashOut(42n)

    expect(settlementId).toBe(900n)

    const calls = client.query.mock.calls as Array<[string, unknown[]?]>

    const feeInsert = calls.find(([sql]) => sql.includes('INSERT INTO driver_earnings'))
    expect(feeInsert).toBeDefined()
    expect(feeInsert![0]).toContain("'adjustment'")
    expect(feeInsert![0]).toContain("'cleared'")

    const settlementInsert = calls.find(([sql]) => sql.includes('INSERT INTO settlements'))
    expect(settlementInsert).toBeDefined()
    expect(settlementInsert![0]).toContain("'instant'")
    expect(settlementInsert![0]).toContain("'processing'")
    const settlementParams = settlementInsert![1] as unknown[]
    expect(settlementParams[2]).toBe(390) // net_payout = 400 - 10
    expect(settlementParams[3]).toBe(10) // fee

    const sweepCall = calls.find(
      ([sql]) => sql.includes('UPDATE driver_earnings') && sql.includes("'in_payout'")
    )
    expect(sweepCall).toBeDefined()
    expect(sweepCall![0]).toContain('id = ANY')
    const sweptIds = sweepCall![1]![0] as string[]
    expect(sweptIds).toEqual(lockedEarningsRows.map(r => r.id))

    expect(calls.some(([sql]) => sql.includes('COMMIT'))).toBe(true)
  })
})
