import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({
  query: vi.fn(),
  pool: { query: vi.fn() },
}))

import { query } from '@/db/client'
import { docIssueExistsSql, hasApprovedRequiredDocs } from '@/modules/drivers/drivers.repository'

describe('docIssueExistsSql', () => {
  it('builds an EXISTS check over both doc tables using the given driver-id expression', () => {
    const sql = docIssueExistsSql('ds.driver_id')
    expect(sql).toContain('EXISTS')
    expect(sql).toContain('driver_documents')
    expect(sql).toContain('driver_vehicle_documents')
    expect(sql).toContain('ds.driver_id')
    // gating reads the admin-verified expiry only, never the driver's claim
    expect(sql).toContain('verified_valid_until < CURRENT_DATE')
    expect(sql).not.toContain('claimed_valid_until')
  })

  it('accepts a bound-parameter expression for the single-driver rollup', () => {
    expect(docIssueExistsSql('$1')).toContain('dd.driver_id = $1')
  })
})

describe('hasApprovedRequiredDocs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when no issue row exists', async () => {
    vi.mocked(query).mockResolvedValue([{ has_issue: false }] as never)
    await expect(hasApprovedRequiredDocs(BigInt(7))).resolves.toBe(true)
    const sql = vi.mocked(query).mock.calls[0]![0] as string
    expect(sql).toContain('EXISTS')
  })

  it('returns false when a rejected/expired doc issue exists', async () => {
    vi.mocked(query).mockResolvedValue([{ has_issue: true }] as never)
    await expect(hasApprovedRequiredDocs(BigInt(7))).resolves.toBe(false)
  })
})
