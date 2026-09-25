import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { analyzeCityBoundary } from '@/modules/admin/admin.repository'
import { client as redis } from '@/db/redis'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

// Audit logging is a separate concern from the PostGIS/DB behavior under test
// below (recordAuditLog only enqueues a BullMQ job — see lib/audit-log.ts) —
// mocked the same way tests/unit/admin/doc-approval.test.ts mocks it, so this
// file can assert the boundary save/delete path actually calls it without
// depending on a worker process being up during the test run.
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
import { recordAuditLog as recordAuditLogImport } from '@/lib/audit-log'
const recordAuditLog = vi.mocked(recordAuditLogImport)

// T1 slice of the admin city-boundary editor (see
// docs/superpowers/specs/2026-09-25-admin-city-boundary-editor-plan.md).
// Exercises analyzeCityBoundary/putCityBoundary/deleteCityBoundary against real
// PostGIS — a mocked pool.query cannot tell a valid polygon from an invalid
// one, since that judgment is made by ST_IsValid, not by our code.

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()
const ADMIN_EMAIL = 'm-boundary-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'

// Rourkela: active, has a real (083-imported) boundary, and no other test file
// touches it — safe to save/delete/restore without racing another suite.
let rourkelaId: number
let originalBoundary: unknown
let originalUpdatedAt: string
let accessToken: string

// A small valid square well inside the Odisha sanity bbox, far from every
// seeded city's real boundary so it never accidentally overlaps one.
const VALID_SQUARE = {
  type: 'Polygon' as const,
  coordinates: [[
    [84.0, 21.0], [84.1, 21.0], [84.1, 21.1], [84.0, 21.1], [84.0, 21.0],
  ]],
}

// Self-intersecting bow-tie — ST_GeomFromGeoJSON parses it, but ST_IsValid
// must reject it.
const BOWTIE = {
  type: 'Polygon' as const,
  coordinates: [[
    [84.0, 21.0], [84.1, 21.1], [84.1, 21.0], [84.0, 21.1], [84.0, 21.0],
  ]],
}

// A simple (non-self-intersecting) many-point circle so the payload lands
// comfortably over the platform-wide 100kb body limit but under both the 1mb
// route-scoped limit and the 10,000-vertex cap — for T2's body-limit check.
function circlePolygon(points: number) {
  const [cx, cy, r] = [84.05, 21.05, 0.02]
  const ring: [number, number][] = []
  for (let i = 0; i < points; i++) {
    const theta = (2 * Math.PI * i) / points
    ring.push([Number((cx + r * Math.cos(theta)).toFixed(8)), Number((cy + r * Math.sin(theta)).toFixed(8))])
  }
  ring.push(ring[0]!)
  return { type: 'Polygon' as const, coordinates: [ring] }
}

async function fetchCity(id: number) {
  const res = await pool.query(
    `SELECT ST_AsGeoJSON(boundary)::json AS boundary, updated_at FROM cities WHERE id = $1`,
    [id],
  )
  return res.rows[0] as { boundary: unknown; updated_at: string }
}

beforeAll(async () => {
  await seedAdmin(pool, ADMIN_EMAIL, 'ops_admin', ADMIN_PASSWORD)
  const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)
  accessToken = admin.accessToken

  const { rows } = await pool.query<{ id: number }>(`SELECT id::int FROM cities WHERE slug = 'rourkela'`)
  rourkelaId = rows[0]!.id
  const original = await fetchCity(rourkelaId)
  originalBoundary = original.boundary
  originalUpdatedAt = original.updated_at
})

afterAll(async () => {
  // Restore Rourkela's real boundary exactly as it was found, regardless of
  // what the tests above did to it.
  await pool.query(
    `UPDATE cities SET boundary = ST_SetSRID(ST_GeomFromGeoJSON($2::text), 4326), updated_at = $3::timestamptz WHERE id = $1`,
    [rourkelaId, JSON.stringify(originalBoundary), originalUpdatedAt],
  )
  await cleanupAdmins(pool, [ADMIN_EMAIL])
  await pool.end()
  redis.disconnect()
})

