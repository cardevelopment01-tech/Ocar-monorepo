import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { analyzeCityBoundary } from '@/modules/admin/admin.repository'
import type { CityBoundaryGeoJson } from '@/modules/admin/admin.types'

// Real Postgres behavior (probed against PostGIS): ST_GeomFromGeoJSON raises
// SQLSTATE XX000 for GeoJSON it cannot parse; infrastructure failures surface
// as ECONNREFUSED / 57014 (statement timeout) / 08xxx (connection class).
const POLY: CityBoundaryGeoJson = { type: 'Polygon', coordinates: [[[84, 21], [84.1, 21], [84.1, 21.1], [84, 21]]] }
const pgError = (code: string, message = 'boom') => Object.assign(new Error(message), { code })

beforeEach(() => vi.clearAllMocks())

describe('analyzeCityBoundary error handling', () => {
  it('reports an "invalid shape" result when PostGIS cannot parse the GeoJSON (XX000)', async () => {
    vi.mocked(pool.query).mockRejectedValue(pgError('XX000', 'invalid GeoJson representation'))
    const result = await analyzeCityBoundary(BigInt(7), POLY)
    expect(result.isValid).toBe(false)
    expect(result.invalidReason).toBe('Could not parse this shape as a valid polygon')
    // Never leak PostGIS's raw message to the admin.
    expect(JSON.stringify(result)).not.toContain('invalid GeoJson representation')
  })

  it.each([
    ['connection refused', 'ECONNREFUSED'],
    ['statement timeout', '57014'],
    ['connection failure class', '08006'],
    ['too many connections', '53300'],
  ])('lets an infrastructure failure propagate (%s) instead of calling the shape invalid', async (_label, code) => {
    const err = pgError(code)
    vi.mocked(pool.query).mockRejectedValue(err)
    await expect(analyzeCityBoundary(BigInt(7), POLY)).rejects.toBe(err)
  })

  it('lets an error with no code propagate (unknown failures are not "bad input")', async () => {
    const err = new Error('pool exhausted')
    vi.mocked(pool.query).mockRejectedValue(err)
    await expect(analyzeCityBoundary(BigInt(7), POLY)).rejects.toBe(err)
  })

  it('maps a normal row through unchanged on success', async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{
        is_valid: true, invalid_reason: null, vertex_count: 4, area_km2: 12.5,
        bbox_width_km: 3, bbox_height_km: 4, centroid_inside: true, overlaps: [],
      }],
    } as never)
    await expect(analyzeCityBoundary(BigInt(7), POLY)).resolves.toMatchObject({ isValid: true, vertexCount: 4, areaKm2: 12.5 })
  })

  it('adds the change versus the saved boundary, with pickup counts from a second query', async () => {
    const base = { is_valid: true, invalid_reason: null, vertex_count: 4, area_km2: 12.5, bbox_width_km: 3, bbox_height_km: 4, centroid_inside: true, overlaps: [] }
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ ...base, added_km2: 2.5, removed_km2: 0.4 }] } as never)
      .mockResolvedValueOnce({ rows: [{ pickups_added: 9, pickups_removed: 2 }] } as never)
    const r = await analyzeCityBoundary(BigInt(7), POLY)
    expect(r.change).toEqual({ addedKm2: 2.5, removedKm2: 0.4, pickupsAdded: 9, pickupsRemoved: 2, windowDays: 30 })
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(2)
  })

  it('still returns the area change when the pickup count fails, and skips the count when nothing moved', async () => {
    const base = { is_valid: true, invalid_reason: null, vertex_count: 4, area_km2: 12.5, bbox_width_km: 3, bbox_height_km: 4, centroid_inside: true, overlaps: [] }
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ ...base, added_km2: 1, removed_km2: 0 }] } as never)
      .mockRejectedValueOnce(new Error('statement timeout'))
    expect((await analyzeCityBoundary(BigInt(7), POLY)).change).toMatchObject({ addedKm2: 1, pickupsAdded: null, pickupsRemoved: null })
    vi.mocked(pool.query).mockClear()
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ ...base, added_km2: 0, removed_km2: 0 }] } as never)
    expect((await analyzeCityBoundary(BigInt(7), POLY)).change).toMatchObject({ pickupsAdded: null })
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1)
  })

  it('has no change when the city has no saved boundary', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ is_valid: true, invalid_reason: null, vertex_count: 4, area_km2: 1, bbox_width_km: 1, bbox_height_km: 1, centroid_inside: true, overlaps: [], added_km2: null, removed_km2: null }] } as never)
    expect((await analyzeCityBoundary(BigInt(7), POLY)).change).toBeNull()
  })
})
