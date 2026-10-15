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

import { getEligibleDriverCategoryIds, findNearbyDrivers, findStaleOnlineDrivers, findReturnCabDrivers, getCategoryDisplayName, getRideById, getRideCoreById, getRideCoreForDriverAction, getActiveRideForDriver } from './rides.repository'

describe('getActiveRideForDriver', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('only counts a finished, unconfirmed cash ride when the caller opts in', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    await getActiveRideForDriver(7n)
    await getActiveRideForDriver(7n, true)
    expect(mockQuery.mock.calls[0]![1]).toEqual([7n, false])
    expect(mockQuery.mock.calls[1]![1]).toEqual([7n, true])
    const sql = String(mockQuery.mock.calls[0]![0])
    expect(sql).toContain('$2::boolean')
    expect(sql).toContain("COALESCE(r.payment_channel::text, 'cash') = 'cash'")
    expect(sql).toContain('r.cash_collected_at IS NULL')
  })
})

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

describe('findStaleOnlineDrivers', () => {
  beforeEach(() => { mockQuery.mockReset() })

  // Regression: the GPS snapshot is not refreshed while on_trip, so a driver finishing a ride
  // longer than the offline threshold was forced offline (stale_heartbeat) the moment their session
  // flipped back to 'online'. Staleness must also respect the session's own last change.
  it('measures staleness from the later of the last fix and the session update', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await findStaleOnlineDrivers(600)

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('GREATEST(dls.recorded_at, ds.updated_at)')
    expect(params).toEqual([600])
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
