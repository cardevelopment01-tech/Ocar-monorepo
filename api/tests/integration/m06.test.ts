import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { invalidateSurgeCache } from '@/modules/pricing/pricing.repository'

const app = createApp()

let categoryId: number
let cityId: number

beforeAll(async () => {
  const { rows: cats } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  categoryId = Number(cats[0]!.id)
  const { rows: cities } = await pool.query<{ id: string }>("SELECT id FROM cities WHERE slug = 'bhubaneswar' LIMIT 1")
  cityId = Number(cities[0]!.id)
})

afterAll(async () => {
  await pool.end()
})

describe('M06 — Pricing', () => {
  describe('Fare estimate', () => {
    it('TC-M06-001 + TC-M06-004: one-way estimate reflects distance and per-minute rate', async () => {
      const res = await request(app)
        .post('/api/v1/pricing/estimate')
        .send({ category_id: categoryId, ride_type: 'one_way', distance_km: 10, duration_min: 20 })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.breakdown.total).toBeGreaterThan(0)
      // sedan seed rate (verified live in ocar_test): 13/km, 2/min, min_fare 250 —
      // 10km*13 + 20min*2 = 170, floored against min_fare 250, so total is exactly 250.
      expect(res.body.breakdown.total).toBeCloseTo(250, 1)
      expect(res.body.breakdown.time_fare).toBeCloseTo(40, 1) // 20min * 2/min
      expect(res.body.breakdown.distance_fare).toBeCloseTo(130, 1) // 10km * 13/km
    })

    it('TC-M06-002: active surge multiplies the fare', async () => {
      // Seed an active surge directly (admin HTTP creation is covered in Task 6;
      // this test isolates fare-calculation behavior from admin-authorization concerns).
      const { rows: surgeRows } = await pool.query<{ id: string }>(
        `INSERT INTO surge_events (city_id, category_id, multiplier, status, starts_at, ends_at)
         VALUES ($1, $2, 1.5, 'active', now() - interval '5 minutes', now() + interval '1 hour')
         RETURNING id`,
        [cityId, categoryId]
      )
      // getActiveSurge caches its result in Redis (up to 5 min TTL) and only the
      // repository's own create/cancel paths invalidate that cache -- this test
      // inserts/deletes via raw SQL, so a prior run's cached surge (or this run's,
      // for the delete below) would otherwise leak into the next request.
      await invalidateSurgeCache(cityId, categoryId)

      try {
        const res = await request(app)
          .post('/api/v1/pricing/estimate')
          .send({ category_id: categoryId, ride_type: 'one_way', distance_km: 10, duration_min: 20, city_id: cityId })
        expect(res.status, JSON.stringify(res.body)).toBe(200)
        expect(res.body.surge_multiplier).toBe(1.5)
        expect(res.body.surge_event_id).toBe(surgeRows[0]!.id)
        expect(res.body.breakdown.surge_fare).toBeGreaterThan(0)
        // subtotal floors at 250 (same as TC-M06-001), surge adds 50% on top.
        expect(res.body.breakdown.total).toBeCloseTo(375, 1)
      } finally {
        await pool.query('DELETE FROM surge_events WHERE id = $1', [surgeRows[0]!.id])
        await invalidateSurgeCache(cityId, categoryId)
      }
    })

    it('TC-M06-005: round-trip estimate doubles distance and applies the round_trip rate card', async () => {
      const res = await request(app)
        .post('/api/v1/pricing/estimate')
        .send({ category_id: categoryId, ride_type: 'round_trip', distance_km: 15, duration_min: 30, trip_hours: 6 })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.breakdown.total).toBeGreaterThan(0)
      // trip_hours 6 -> clamped to max(4, ceil(6))=6 -> 1 day (ceil(6/24)=1).
      // packageKm = 1 * km_per_day(250) = 250; distance_km sent is doubled to 30,
      // which is under the 250km package floor, so overage is 0 and distance_fare
      // is billed at the full package km (250 * 13/km = 3250).
      expect(res.body.breakdown.distance_fare).toBeCloseTo(3250, 1)
      expect(res.body.breakdown.overage_fare).toBeCloseTo(0, 1)
      // driver allowance: 1 day * 300/day = 300 (surfaced via hour_surcharge field).
      expect(res.body.breakdown.hour_surcharge).toBeCloseTo(300, 1)
    })

    it('TC-M06-006: rental estimate uses the matched rental package fare', async () => {
      const { rows: pkgRows } = await pool.query<{ id: string; duration_minutes: number; package_fare: string }>(
        'SELECT id, duration_minutes, package_fare FROM rental_packages WHERE category_id = $1 AND city_id IS NULL ORDER BY duration_minutes LIMIT 1',
        [categoryId]
      )
      if (!pkgRows[0]) throw new Error('No global rental package seeded for sedan — check 016_seed.sql / 030_rental_package_flexibility.sql')

      const res = await request(app)
        .post('/api/v1/pricing/estimate')
        .send({ category_id: categoryId, ride_type: 'rental', distance_km: 10, duration_min: 60, rental_package_id: Number(pkgRows[0].id) })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.rental_hours).toBe(Math.round(pkgRows[0].duration_minutes / 60))
      expect(res.body.breakdown.total).toBeCloseTo(parseFloat(pkgRows[0].package_fare), 1)
    })

    // Deferred — no highway-rate concept exists anywhere in pricing.service.ts
    // or @/lib/fare. Nothing to test against.
    it.todo('TC-M06-003: highway rate applies for highway zone segments — no highway-rate concept implemented')

    // Deferred — confirmed via source read: no scanner/job exists anywhere under
    // api/src/jobs/** that transitions surge_events.status from 'scheduled' to
    // 'active'. createSurgeEvent (pricing.repository.ts) always inserts status
    // 'scheduled'; getActiveSurge only ever reads WHERE status = 'active' directly
    // and never itself flips a row's status. dispatch-scheduled.processor.ts's one
    // "surge" match is an unrelated comment about recomputing fare at ride
    // completion, not surge activation.
    // FLAG: this looks like a real product gap — a surge scheduled with a future
    // starts_at will sit at status='scheduled' forever and never actually apply,
    // even after its starts_at has passed, unless something else out-of-repo (a
    // cron, a manual admin action) flips it. Surfaced to the user per this
    // session's process for real bugs found during test-writing; not fixed here.
    it.todo('TC-M06-007: surge activator job activates scheduled surge on time — no such job exists, possible real gap')
  })
})
