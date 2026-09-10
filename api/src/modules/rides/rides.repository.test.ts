import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}))
// getEligibleDriverCategoryIds now reads through the category_fallback_rules cache
// (@/lib/cache/reference-cache -> @/db/redis) — without this mock it hits a real,
// reachable local Redis and can serve a value cached by an earlier test/run instead
// of the pg mock above.
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  client: { del: vi.fn().mockResolvedValue(1) },
}))

import { getEligibleDriverCategoryIds, findNearbyDrivers, findReturnCabDrivers, getCategoryDisplayName, getRideById, getRideCoreById, getRideCoreForDriverAction } from './rides.repository'

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

describe('getRideById', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('joins vehicle_categories for both booked and assigned category names', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1' }] })

    await getRideById(1n)

    const [sql] = mockQuery.mock.calls[0] as [string]
    expect(sql).toContain('booked_category_name')
    expect(sql).toContain('assigned_category_name')
  })
})

describe('getRideCoreById', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('queries rides directly with no joins', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1' }] })

    await getRideCoreById(1n)

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('LEFT JOIN')
    expect(sql).toContain('FROM rides r')
    expect(sql).toContain('WHERE r.id = $1')
    expect(params).toEqual([1n])
  })

  it('returns null when no row matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await getRideCoreById(999n)
    expect(result).toBeNull()
  })
})

describe('getRideCoreForDriverAction', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('scopes the query by both id and driver_id, no joins', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1', driver_id: '7' }] })

    await getRideCoreForDriverAction(1n, 7n)

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('LEFT JOIN')
    expect(sql).toContain('WHERE r.id = $1 AND r.driver_id = $2')
    expect(params).toEqual([1n, 7n])
  })

  it('returns null for a ride owned by a different driver (ownership scoped at the query, not app-checked after fetch)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await getRideCoreForDriverAction(1n, 999n)
    expect(result).toBeNull()
  })
})