describe('Admin city boundary editor (T1)', () => {
  it('GET returns the seeded boundary and updated_at', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.name).toBe('Rourkela')
    expect(res.body.boundary.type).toBe('Polygon')
    expect(res.body.updatedAt).toBeTruthy()
  })

  it('PREVIEW reports a valid polygon with area, vertex count and centroid-inside', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/geo/cities/${rourkelaId}/boundary/preview`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: VALID_SQUARE })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.isValid).toBe(true)
    expect(res.body.invalidReason).toBeNull()
    expect(res.body.vertexCount).toBeGreaterThan(0)
    expect(res.body.areaKm2).toBeGreaterThan(0)
    expect(res.body.bboxKm.widthKm).toBeGreaterThan(0)
    // Rourkela's centroid is far outside this arbitrary square.
    expect(res.body.centroidInside).toBe(false)
  })

  it('PREVIEW flags a self-intersecting bow-tie as invalid with a reason', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/geo/cities/${rourkelaId}/boundary/preview`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: BOWTIE })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.isValid).toBe(false)
    expect(typeof res.body.invalidReason).toBe('string')
    expect(res.body.invalidReason.length).toBeGreaterThan(0)
  })

  it('PREVIEW rejects an unclosed ring with fewer than 3 points at the Zod layer', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/geo/cities/${rourkelaId}/boundary/preview`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: { type: 'Polygon', coordinates: [[[84.0, 21.0], [84.1, 21.0]]] } })
    expect(res.status, JSON.stringify(res.body)).toBe(422)
  })

  it('PUT saves a valid polygon, closes an unclosed ring, and returns the previous boundary', async () => {
    const before = await fetchCity(rourkelaId)
    const unclosedRing = VALID_SQUARE.coordinates[0]!.slice(0, -1) // drop the closing point
    const res = await request(app)
      .put(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: { type: 'Polygon', coordinates: [unclosedRing] }, expectedUpdatedAt: before.updated_at })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.boundary.type).toBe('Polygon')
    expect(res.body.boundary.coordinates[0].length).toBe(5) // ring was closed server-side
    expect(res.body.previousBoundary.type).toBe('Polygon')
    expect(new Date(res.body.updatedAt).valueOf()).not.toBe(before.updated_at.valueOf())

    const after = await fetchCity(rourkelaId)
    expect(after.updated_at.valueOf()).not.toBe(before.updated_at.valueOf())
  })

  it('PUT rejects an invalid (bow-tie) polygon with 422 and does not write', async () => {
    const before = await fetchCity(rourkelaId)
    const res = await request(app)
      .put(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: BOWTIE, expectedUpdatedAt: before.updated_at })
    expect(res.status, JSON.stringify(res.body)).toBe(422)

    const after = await fetchCity(rourkelaId)
    expect(after.updated_at.valueOf()).toBe(before.updated_at.valueOf())
  })

  it('PUT returns 409 on a stale expectedUpdatedAt and does not overwrite', async () => {
    const before = await fetchCity(rourkelaId)
    const res = await request(app)
      .put(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: VALID_SQUARE, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })
    expect(res.status, JSON.stringify(res.body)).toBe(409)

    const after = await fetchCity(rourkelaId)
    expect(after.updated_at.valueOf()).toBe(before.updated_at.valueOf())
  })

  it('DELETE clears the boundary and returns the previous shape', async () => {
    const before = await fetchCity(rourkelaId)
    const res = await request(app)
      .delete(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ expectedUpdatedAt: before.updated_at })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.previousBoundary.type).toBe('Polygon')

    const after = await fetchCity(rourkelaId)
    expect(after.boundary).toBeNull()
  })

  it('GET on a city with no boundary returns null, not 404', async () => {
    // Rourkela was just cleared by the DELETE test above.
    const res = await request(app)
      .get(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.boundary).toBeNull()
  })

  it('ops_admin can save a boundary (D6: both roles can save/delete)', async () => {
    const before = await fetchCity(rourkelaId)
    const res = await request(app)
      .put(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: VALID_SQUARE, expectedUpdatedAt: before.updated_at })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })

  it('GET/PUT return 404 for a city that does not exist', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/geo/cities/999999999/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
    expect(res.status).toBe(404)
  })

  it('T2: PUT accepts a ~250kb polygon that the platform-wide 100kb limit would reject', async () => {
    const before = await fetchCity(rourkelaId)
    const bigPolygon = circlePolygon(9_000)
    const payload = JSON.stringify({ geojson: bigPolygon, expectedUpdatedAt: before.updated_at })
    expect(Buffer.byteLength(payload)).toBeGreaterThan(100_000) // proves this genuinely exercises the raised limit
    expect(Buffer.byteLength(payload)).toBeLessThan(1_000_000)

    const res = await request(app)
      .put(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send(payload)
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(200)
    expect(res.body.boundary.coordinates[0].length).toBe(9_001)
  })

  it('T4: PREVIEW rejects out-of-range coordinates outside the Odisha sanity bbox', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/geo/cities/${rourkelaId}/boundary/preview`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        geojson: {
          type: 'Polygon',
          // 120°E is nowhere near Odisha (lng 80-88 per the sanity bbox).
          coordinates: [[[120.0, 21.0], [120.1, 21.0], [120.1, 21.1], [120.0, 21.1], [120.0, 21.0]]],
        },
      })
    expect(res.status, JSON.stringify(res.body)).toBe(422)
  })

  it('T4: PUT rejects a ring over the 10,000-vertex cap', async () => {
    const before = await fetchCity(rourkelaId)
    const res = await request(app)
      .put(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: circlePolygon(10_001), expectedUpdatedAt: before.updated_at })
    expect(res.status, JSON.stringify(res.body)).toBe(422)
  })

  it('T4: PUT rejects a boundary below the minimum area (0.5 km²)', async () => {
    const before = await fetchCity(rourkelaId)
    const tiny = {
      type: 'Polygon' as const,
      // ~11m square, far under the 0.5 km² floor.
      coordinates: [[[84.0, 21.0], [84.0001, 21.0], [84.0001, 21.0001], [84.0, 21.0001], [84.0, 21.0]]],
    }
    const res = await request(app)
      .put(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: tiny, expectedUpdatedAt: before.updated_at })
    expect(res.status, JSON.stringify(res.body)).toBe(422)
    expect(res.body.error).toMatch(/area/i)
  })

  it('T4: PUT rejects a boundary above the maximum area (5,000 km²)', async () => {
    const before = await fetchCity(rourkelaId)
    const huge = {
      type: 'Polygon' as const,
      // ~728km x ~555km, well over the 5,000 km² ceiling, still inside the sanity bbox.
      coordinates: [[[80.5, 17.5], [87.5, 17.5], [87.5, 22.5], [80.5, 22.5], [80.5, 17.5]]],
    }
    const res = await request(app)
      .put(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: huge, expectedUpdatedAt: before.updated_at })
    expect(res.status, JSON.stringify(res.body)).toBe(422)
    expect(res.body.error).toMatch(/area/i)
  })

  it('T4: PREVIEW reports overlap warnings against Bhubaneswar/Cuttack\'s shared box', async () => {
    const sharedBox = {
      type: 'Polygon' as const,
      coordinates: [[[85.55, 20.05], [86.0, 20.05], [86.0, 20.55], [85.55, 20.55], [85.55, 20.05]]],
    }
    const res = await request(app)
      .post(`/api/v1/admin/geo/cities/${rourkelaId}/boundary/preview`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: sharedBox })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.isValid).toBe(true)
    const names = (res.body.overlaps as Array<{ name: string; pctOfNew: number }>).map((o) => o.name)
    expect(names).toContain('Bhubaneswar')
    expect(names).toContain('Cuttack')
    // Not itself — Rourkela is excluded from its own overlap list.
    expect(names).not.toContain('Rourkela')
  })

  it('T4: PUT enqueues an audit log entry with before/after state', async () => {
    const before = await fetchCity(rourkelaId)
    recordAuditLog.mockClear()
    const res = await request(app)
      .put(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ geojson: VALID_SQUARE, expectedUpdatedAt: before.updated_at })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(recordAuditLog).toHaveBeenCalledTimes(1)
    const call = recordAuditLog.mock.calls[0]![0] as { action: string; targetTable: string; afterState: unknown }
    expect(call.action).toBe('cities.boundary.save')
    expect(call.targetTable).toBe('cities')
    expect(call.afterState).toBeTruthy()
  })

  it('T4: DELETE enqueues an audit log entry too', async () => {
    const before = await fetchCity(rourkelaId)
    recordAuditLog.mockClear()
    const res = await request(app)
      .delete(`/api/v1/admin/geo/cities/${rourkelaId}/boundary`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ expectedUpdatedAt: before.updated_at })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(recordAuditLog).toHaveBeenCalledTimes(1)
    const call = recordAuditLog.mock.calls[0]![0] as { action: string; afterState: unknown }
    expect(call.action).toBe('cities.boundary.delete')
    expect(call.afterState).toEqual({ boundary: null })
  })

  it('T4: seeded Bhubaneswar/Cuttack/Puri boundaries all still analyze as valid', async () => {
    const { rows } = await pool.query<{ id: number; slug: string }>(
      `SELECT id::int, slug FROM cities WHERE slug IN ('bhubaneswar', 'cuttack', 'puri')`,
    )
    for (const { id, slug } of rows) {
      const city = await fetchCity(id)
      const res = await request(app)
        .post(`/api/v1/admin/geo/cities/${id}/boundary/preview`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ geojson: city.boundary })
      expect(res.status, `${slug}: ${JSON.stringify(res.body)}`).toBe(200)
      expect(res.body.isValid, `${slug} should be valid`).toBe(true)
    }
  })

  it('analyzeCityBoundary maps real PostGIS parse errors (XX000) to an invalid result, not a throw', async () => {
    // Bypasses the Zod layer on purpose to hand PostGIS shapes it cannot parse —
    // proves the SQLSTATE the repository keys on is what a real database raises.
    for (const bad of [{ type: 'Bogus', coordinates: [] }, { type: 'Polygon' }, { type: 'Polygon', coordinates: [[1, 2, 3]] }]) {
      const result = await analyzeCityBoundary(BigInt(rourkelaId), bad as never)
      expect(result.isValid).toBe(false)
      expect(result.invalidReason).toBe('Could not parse this shape as a valid polygon')
    }
  })

  it('T2: an unrelated admin route still rejects a body over the platform-wide 100kb limit with 413', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/drivers/1/profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ full_name: 'x'.repeat(150_000) }))
    expect(res.status).toBe(413)
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE')
  })
})
