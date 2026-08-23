import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

// retryNeverSubmittedSettlement's dev-mode branch reads config directly,
// same pattern as submit-processing-settlements.test.ts.
// REDIS_URL must be present: settlements.service now transitively imports
// @/lib/system-config -> @/lib/cache/reference-cache -> @/db/redis, which
// builds a real Redis client from config.REDIS_URL at import time.
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAYX_ACCOUNT_NUMBER: '', REDIS_URL: 'redis://localhost:6379', NODE_ENV: 'test' } }))

import { listStuckSettlements, retryFailedSettlement, retryNeverSubmittedSettlement, getDriverTaxStatement } from '@/modules/payments/submodules/settlements/settlements.service'
import { setBankAccountStatus, listUnverifiedBankAccounts } from '@/modules/payments/submodules/settlements/bank-accounts.service'

describe('admin reconciliation + tax', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listStuckSettlements finds processing rows past a threshold, both never-submitted and awaiting-webhook', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    const rows = await listStuckSettlements()
    expect(rows).toHaveLength(1)
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("status = 'processing'")
    expect(sql).not.toContain('razorpay_payout_id IS NULL')
    expect(sql).toContain('stuck_reason')
  })

  it('retryFailedSettlement returns false when the old row is not failed (or does not exist)', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    const ok = await retryFailedSettlement(BigInt(901))
    expect(ok).toBe(false)
    expect(client.query).not.toHaveBeenCalled()
  })

  it('retryFailedSettlement re-derives the payout from currently-cleared earnings (lock-and-sum), not the stale old amount', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ driver_id: '42', bank_account_id: '5', run_type: 'scheduled' }],
    })
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, amount FROM driver_earnings') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [
            { id: '501', amount: '300.00' },
            { id: '502', amount: '120.00' },
          ],
        })
      }
      if (sql.includes('INSERT INTO settlements')) {
        return Promise.resolve({ rows: [{ id: '950' }] })
      }
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    const ok = await retryFailedSettlement(BigInt(901))
    expect(ok).toBe(true)

    const calls = client.query.mock.calls as Array<[string, unknown[]?]>
    const lockCall = calls.find(([sql]) => sql.includes('FOR UPDATE'))
    expect(lockCall).toBeDefined()
    expect((lockCall![1] as unknown[])[0]).toBe('42')

    const insertCall = calls.find(([sql]) => sql.includes('INSERT INTO settlements'))
    expect(insertCall).toBeDefined()
    const insertParams = insertCall![1] as unknown[]
    expect(insertParams[2]).toBe(420) // freshly summed, not the old row's stale net_payout
    expect(insertParams[3]).toBe('scheduled')
    expect(insertParams[4]).toBe('5')

    const sweepCall = calls.find(([sql]) => sql.includes('UPDATE driver_earnings') && sql.includes("'in_payout'"))
    expect(sweepCall).toBeDefined()
    expect((sweepCall![1] as unknown[])[0]).toEqual(['501', '502'])

    expect(calls.some(([sql]) => sql.includes('COMMIT'))).toBe(true)
  })

  it('retryFailedSettlement returns false and rolls back when currently-cleared earnings sum to zero', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ driver_id: '42', bank_account_id: '5', run_type: 'scheduled' }],
    })
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, amount FROM driver_earnings') && sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [] })
      }
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    const ok = await retryFailedSettlement(BigInt(901))
    expect(ok).toBe(false)

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(calls.some(s => s.includes('INSERT INTO settlements'))).toBe(false)
  })

  it('retryNeverSubmittedSettlement submits immediately (dev mode) for a processing/unsubmitted row', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ id: '901', driver_id: '42', net_payout: '850.00' }] }) // SELECT match
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements completed (dev mode)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE driver_earnings paid
    const ok = await retryNeverSubmittedSettlement(BigInt(901))
    expect(ok).toBe(true)
    const [selectSql, selectParams] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(selectSql).toContain("status = 'processing'")
    expect(selectSql).toContain('razorpay_payout_id IS NULL')
    expect(selectParams).toEqual([BigInt(901)])
    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes("UPDATE settlements") && s.includes("'completed'"))).toBe(true)
  })

  it('retryNeverSubmittedSettlement returns false when the row is not processing/unsubmitted (e.g. already claimed or failed)', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    const ok = await retryNeverSubmittedSettlement(BigInt(902))
    expect(ok).toBe(false)
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })

  it('getDriverTaxStatement aggregates tax_deductions by FY', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ fy: '2026-2027', total_tds: '340.00' }] })
    const statement = await getDriverTaxStatement(BigInt(42), '2026-2027')
    expect(statement.totalTds).toBe(340)
  })

  it('setBankAccountStatus (non-verified transition) just updates status, no gateway call', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 })
    const result = await setBankAccountStatus(BigInt(5), 'invalid')
    expect(result).toEqual({ ok: true })
    expect(poolQuery).toHaveBeenCalledTimes(1)
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = $2")
  })

  it('setBankAccountStatus (verified, dev mode) sets a placeholder fund account id then flips status', async () => {
    poolQuery
      .mockResolvedValueOnce({ rowCount: 1 }) // placeholder gateway_fund_account_id UPDATE
      .mockResolvedValueOnce({ rowCount: 1 }) // status UPDATE
    const result = await setBankAccountStatus(BigInt(5), 'verified')
    expect(result).toEqual({ ok: true })
    const calls = poolQuery.mock.calls as Array<[string, unknown[]?]>
    expect(calls[0]![0]).toContain('gateway_fund_account_id')
    expect((calls[0]![1] as unknown[])[1]).toBe('dev_fund_account_5')
    expect(calls[1]![0]).toContain('SET status = $2')
  })

  it('listUnverifiedBankAccounts returns pending/invalid accounts', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    await listUnverifiedBankAccounts()
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain('pending_verification')
  })
})
