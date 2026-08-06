import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}))

import { getEligibleDriverCategoryIds, findNearbyDrivers } from './rides.repository'

describe('findNearbyDrivers', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('filters drivers with category_id = ANY(categoryIds)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await findNearbyDrivers({
      lat: 20.29,
      lng: 85.82,
      categoryIds: [2n, 1n],
      minWalletBalance: 100,
    })

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ds.category_id = ANY($3::bigint[])')
    expect(params[2]).toEqual([2n, 1n])
  })
})

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
