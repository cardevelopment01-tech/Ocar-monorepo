import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

import { runScheduledSettlementBatch } from '@/modules/payments/submodules/settlements/settlements.service'

// Rows locked per driver by the FOR UPDATE select, keyed by driver_id.
const lockedRowsByDriver: Record<string, Array<{ id: string; amount: string }>> = {
  '42': [
    { id: '101', amount: '500.00' },
    { id: '102', amount: '360.00' },
  ],
  '43': [{ id: '201', amount: '120.00' }],
}

function mockClientQuery(sql: string, params?: unknown[]) {
  if (sql.includes('SELECT DISTINCT')) {
    return Promise.resolve({
      rows: [
        { driver_id: '42', bank_account_id: '5' },
        { driver_id: '43', bank_account_id: '6' },
      ],
    })
  }
  if (sql.includes('FOR UPDATE')) {
    const driverId = String((params as unknown[])[0])
    return Promise.resolve({ rows: lockedRowsByDriver[driverId] ?? [] })
  }
  if (sql.includes('INSERT INTO settlements')) {
    return Promise.resolve({ rows: [{ id: '900' }] })
  }
  return Promise.resolve({ rows: [], rowCount: 1 })
}

describe('runScheduledSettlementBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('groups cleared earnings per eligible driver into one settlements row each, in one transaction', async () => {
    client.query.mockImplementation((sql: string, params?: unknown[]) => mockClientQuery(sql, params))
    poolQuery.mockResolvedValueOnce({ rows: [{ value: '50000' }] }) // settlement_auto_approve_limit

    await runScheduledSettlementBatch()

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.filter(s => s.includes('INSERT INTO settlements'))).toHaveLength(2)
    expect(calls.some(s => s.includes("UPDATE driver_earnings") && s.includes("'in_payout'"))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(true)

    // Sums are derived from the locked rows, not a pre-computed total.
    const insertCalls = client.query.mock.calls.filter(c => (c[0] as string).includes('INSERT INTO settlements'))
    const totals = insertCalls.map(c => (c[1] as unknown[])[3])
    expect(totals).toContain(860)
    expect(totals).toContain(120)
  })

  it('locks candidate rows with FOR UPDATE and sweeps the exact same locked ids, not a fresh WHERE re-evaluation', async () => {
    client.query.mockImplementation((sql: string, params?: unknown[]) => mockClientQuery(sql, params))
    poolQuery.mockResolvedValueOnce({ rows: [{ value: '50000' }] })

    await runScheduledSettlementBatch()

    const calls = client.query.mock.calls as Array<[string, unknown[]?]>

    // (a) the locking select must use FOR UPDATE
    const lockCalls = calls.filter(([sql]) => sql.includes('FOR UPDATE'))
    expect(lockCalls.length).toBe(2) // one per candidate driver
    for (const [sql] of lockCalls) {
      expect(sql).toContain('FOR UPDATE')
    }

    // (b) the sweep UPDATE must target explicit locked ids, never a bare
    // status='cleared' WHERE re-evaluation
    const sweepCalls = calls.filter(
      ([sql]) => sql.includes('UPDATE driver_earnings') && sql.includes("'in_payout'")
    )
    expect(sweepCalls.length).toBe(2)
    for (const [sql] of sweepCalls) {
      expect(sql).toContain('id = ANY')
      expect(sql).not.toMatch(/WHERE\s+driver_id\s*=\s*\$1\s+AND\s+status\s*=\s*'cleared'/)
    }

    // (c) the ids passed to each sweep UPDATE match exactly the ids returned
    // by that driver's FOR UPDATE select
    const sweptIdSets = sweepCalls.map(([, params]) => (params as unknown[])[0] as string[])
    const expectedIdSets = [
      lockedRowsByDriver['42']!.map(r => r.id),
      lockedRowsByDriver['43']!.map(r => r.id),
    ]
    for (const expectedIds of expectedIdSets) {
      expect(sweptIdSets.some(ids => JSON.stringify(ids) === JSON.stringify(expectedIds))).toBe(true)
    }
  })

  it('skips a driver whose locked rows sum to zero (e.g. already swept by an overlapping run)', async () => {
    client.query.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT DISTINCT')) {
        return Promise.resolve({ rows: [{ driver_id: '42', bank_account_id: '5' }] })
      }
      if (sql.includes('FOR UPDATE')) {
        // Simulates a concurrent run already having swept these rows out of
        // 'cleared' before this transaction's lock was granted.
        return Promise.resolve({ rows: [] })
      }
      return mockClientQuery(sql, params)
    })
    poolQuery.mockResolvedValueOnce({ rows: [{ value: '50000' }] })

    await runScheduledSettlementBatch()

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.filter(s => s.includes('INSERT INTO settlements'))).toHaveLength(0)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(true)
  })
})
