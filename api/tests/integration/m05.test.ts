import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'

vi.mock('@/modules/geo/providers/google.provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/geo/providers/google.provider')>()
  return {
    ...actual,
    placeDetails: vi.fn().mockResolvedValue({
      placeId: 'ChIJTestPlaceId12345',
      address: 'Bhubaneswar, Odisha, India',
      lat: 20.2961,
      lng: 85.8245,
    }),
  }
})

const app = createApp()

describe('M05 — Geo & Spatial', () => {
  describe('City lookup', () => {
    it('TC-M05-001: nearest-city lookup returns the closest active city', async () => {
      // Coordinates very close to Bhubaneswar's seeded centroid (85.8245, 20.2961).
      const res = await request(app).get('/api/v1/geo/cities/nearest?lat=20.30&lng=85.82')
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.slug).toBe('bhubaneswar')

      const missingRes = await request(app).get('/api/v1/geo/cities/nearest')
      expect(missingRes.status).toBe(422)
      expect(missingRes.body.code).toBe('VALIDATION_ERROR')
    })

    // Deferred — no city_zones table exists (commented out as Phase 2 in
    // 005_m3_geo.sql); zone_type enum is defined but unused anywhere in the
    // codebase. Nothing to test against.
    it.todo('TC-M05-002: zone lookup identifies city vs highway zone — no city_zones implementation exists yet')
  })

  describe('Geocode cache', () => {
    it('TC-M05-005: geocode cache hit avoids the external Google call on repeat lookup', async () => {
      const placeId = 'ChIJTestPlaceId12345'

      const google = await import('@/modules/geo/providers/google.provider')

      const firstRes = await request(app).get(`/api/v1/geo/place/${placeId}`)
      expect(firstRes.status, JSON.stringify(firstRes.body)).toBe(200)
      expect(google.placeDetails).toHaveBeenCalledTimes(1)

      const { rows: cacheRows } = await pool.query(
        'SELECT hit_count FROM place_geocode_cache WHERE normalized_address = $1', [`place:${placeId}`]
      )
      expect(cacheRows).toHaveLength(1)

      const secondRes = await request(app).get(`/api/v1/geo/place/${placeId}`)
      expect(secondRes.status, JSON.stringify(secondRes.body)).toBe(200)
      // Still called exactly once — the second request must be served from cache.
      expect(google.placeDetails).toHaveBeenCalledTimes(1)

      const { rows: afterRows } = await pool.query(
        'SELECT hit_count FROM place_geocode_cache WHERE normalized_address = $1', [`place:${placeId}`]
      )
      expect(afterRows[0]?.hit_count).toBeGreaterThan(cacheRows[0]?.hit_count as number)

      await pool.query('DELETE FROM place_geocode_cache WHERE normalized_address = $1', [`place:${placeId}`])
      await pool.end()
    })
  })
})
