import { describe, it, expect, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { setupOnlineDriver, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'

const TEST_PLACE_ID = 'ChIJTestPlaceId12345'

const PHONES = {
  gpsDriver: '+919700000105',
  nearDriver: '+919700000107',
  farDriver: '+919700000108',
} as const
const ALL_PHONES = Object.values(PHONES)

afterAll(async () => {
  // Runs regardless of test outcome — a failed assertion mid-test must not
  // leak this row and permanently wedge the next run's cache-miss assumption.
  await pool.query('DELETE FROM place_geocode_cache WHERE normalized_address = $1', [`place:${TEST_PLACE_ID}`])
  await cleanupRideAndDriverData(pool, [...ALL_PHONES])
  for (const p of ALL_PHONES) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:user:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.end()
  redis.disconnect()
})

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

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
      const placeId = TEST_PLACE_ID

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
      expect(afterRows).toHaveLength(1)
      expect(afterRows[0]?.hit_count).toBeGreaterThan(cacheRows[0]?.hit_count as number)
    })
  })

  describe('GPS tracking and driver search', () => {
    // TC-M05-003's happy path (flush writes valid points, drops low-accuracy
    // ones) is already exercised end-to-end by m07.test.ts's TC-M07-009 —
    // not duplicated here (the two tests were previously byte-identical).
    // This test instead covers the validation-error path that TC-M07-009
    // doesn't touch: an empty tracks array.
    it('TC-M05-003: GPS track flush rejects an empty tracks array', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.gpsDriver, { categorySlug: 'sedan' })

      const res = await request(app)
        .post('/api/v1/geo/tracks/flush')
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ tracks: [] })
      expect(res.status, JSON.stringify(res.body)).toBe(422)
      expect(res.body.code).toBe('VALIDATION_ERROR')
    })

    it('TC-M05-004: nearby-drivers search only returns drivers within radius', async () => {
      const nearDriver = await setupOnlineDriver(app, pool, redis, PHONES.nearDriver, { categorySlug: 'sedan' })
      // Far driver: seed then manually move their location snapshot far away.
      // setupOnlineDriver's goOnline call populates driver_location_snapshots
      // (via upsertDriverLocation in rides.service.ts's goOnline) — that's the
      // table findAllNearbyDrivers reads from, so overriding it here is correct.
      const farDriver = await setupOnlineDriver(app, pool, redis, PHONES.farDriver, { categorySlug: 'sedan' })
      await pool.query(
        `UPDATE driver_location_snapshots SET location = ST_SetSRID(ST_MakePoint(88.36, 22.57), 4326)::geography WHERE driver_id = $1`,
        [farDriver.driverId]
      )

      // No categoryId param — rides.routes.ts's nearby-drivers handler only
      // reads lat/lng/radius, it doesn't filter by category at all.
      const res = await request(app).get('/api/v1/rides/nearby-drivers?lat=20.29&lng=85.82')
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const ids = (res.body.drivers as Array<{ driver_id: string }>).map((d) => String(d.driver_id))
      expect(ids).toContain(String(nearDriver.driverId))
      expect(ids).not.toContain(String(farDriver.driverId))
    })
  })
})
