import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}))

import { getEligibleDriverCategoryIds, findNearbyDrivers, findReturnCabDrivers, getCategoryDisplayName } from './rides.repository'

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

describe('findReturnCabDrivers', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('filters drivers with category_id = ANY(categoryIds)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await findReturnCabDrivers({
      pickupLat: 20.29,
      pickupLng: 85.82,
      dropLat: 20.46,
      dropLng: 85.88,
      categoryIds: [3n, 2n],
      minWalletBalance: 100,
    })

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ds.category_id = ANY($5::bigint[])')
    expect(params[4]).toEqual([3n, 2n])
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

describe('getCategoryDisplayName', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('returns the display_name for a known category', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ display_name: 'Sedan' }] })
    const result = await getCategoryDisplayName(2n)
    expect(result).toBe('Sedan')
  })

  it('returns null when the category does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await getCategoryDisplayName(999n)
    expect(result).toBeNull()
  })
})
