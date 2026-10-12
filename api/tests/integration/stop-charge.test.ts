import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { loginAdmin, seedAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'
import {
  loginUser, setupOnlineDriver, driveRideToInProgress, cleanupRideAndDriverData, DEFAULT_BOOKING,
} from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

const ADMIN_EMAIL = 'stop-charge-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'
const PHONES = { user: '+919700000061', driver: '+919700000062' } as const
const ALL_PHONES = Object.values(PHONES)

let adminToken: string
let categoryId: number
let originalCard: { rate_per_km: string; rate_per_min: string; min_fare: string; return_rate_per_km: string | null; stop_charge: string }

const estimate = (stopCount: number) =>
  request(app).post('/api/v1/pricing/estimate')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ category_id: categoryId, ride_type: 'one_way', distance_km: 20, duration_min: 30, stop_count: stopCount })

const setCard = (extra: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/admin/pricing/rate-cards')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ category_id: categoryId, ride_type: 'one_way', rate_per_km: 13, rate_per_min: 2, min_fare: 250, return_rate_per_km: 11, ...extra })

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  categoryId = Number(rows[0]!.id)
  const cur = await pool.query(
    `SELECT rate_per_km::text, rate_per_min::text, min_fare::text, return_rate_per_km::text, stop_charge::text
       FROM rate_cards WHERE category_id = $1 AND ride_type = 'one_way' AND city_id IS NULL AND effective_to IS NULL`,
    [categoryId],
  )
  originalCard = cur.rows[0]
  await seedAdmin(pool, ADMIN_EMAIL, 'super_admin', ADMIN_PASSWORD)
  adminToken = (await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)).accessToken
})

afterAll(async () => {
  // Put the shared sedan one-way card back exactly as found (stop price included).
  await request(app).post('/api/v1/admin/pricing/rate-cards').set('Authorization', `Bearer ${adminToken}`).send({
    category_id: categoryId, ride_type: 'one_way',
    rate_per_km: Number(originalCard.rate_per_km), rate_per_min: Number(originalCard.rate_per_min),
    min_fare: Number(originalCard.min_fare),
    return_rate_per_km: originalCard.return_rate_per_km !== null ? Number(originalCard.return_rate_per_km) : null,
    stop_charge: Number(originalCard.stop_charge),
  })
  await cleanupRideAndDriverData(pool, [...ALL_PHONES])
  for (const p of ALL_PHONES) {
    for (const r of ['user', 'driver']) { await redis.del(`otp_rate:${r}:${p}:login`); await redis.del(`otp:${r}:${p}:login`) }
  }
  await cleanupAdmins(pool, [ADMIN_EMAIL])
  await pool.end()
  redis.disconnect()
})

