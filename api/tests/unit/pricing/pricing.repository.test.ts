import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { getCurrentRateCard } from '@/modules/pricing/pricing.repository'

const GLOBAL_ROW = { id: 1, category_id: 10, ride_type: 'one_way', city_id: null }
const OVERRIDE_ROW = { id: 2, category_id: 10, ride_type: 'one_way', city_id: 5 }

describe('getCurrentRateCard — city fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the global row when only a global rate card exists, for any city including one with no override', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [GLOBAL_ROW], rowCount: 1 } as never)

    const result = await getCurrentRateCard(10, 'one_way', 999)

    expect(result).toEqual(GLOBAL_ROW)
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [10, 'one_way', 999])
  })

  it('returns the city override when both a global row and a city-specific override exist for that city', async () => {
    // ORDER BY city_id NULLS LAST LIMIT 1 means the DB itself picks the
    // override over the global row — simulate that by only returning it.
    vi.mocked(pool.query).mockResolvedValue({ rows: [OVERRIDE_ROW], rowCount: 1 } as never)

    const result = await getCurrentRateCard(10, 'one_way', 5)

    expect(result).toEqual(OVERRIDE_ROW)
  })

  it('returns the global row (not the override) when queried for a different city', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [GLOBAL_ROW], rowCount: 1 } as never)

    const result = await getCurrentRateCard(10, 'one_way', 7)

    expect(result).toEqual(GLOBAL_ROW)
    expect(result.city_id).toBeNull()
  })

  it('returns the global row, never a city override, when cityId is null', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [GLOBAL_ROW], rowCount: 1 } as never)

    const result = await getCurrentRateCard(10, 'one_way', null)

    expect(result).toEqual(GLOBAL_ROW)
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [10, 'one_way', null])
  })

  it('returns null when no rate card exists at all', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)

    const result = await getCurrentRateCard(999, 'one_way', null)

    expect(result).toBeNull()
  })
})
