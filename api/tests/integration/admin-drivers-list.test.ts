import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { loginAdmin, seedAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

const app = createApp()

const ADMIN_EMAIL = 'drivers-list-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'
// Every fixture driver carries this name prefix; tests pass it as `search` so counts
// are exact regardless of whatever else is in the test DB.
const TAG = 'ZZFLT'

let token = ''
let cityA = 0, cityB = 0, catX = 0, catY = 0
const driverIds: Record<string, string> = {}

async function addDriver(key: string, opts: {
  status: string; cityId: number | null; categoryId: number; plate: string; extraBlacklisted?: string
}) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO drivers (phone, full_name, status, city_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [`+91970001${String(Object.keys(driverIds).length).padStart(4, '0')}`, `${TAG} ${key}`, opts.status, opts.cityId],
  )
  const id = rows[0]!.id
  driverIds[key] = id
  await pool.query(
    `INSERT INTO driver_vehicles (driver_id, category_id, number_plate, is_primary, status)
     VALUES ($1, $2, $3, true, 'active')`,
    [id, opts.categoryId, opts.plate],
  )
  if (opts.extraBlacklisted) {
    // old, blacklisted vehicle of a different category: must not duplicate the driver
    await pool.query(
      `INSERT INTO driver_vehicles (driver_id, category_id, number_plate, is_primary, status)
       VALUES ($1, $2, $3, false, 'blacklisted')`,
      [id, catY, opts.extraBlacklisted],
    )
  }
}

async function list(qs: string) {
  return request(app)
    .get(`/api/v1/admin/drivers?search=${TAG}${qs}`)
    .set('Authorization', `Bearer ${token}`)
}