describe('Per-stop charge on the rate card', () => {
  it('defaults to free: a one-way card has no stop charge until an admin sets one', async () => {
    expect(Number(originalCard.stop_charge)).toBe(0)
    const res = await estimate(2)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.charge_per_stop).toBe(0)
    expect(res.body.breakdown.stop_fare).toBe(0)
  })

  it('an admin-set stop_charge prices every stop in the quote, on a one-way ride', async () => {
    const created = await setCard({ stop_charge: 12 })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(Number(created.body.stop_charge)).toBe(12)

    const res = await estimate(2)
    expect(res.body.charge_per_stop).toBe(12)
    expect(res.body.breakdown.stop_fare).toBe(24)
  })

  it('a new version that does not mention stop_charge keeps it (no silent reset)', async () => {
    const created = await setCard({ rate_per_km: 14 })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(Number(created.body.stop_charge)).toBe(12)

    const res = await estimate(1)
    expect(res.body.charge_per_stop).toBe(12)
  })

  it('stop_charge 0 makes stops free again, and the history records the replaced price', async () => {
    const created = await setCard({ stop_charge: 0 })
    expect(created.status).toBe(201)
    expect((await estimate(3)).body.breakdown.stop_fare).toBe(0)

    const hist = await request(app).get('/api/v1/admin/pricing/rate-cards/history').set('Authorization', `Bearer ${adminToken}`)
    expect(hist.status).toBe(200)
    expect((hist.body as Array<{ stop_charge: string | null }>).some(h => Number(h.stop_charge) === 12)).toBe(true)
  })

  it('rejects a negative stop_charge with a 4xx, not a 500', async () => {
    const res = await setCard({ stop_charge: -5 })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})

describe('Rate edits keep the cancellation fee', () => {
  it('a new card version carries cancellation_fee forward instead of resetting it to NULL', async () => {
    await pool.query(
      `UPDATE rate_cards SET cancellation_fee = 50 WHERE category_id = $1 AND ride_type = 'one_way' AND city_id IS NULL AND effective_to IS NULL`,
      [categoryId])
    const created = await setCard({ rate_per_km: 15 })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(Number(created.body.cancellation_fee)).toBe(50)
    const { rows } = await pool.query(
      `SELECT cancellation_fee::text FROM rate_cards WHERE category_id = $1 AND ride_type = 'one_way' AND city_id IS NULL AND effective_to IS NULL`,
      [categoryId])
    expect(Number(rows[0].cancellation_fee)).toBe(50)
  })
})

describe('Per-stop charge reaches a booked ride', () => {
  it('bills booking stops and mid-ride stops at the quoted card price, even if an admin edits it mid-trip', async () => {
    expect((await setCard({ stop_charge: 12 })).status).toBe(201)

    const driver = await setupOnlineDriver(app, pool, redis, PHONES.driver)
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.user)
    const book = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${userToken}`)
      .send({
        categoryId: driver.categoryId, ...DEFAULT_BOOKING,
        stops: [{ lat: DEFAULT_BOOKING.originLat + 0.05, lng: DEFAULT_BOOKING.originLng + 0.03, address: 'Booked stop' }],
      })
    expect(book.status, JSON.stringify(book.body)).toBe(201)
    const rideId = book.body.rideId as string

    const stops = () => pool.query<{ stop_charge_applied: string }>(
      'SELECT stop_charge_applied::text FROM ride_stops WHERE ride_id = $1 ORDER BY sequence', [rideId])
    const stopFare = async () => Number((await pool.query<{ stop_fare: string }>(
      'SELECT stop_fare::text FROM fare_snapshots WHERE ride_id = $1', [rideId])).rows[0]!.stop_fare)

    // Booked with one stop: stamped with the card price and included in the quote.
    expect((await stops()).rows.map(r => Number(r.stop_charge_applied))).toEqual([12])
    expect(await stopFare()).toBe(12)

    await driveRideToInProgress(app, rideId, driver, userToken)

    // Mid-ride add: charged, and added to what settlement will bill.
    const add1 = await request(app).post(`/api/v1/rides/${rideId}/stops`).set('Authorization', `Bearer ${userToken}`)
      .send({ lat: DEFAULT_BOOKING.originLat + 0.08, lng: DEFAULT_BOOKING.originLng + 0.05, address: 'Mid-ride stop' })
    expect(add1.status, JSON.stringify(add1.body)).toBe(201)
    expect(await stopFare()).toBe(24)

    // Admin changes the price mid-trip: this ride keeps the price it was quoted on.
    expect((await setCard({ stop_charge: 99 })).status).toBe(201)
    const add2 = await request(app).post(`/api/v1/rides/${rideId}/stops`).set('Authorization', `Bearer ${userToken}`)
      .send({ lat: DEFAULT_BOOKING.originLat + 0.11, lng: DEFAULT_BOOKING.originLng + 0.07, address: 'Later stop' })
    expect(add2.status, JSON.stringify(add2.body)).toBe(201)
    expect((await stops()).rows.map(r => Number(r.stop_charge_applied))).toEqual([12, 12, 12])
    expect(await stopFare()).toBe(36)
  })
})
