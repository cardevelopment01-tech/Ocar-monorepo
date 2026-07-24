import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { listStuckSettlements, retryFailedSettlement, getDriverTaxStatement } from '@/modules/payments/submodules/settlements/settlements.service'
import { setBankAccountStatus, listUnverifiedBankAccounts } from '@/modules/payments/submodules/settlements/bank-accounts.service'

describe('admin reconciliation + tax', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listStuckSettlements finds processing rows past a threshold with no gateway payout id', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    const rows = await listStuckSettlements()
    expect(rows).toHaveLength(1)
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("status = 'processing'")
  })

  it('retryFailedSettlement resets a failed row back to processing for resubmission', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 })
    const ok = await retryFailedSettlement(BigInt(901))
    expect(ok).toBe(true)
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = 'processing'")
    expect(sql).toContain('razorpay_payout_id = NULL')
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
