import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { getGpsTrackedDistanceKm } from '@/modules/rides/rides.repository'

describe('getGpsTrackedDistanceKm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when the query reports km: null (<2 points or unknown ride_id)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: null }], rowCount: 1 } as never)

    const result = await getGpsTrackedDistanceKm(BigInt(101), new Date('2026-08-01T00:00:00Z'))

    expect(result).toBeNull()
  })

  it('returns a number (not string) when the query reports a km value', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: '123.45' }], rowCount: 1 } as never)

    const result = await getGpsTrackedDistanceKm(BigInt(101), new Date('2026-08-01T00:00:00Z'))

    expect(result).toBe(123.45)
    expect(typeof result).toBe('number')
  })

  it('passes both rideId and since as query params (partition-pruning regression guard)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: null }], rowCount: 1 } as never)
    const since = new Date('2026-08-01T00:00:00Z')

    await getGpsTrackedDistanceKm(BigInt(101), since)

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [BigInt(101), since])
  })
})
