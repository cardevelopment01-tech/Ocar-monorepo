import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

// retryNeverSubmittedSettlement's dev-mode branch reads config directly,
// same pattern as submit-processing-settlements.test.ts.
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAYX_ACCOUNT_NUMBER: '' } }))

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

  it('retryFailedSettlement resets a failed row back to processing for resubmission', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 })
    const ok = await retryFailedSettlement(BigInt(901))
    expect(ok).toBe(true)
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = 'processing'")
    expect(sql).toContain('razorpay_payout_id = NULL')
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

  it('setBankAccountStatus updates verification state', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 })
    await setBankAccountStatus(BigInt(5), 'verified')
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = $2")
  })

  it('listUnverifiedBankAccounts returns pending/invalid accounts', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    await listUnverifiedBankAccounts()
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain('pending_verification')
  })
})
