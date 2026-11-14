import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { configKey } from '@/constants/redis-keys'
import { loginUser, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'
import { makeAdminToken } from '../helpers/auth.helper'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// City ride and Rental, end to end over HTTP against a real database (no mocks below the HTTP layer): the same calls the web and rider apps
// make. Value: protects=the Outstation / City Ride / Rental split holds together (classify -> quote -> book -> cancel), old clients are
// unchanged, the kill switch works, the seed script and the admin rate-card flow produce cards the quote actually reads;
// fails_when=any layer stops agreeing on the trip mode; no_claim=dispatch to a driver, payments, push (covered elsewhere).

const app = createApp()
const SEED_SQL = readFileSync(join(__dirname, '../../scripts/seed-city-ride-cards.sql'), 'utf-8')
const PHONES = { a: '+919700001001', b: '+919700001002', c: '+919700001003', d: '+919700001004', e: '+919700001005', f: '+919700001006' } as const

// Both inside the merged Bhubaneswar / Khordha / Cuttack region (owner decision D3: no distance cap), and one that leaves it.
const BBSR = { lat: 20.2961, lng: 85.8245, address: 'Bhubaneswar' }
const CUTTACK = { lat: 20.4625, lng: 85.8828, address: 'Cuttack' }
const PURI = { lat: 19.8135, lng: 85.8312, address: 'Puri' }

let sedanId: number
let adminId: string
let cityCard: { id: string; min_fare: number; cancellation_fee: number }
let stdCard: { id: string }

const setFlag = async (value: 'true' | 'false') => {
  await pool.query(`UPDATE system_config SET value = $1 WHERE key = 'city_rides_enabled'`, [value])
  await redis.del(configKey('city_rides_enabled'))
  // The reference cache may also keep a local copy: a short wait lets a stale read expire, and a second delete closes the race.
  await redis.del(configKey('city_rides_enabled'))
}

const book = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/rides').set('Authorization', `Bearer ${token}`).send(body)

const tripBody = (to: typeof CUTTACK, extra: Record<string, unknown> = {}) => ({
  categoryId: sedanId, rideType: 'one_way', originLat: BBSR.lat, originLng: BBSR.lng, originAddress: BBSR.address,
  destinationLat: to.lat, destinationLng: to.lng, destinationAddress: to.address, distanceKm: 8, durationMin: 20, paymentChannel: 'cash',
  ...extra,
})

beforeAll(async () => {
  const cat = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan'")
  sedanId = Number(cat.rows[0]!.id)
  // A fresh database (CI) has no city cards: the owner's seed script is what creates them, so the test applies it first. It is safe to re-run.
  await pool.query(SEED_SQL)
  const city = await pool.query(
    `SELECT id::text, min_fare::float8 AS min_fare, COALESCE(cancellation_fee, 0)::float8 AS cancellation_fee FROM rate_cards
      WHERE category_id = $1 AND ride_type = 'one_way' AND trip_mode = 'city' AND city_id IS NULL AND effective_to IS NULL`, [sedanId])
  expect(city.rows, 'the seed script made no global city card for sedan').toHaveLength(1)
  cityCard = city.rows[0]
  const std = await pool.query(
    `SELECT id::text FROM rate_cards WHERE category_id = $1 AND ride_type = 'one_way' AND trip_mode = 'standard' AND city_id IS NULL AND effective_to IS NULL`, [sedanId])
  stdCard = std.rows[0]
  const adm = await pool.query<{ id: string }>(
    `INSERT INTO admins (email, password_hash, role) VALUES ('e2e-city@test.local', 'x', 'super_admin')
     ON CONFLICT (email) DO UPDATE SET role = 'super_admin' RETURNING id::text`)
  adminId = adm.rows[0]!.id
  await setFlag('true')
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, Object.values(PHONES))
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp:user:${p}:login`)
  }
  await setFlag('false')
  await pool.end()
  redis.disconnect()
})

describe('Outstation / City Ride / Rental: the trip is classified', () => {
  it('City ride on: an in-city trip offers a city ride, a trip that leaves the city does not', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.a)
    const inCity = await request(app).get('/api/v1/geo/classify-trip').set('Authorization', `Bearer ${accessToken}`)
      .query({ originLat: BBSR.lat, originLng: BBSR.lng, destLat: CUTTACK.lat, destLng: CUTTACK.lng })
    expect(inCity.status, JSON.stringify(inCity.body)).toBe(200)
    expect(inCity.body).toMatchObject({ scope: 'in_city', city_ride_available: true })
    const out = await request(app).get('/api/v1/geo/classify-trip').set('Authorization', `Bearer ${accessToken}`)
      .query({ originLat: BBSR.lat, originLng: BBSR.lng, destLat: PURI.lat, destLng: PURI.lng })
    expect(out.body.scope).toBe('outstation')
    expect(out.body.city_ride_available).toBeFalsy()
  })
})

describe('quotes read the right card', () => {
  const quote = async (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/pricing/estimate').set('Authorization', `Bearer ${token}`).send(body)
  const base = () => ({ category_id: sedanId, ride_type: 'one_way', distance_km: 6, duration_min: 15 })

  it('a city ride is priced from the city card; an old client (no trip_mode) still gets the standard one-way card', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.a)
    const city = await quote(accessToken, { ...base(), trip_mode: 'city' })
    const old = await quote(accessToken, base())
    expect(city.status, JSON.stringify(city.body)).toBe(200)
    expect(String(city.body.rate_card_id)).toBe(cityCard.id)
    expect(city.body.breakdown.total).toBeGreaterThanOrEqual(cityCard.min_fare)
    expect(String(old.body.rate_card_id)).toBe(stdCard.id)
    expect(old.body.breakdown.total).not.toBe(city.body.breakdown.total)
  })

  it('a package rental is priced from its package alone: no rate card is read', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.a)
    const pkg = await pool.query(
      `SELECT id, package_fare::float8 AS fare FROM rental_packages WHERE category_id = $1 AND is_active AND city_id IS NULL ORDER BY duration_minutes LIMIT 1`, [sedanId])
    expect(pkg.rows).toHaveLength(1)
    const res = await quote(accessToken, { category_id: sedanId, ride_type: 'rental', distance_km: 10, duration_min: 60, rental_package_id: pkg.rows[0].id })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.rate_card_id).toBeNull()
    expect(res.body.breakdown.total).toBe(pkg.rows[0].fare)
  })
})

describe('booking', () => {
  it('a city ride books as a one-way ride in city mode, on the city card', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.b)
    const res = await book(accessToken, tripBody(CUTTACK, { tripMode: 'city' }))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const ride = await pool.query('SELECT ride_type, trip_mode, status FROM rides WHERE id = $1', [res.body.rideId])
    expect(ride.rows[0]).toMatchObject({ ride_type: 'one_way', trip_mode: 'city', status: 'requested' })
    const snap = await pool.query('SELECT rate_card_id::text FROM fare_snapshots WHERE ride_id = $1', [res.body.rideId])
    expect(snap.rows[0].rate_card_id).toBe(cityCard.id)
    // Cancelling frees the rider for the next booking in the same test file.
    const cancel = await request(app).post(`/api/v1/rides/${res.body.rideId}/cancel`).set('Authorization', `Bearer ${accessToken}`).send({ reasonCode: 'changed_mind' })
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200)
    const after = await pool.query('SELECT status FROM rides WHERE id = $1', [res.body.rideId])
    expect(after.rows[0].status).toBe('cancelled')
  })

  it('a trip that leaves the city cannot be a city ride', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.c)
    const res = await book(accessToken, tripBody(PURI, { tripMode: 'city', distanceKm: 60, durationMin: 80 }))
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('CITY_RIDE_NOT_IN_CITY')
  })

  it('an old client (no tripMode) books a standard one-way, unchanged', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.d)
    const res = await book(accessToken, tripBody(PURI, { distanceKm: 60, durationMin: 80 }))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const ride = await pool.query('SELECT ride_type, trip_mode FROM rides WHERE id = $1', [res.body.rideId])
    expect(ride.rows[0]).toMatchObject({ ride_type: 'one_way', trip_mode: 'standard' })
  })

  it('a rental books on its package: the stop charge and cancellation fee are saved on the ride from the package', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.e)
    const pkg = await pool.query(
      `SELECT id, duration_minutes, stop_charge::float8 AS stop_charge, cancellation_fee::float8 AS cancellation_fee FROM rental_packages
        WHERE category_id = $1 AND is_active AND city_id IS NULL ORDER BY duration_minutes LIMIT 1`, [sedanId])
    const p = pkg.rows[0]
    const res = await book(accessToken, {
      categoryId: sedanId, rideType: 'rental', originLat: BBSR.lat, originLng: BBSR.lng, originAddress: BBSR.address,
      destinationLat: CUTTACK.lat, destinationLng: CUTTACK.lng, destinationAddress: CUTTACK.address, distanceKm: 8, durationMin: p.duration_minutes, paymentChannel: 'cash', rentalPackageId: p.id,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const ride = await pool.query('SELECT ride_type, trip_mode FROM rides WHERE id = $1', [res.body.rideId])
    expect(ride.rows[0]).toMatchObject({ ride_type: 'rental', trip_mode: 'standard' })
    const snap = await pool.query(
      'SELECT rate_card_id, rental_stop_charge::float8 AS stop, rental_cancellation_fee::float8 AS fee FROM fare_snapshots WHERE ride_id = $1', [res.body.rideId])
    expect(snap.rows[0].rate_card_id).toBeNull()
    expect(snap.rows[0].stop).toBe(p.stop_charge)
    expect(snap.rows[0].fee).toBe(p.cancellation_fee)
  })
})

describe('kill switch', () => {
  it('with city_rides_enabled off, nothing offers or accepts a city ride, and standard bookings still work', async () => {
    await setFlag('false')
    try {
      const { accessToken } = await loginUser(app, redis, PHONES.f)
      const cls = await request(app).get('/api/v1/geo/classify-trip').set('Authorization', `Bearer ${accessToken}`)
        .query({ originLat: BBSR.lat, originLng: BBSR.lng, destLat: CUTTACK.lat, destLng: CUTTACK.lng })
      expect(cls.body.scope).toBe('in_city')
      expect(cls.body.city_ride_available).toBeFalsy()
      const city = await book(accessToken, tripBody(CUTTACK, { tripMode: 'city' }))
      expect(city.status).toBe(422)
      expect(city.body.code).toBe('CITY_RIDE_DISABLED')
      const std = await book(accessToken, tripBody(PURI, { distanceKm: 60, durationMin: 80 }))
      expect(std.status, JSON.stringify(std.body)).toBe(201)
    } finally {
      await setFlag('true')
    }
  })
})

describe('admin edits a City Ride card', () => {
  it('saves a new version of the city card only, closes the old one, and the next quote reads the new rate', async () => {
    const token = makeAdminToken(adminId)
    const before = await pool.query(
      `SELECT count(*)::int AS n FROM rate_cards WHERE category_id = $1 AND ride_type = 'one_way' AND trip_mode = 'standard' AND effective_to IS NULL`, [sedanId])
    const res = await request(app).post('/api/v1/admin/pricing/rate-cards').set('Authorization', `Bearer ${token}`).send({
      category_id: sedanId, ride_type: 'one_way', trip_mode: 'city', rate_per_km: 11.5, rate_per_min: 2.25, min_fare: 140,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const cards = await pool.query(
      `SELECT effective_to IS NULL AS current, min_fare::float8 AS min_fare, cancellation_fee::float8 AS fee, stop_charge::float8 AS stop
         FROM rate_cards WHERE category_id = $1 AND ride_type = 'one_way' AND trip_mode = 'city' AND city_id IS NULL ORDER BY id`, [sedanId])
    expect(cards.rows.filter((c) => c.current)).toHaveLength(1)
    expect(cards.rows.find((c) => c.current)!.min_fare).toBe(140)
    expect(cards.rows.length).toBeGreaterThanOrEqual(2)
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM rate_cards WHERE category_id = $1 AND ride_type = 'one_way' AND trip_mode = 'standard' AND effective_to IS NULL`, [sedanId])
    expect(after.rows[0].n).toBe(before.rows[0].n) // the standard one-way card is untouched
    const { accessToken } = await loginUser(app, redis, PHONES.a)
    const q = await request(app).post('/api/v1/pricing/estimate').set('Authorization', `Bearer ${accessToken}`)
      .send({ category_id: sedanId, ride_type: 'one_way', distance_km: 1, duration_min: 3, trip_mode: 'city' })
    expect(q.body.breakdown.total).toBeGreaterThanOrEqual(140)
    expect(String(q.body.rate_card_id)).not.toBe(cityCard.id) // the quote moved to the new version
  })
})

describe('seed-city-ride-cards.sql', () => {
  it('is safe to run again: a second run adds nothing, never changes a rate card, and copies a missing cancellation fee as 0', async () => {
    const before = await pool.query('SELECT count(*)::int AS n FROM rate_cards')
    const run = await pool.query(SEED_SQL)
    expect(run.rowCount).toBe(0)
    const afterRun = await pool.query('SELECT count(*)::int AS n FROM rate_cards')
    expect(afterRun.rows[0].n).toBe(before.rows[0].n)
    const nulls = await pool.query(`SELECT count(*)::int AS n FROM rate_cards WHERE trip_mode = 'city' AND cancellation_fee IS NULL`)
    expect(nulls.rows[0].n).toBe(0)
  })
})
