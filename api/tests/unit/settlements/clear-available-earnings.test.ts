import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { clearAvailableEarnings } from '@/modules/payments/submodules/settlements/settlements.service'

describe('clearAvailableEarnings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flips pending -> cleared for lines past their hold window', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 3 })
    await clearAvailableEarnings()

    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = 'cleared'")
    expect(sql).toContain("WHERE status = 'pending'")
    expect(sql).toContain('available_at <= now()')
  })
})
