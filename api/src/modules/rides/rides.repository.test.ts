import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}))

import { getEligibleDriverCategoryIds } from './rides.repository'

describe('getEligibleDriverCategoryIds', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('returns the rider category plus any fallback driver categories', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ category_id: '1' }] })

    const result = await getEligibleDriverCategoryIds(2n)

    expect(result).toEqual([2n, 1n])
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM category_fallback_rules'),
      [2n]
    )
  })

  it('returns only the rider category when no fallback rows target it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getEligibleDriverCategoryIds(5n)

    expect(result).toEqual([5n])
  })
})
