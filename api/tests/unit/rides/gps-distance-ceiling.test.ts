import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}))

import { pool } from '@/db/client'
import { getGpsTrackedDistanceKm } from '@/modules/rides/rides.repository'

const RIDE_ID = BigInt(101)
const SINCE = new Date('2026-08-24T00:00:00Z')

describe('getGpsTrackedDistanceKm — plausibility ceiling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the GPS distance when within 2.5x the booked distance', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: '20', booked_km: '10' }], rowCount: 1 } as never)
    const result = await getGpsTrackedDistanceKm(RIDE_ID, SINCE)
    expect(result).toBe(20) // 20 <= 10 * 2.5 = 25
  })

  it('returns null when the GPS distance exceeds 2.5x the booked distance', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: '40', booked_km: '10' }], rowCount: 1 } as never)
    const result = await getGpsTrackedDistanceKm(RIDE_ID, SINCE)
    expect(result).toBeNull() // 40 > 25 → implausible → fall back to client estimate
  })

  it('returns null when there are fewer than 2 GPS points (km is null)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: null, booked_km: '10' }], rowCount: 1 } as never)
    const result = await getGpsTrackedDistanceKm(RIDE_ID, SINCE)
    expect(result).toBeNull()
  })

  it('returns the GPS distance unchanged when the booked distance is unknown', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: '40', booked_km: null }], rowCount: 1 } as never)
    const result = await getGpsTrackedDistanceKm(RIDE_ID, SINCE)
    expect(result).toBe(40) // no booked baseline → no ceiling to apply
  })
})