beforeAll(async () => {
  await seedAdmin(pool, ADMIN_EMAIL, 'super_admin', ADMIN_PASSWORD)
  token = (await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken

  const cities = await pool.query<{ id: string }>('SELECT id FROM cities ORDER BY id LIMIT 2')
  const cats = await pool.query<{ id: string }>('SELECT id FROM vehicle_categories ORDER BY id LIMIT 2')
  cityA = Number(cities.rows[0]!.id); cityB = Number(cities.rows[1]!.id)
  catX = Number(cats.rows[0]!.id); catY = Number(cats.rows[1]!.id)

  // inserted in this order, so created_at DESC lists E, D, C, B, A
  await addDriver('A', { status: 'active', cityId: cityA, categoryId: catX, plate: 'ZZ01A0001' })
  await addDriver('B', { status: 'pending_approval', cityId: cityA, categoryId: catY, plate: 'ZZ01A0002' })
  await addDriver('C', { status: 'suspended', cityId: cityB, categoryId: catX, plate: 'ZZ01A0003' })
  await addDriver('D', { status: 'active', cityId: null, categoryId: catX, plate: 'ZZ01A0004' })
  await addDriver('E', { status: 'active', cityId: cityA, categoryId: catX, plate: 'ZZ01A0005', extraBlacklisted: 'ZZ01A0006' })
})

afterAll(async () => {
  const ids = Object.values(driverIds)
  await pool.query('DELETE FROM driver_vehicles WHERE driver_id = ANY($1)', [ids])
  await pool.query('DELETE FROM drivers WHERE id = ANY($1)', [ids])
  await cleanupAdmins(pool, [ADMIN_EMAIL])
  await pool.end()
  redis.disconnect()
})

describe('GET /api/v1/admin/drivers', () => {
  it('unfiltered: keeps its shape, created_at DESC order and pagination', async () => {
    const res = await list('')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.drivers.map((d: { full_name: string }) => d.full_name))
      .toEqual([`${TAG} E`, `${TAG} D`, `${TAG} C`, `${TAG} B`, `${TAG} A`])
    expect(res.body.pagination).toEqual({ total: 5, page: 1, limit: 20, pages: 1 })
    const first = res.body.drivers[0]
    expect(Object.keys(first)).toEqual(expect.arrayContaining(
      ['id', 'code', 'phone', 'full_name', 'email', 'status', 'onboarding_step', 'created_at', 'city', 'vehicle', 'docs_submitted', 'docs_approved']))
  })

  it('paginates', async () => {
    const res = await list('&limit=2&page=2')
    expect(res.body.drivers.map((d: { full_name: string }) => d.full_name)).toEqual([`${TAG} C`, `${TAG} B`])
    expect(res.body.pagination).toEqual({ total: 5, page: 2, limit: 2, pages: 3 })
  })

  it('status and search still filter', async () => {
    const res = await list('&status=suspended')
    expect(res.body.drivers.map((d: { full_name: string }) => d.full_name)).toEqual([`${TAG} C`])
  })

  it('a driver with a blacklisted second vehicle appears once, with the primary category', async () => {
    const res = await list('')
    const e = res.body.drivers.filter((d: { full_name: string }) => d.full_name === `${TAG} E`)
    expect(e).toHaveLength(1)
    expect(e[0].vehicle.number_plate).toBe('ZZ01A0005')
  })

  it('city filter, with the city on each row', async () => {
    const res = await list(`&city=${cityA}`)
    expect(res.body.drivers.map((d: { full_name: string }) => d.full_name)).toEqual([`${TAG} E`, `${TAG} B`, `${TAG} A`])
    expect(res.body.drivers[0].city).toEqual({ id: String(cityA), name: expect.any(String) })
  })

  it('city=none returns drivers with no city; ids and none combine', async () => {
    const none = await list('&city=none')
    expect(none.body.drivers.map((d: { full_name: string }) => d.full_name)).toEqual([`${TAG} D`])
    expect(none.body.drivers[0].city).toBeNull()
    const both = await list(`&city=${cityB},none`)
    expect(both.body.drivers).toHaveLength(2)
  })

  it('vehicle filter uses the primary vehicle category', async () => {
    const res = await list(`&vehicle=${catX}`)
    expect(res.body.drivers.map((d: { full_name: string }) => d.full_name)).toEqual(
      [`${TAG} E`, `${TAG} D`, `${TAG} C`, `${TAG} A`])
    const y = await list(`&vehicle=${catY}`)
    expect(y.body.drivers.map((d: { full_name: string }) => d.full_name)).toEqual([`${TAG} B`])
  })

  it('summary is scoped to the filters', async () => {
    const res = await list(`&city=${cityA}`)
    expect(res.body.summary).toEqual({ total: 3, active: 2, pending_approval: 1, suspended: 0 })
  })

  it('summary ignores the status filter while the list and total respect it', async () => {
    const res = await list('&status=suspended')
    expect(res.body.pagination.total).toBe(1)
    expect(res.body.summary).toEqual({ total: 5, active: 3, pending_approval: 1, suspended: 1 })
  })

  it('facets ignore their own dimension but respect the other', async () => {
    const res = await list(`&city=${cityA}`)
    // city facet ignores the city filter: all cities still counted
    expect(res.body.facets.cities).toEqual({ [cityA]: 3, [cityB]: 1, none: 1 })
    // category facet respects the city filter (A, B, E in city A)
    expect(res.body.facets.categories).toEqual({ [catX]: 2, [catY]: 1 })
  })

  it.each([
    ['city=abc'], ['city=1,,2'], ['city=0'], ['vehicle=none'], ['vehicle=1.5'],
    [`city=${Array.from({ length: 51 }, (_, i) => i + 1).join(',')}`],
  ])('rejects malformed filter %s with a safe VALIDATION_ERROR (422)', async (qs) => {
    const res = await list(`&${qs}`)
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /api/v1/admin/analytics/summary city_breakdown', () => {
  it('adds cancelled, cancellation rate and active drivers per city', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics/summary?period=30d')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const rows = res.body.city_breakdown as {
      city_name: string; ride_count: number; cancelled_count: number
      cancellation_rate: number; active_drivers: number
    }[]
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      const total = r.ride_count + r.cancelled_count
      expect(r.cancellation_rate).toBeCloseTo(total === 0 ? 0 : r.cancelled_count / total, 10)
    }
    const { rows: db } = await pool.query<{ n: string; name: string }>(
      `SELECT c.name, COUNT(d.id) AS n FROM cities c
       LEFT JOIN drivers d ON d.city_id = c.id AND d.status = 'active' GROUP BY c.id, c.name`,
    )
    for (const c of db) {
      expect(rows.find(r => r.city_name === c.name)?.active_drivers).toBe(Number(c.n))
    }
  })
})
