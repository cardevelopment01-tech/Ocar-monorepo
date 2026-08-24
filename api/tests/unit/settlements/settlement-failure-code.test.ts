import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }))

import { mapPayoutFailureCode, getSettlementBatchDetail } from '@/modules/payments/submodules/settlements/settlements.service'

describe('mapPayoutFailureCode', () => {
  it('maps a known RazorpayX reason to a stable safe code', () => {
    expect(mapPayoutFailureCode('invalid_fund_account')).toBe('PAYOUT_INVALID_ACCOUNT')
    expect(mapPayoutFailureCode('insufficient_balance')).toBe('PAYOUT_INSUFFICIENT_PLATFORM_BALANCE')
  })

  it('falls back to PAYOUT_FAILED for unknown or missing reasons', () => {
    expect(mapPayoutFailureCode('some_brand_new_reason')).toBe('PAYOUT_FAILED')
    expect(mapPayoutFailureCode(undefined)).toBe('PAYOUT_FAILED')
    expect(mapPayoutFailureCode(null)).toBe('PAYOUT_FAILED')
  })
})

describe('getSettlementBatchDetail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns failure_code, never the raw failure_reason text', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: '1', failure_code: 'PAYOUT_FAILED' }] })
    await getSettlementBatchDetail('2026-07-23', '2026-07-24')
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain('failure_code')
    expect(sql).not.toContain('failure_reason')
  })
})
