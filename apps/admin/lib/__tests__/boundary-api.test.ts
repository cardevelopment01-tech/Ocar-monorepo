import { describe, it, expect, vi, beforeEach } from 'vitest'

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))
vi.mock('../api', () => ({ default: http }))

import { boundaryApi, type CityBoundaryGeoJson } from '../boundary-api'

const POLY: CityBoundaryGeoJson = { type: 'Polygon', coordinates: [[[84, 21], [84.1, 21], [84.1, 21.1], [84, 21]]] }

beforeEach(() => { vi.clearAllMocks() })

describe('boundaryApi', () => {
  it('get: GETs the city boundary and unwraps data', async () => {
    http.get.mockResolvedValue({ data: { name: 'Puri', boundary: null, updatedAt: '2026-09-25T00:00:00.000Z' } })
    await expect(boundaryApi.get(3)).resolves.toEqual({ name: 'Puri', boundary: null, updatedAt: '2026-09-25T00:00:00.000Z' })
    expect(http.get).toHaveBeenCalledWith('/api/v1/admin/geo/cities/3/boundary')
  })

  it('preview: POSTs { geojson } to the preview route', async () => {
    http.post.mockResolvedValue({ data: { isValid: true } })
    await boundaryApi.preview(7, POLY)
    expect(http.post).toHaveBeenCalledWith('/api/v1/admin/geo/cities/7/boundary/preview', { geojson: POLY })
  })

  it('save: PUTs geojson with the optimistic-lock version', async () => {
    http.put.mockResolvedValue({ data: { boundary: POLY, previousBoundary: null, updatedAt: 'v2' } })
    const r = await boundaryApi.save(7, POLY, 'v1')
    expect(http.put).toHaveBeenCalledWith('/api/v1/admin/geo/cities/7/boundary', { geojson: POLY, expectedUpdatedAt: 'v1' })
    expect(r.updatedAt).toBe('v2')
  })

  it('remove: sends expectedUpdatedAt in the DELETE body (axios needs { data })', async () => {
    http.delete.mockResolvedValue({ data: { previousBoundary: POLY, updatedAt: 'v3' } })
    await boundaryApi.remove(7, 'v2')
    expect(http.delete).toHaveBeenCalledWith('/api/v1/admin/geo/cities/7/boundary', { data: { expectedUpdatedAt: 'v2' } })
  })

  it('propagates request failures to the caller (no swallowing)', async () => {
    http.put.mockRejectedValue(new Error('409'))
    await expect(boundaryApi.save(7, POLY, 'stale')).rejects.toThrow('409')
  })
})
