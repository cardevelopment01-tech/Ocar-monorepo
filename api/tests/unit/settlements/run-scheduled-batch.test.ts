import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

import { runScheduledSettlementBatch } from '@/modules/payments/submodules/settlements/settlements.service'

describe('runScheduledSettlementBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('groups cleared earnings per eligible driver into one settlements row each, in one transaction', async () => {
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT driver_id')) {
        return Promise.resolve({
          rows: [
            { driver_id: '42', bank_account_id: '5', total: '860.00' },
            { driver_id: '43', bank_account_id: '6', total: '120.00' },
          ],
        })
      }
      if (sql.includes('INSERT INTO settlements')) {
        return Promise.resolve({ rows: [{ id: '900' }] })
      }
      return Promise.resolve({ rows: [], rowCount: 1 })
    })
    poolQuery.mockResolvedValueOnce({ rows: [{ value: '50000' }] }) // settlement_auto_approve_limit

    await runScheduledSettlementBatch()

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.filter(s => s.includes('INSERT INTO settlements'))).toHaveLength(2)
    expect(calls.some(s => s.includes("UPDATE driver_earnings") && s.includes("'in_payout'"))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(true)
  })
})
