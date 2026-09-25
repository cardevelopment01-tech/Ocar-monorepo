import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'

// T3 (see docs/superpowers/specs/2026-09-25-admin-city-boundary-editor-plan.md,
// decisions R2 and R7): findContainingCity gained a deterministic ORDER BY
// (overlapping boundaries no longer pick an arbitrary row) and a
// status = 'active' filter (a draft/inactive city's boundary no longer
// affects classification). Exercised through the public classify-trip
// endpoint, since findContainingCity itself isn't exported outside the module.

const app = createApp()

afterAll(async () => {
  await pool.end()
  redis.disconnect()
})

describe('GET /api/v1/geo/classify-trip — findContainingCity ordering (T3)', () => {
  it('R2: with two identical boundaries (Bhubaneswar/Cuttack), the trip is always labeled by the city with the nearest centroid', async () => {
    // A point at (or effectively at) Bhubaneswar's seeded centroid
    // (85.8245, 20.2961) — both cities' boundary is the same box, both
    // contain this point, so only the centroid-distance tie-break decides.
    const res = await request(app).get(
      '/api/v1/geo/classify-trip?originLat=20.2961&originLng=85.8245&destLat=20.30&destLng=85.82'
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.scope).toBe('in_city')
    expect(res.body.cityName).toBe('Bhubaneswar')

    // Repeat near Cuttack's centroid (85.883, 20.4686) — same shared box,
    // opposite tie-break winner. Proves the result is deterministic per
    // origin, not an arbitrary row Postgres happens to return first.
    const res2 = await request(app).get(
      '/api/v1/geo/classify-trip?originLat=20.4686&originLng=85.883&destLat=20.46&destLng=85.88'
    )
    expect(res2.status, JSON.stringify(res2.body)).toBe(200)
    expect(res2.body.scope).toBe('in_city')
    expect(res2.body.cityName).toBe('Cuttack')
  })

  it('R7: a trip entirely inside a draft city (Puri) does not classify as in_city', async () => {
    // Puri is seeded as status='draft' with a real boundary (083 backfill).
    // Two points solidly inside its bbox (85.8064-85.8708, 19.7893-19.8256).
    const res = await request(app).get(
      '/api/v1/geo/classify-trip?originLat=19.810&originLng=85.830&destLat=19.815&destLng=85.835'
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.scope).toBe('outstation')
    expect(res.body.cityId).toBeNull()
  })

  it('regression: an ordinary single-boundary active city still classifies as in_city (Rourkela)', async () => {
    // Two points inside Rourkela's boundary (centroid ~84.85, 22.25) —
    // no overlap, no active-filter change in play; proves the ORDER BY/
    // status filter didn't break the unambiguous case.
    const res = await request(app).get(
      '/api/v1/geo/classify-trip?originLat=22.25&originLng=84.85&destLat=22.26&destLng=84.86'
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.scope).toBe('in_city')
    expect(res.body.cityName).toBe('Rourkela')
  })
})
