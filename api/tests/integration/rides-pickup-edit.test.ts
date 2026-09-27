import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { processBroadcast } from '@/jobs/processors/broadcast.processor'
import {
  loginUser, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING,
} from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

const PHONES = {
  pickupRider1: '+919700000021',
  pickupDriver1: '+919700000022',
  pickupRider2: '+919700000023',
  pickupDriver2: '+919700000024',
  pickupRider3: '+919700000025',
  pickupDriver3: '+919700000026',
  pickupRider4: '+919700000027',
  pickupDriver4: '+919700000028',
  otherUser: '+919700000029',
} as const
const ALL_PHONES = Object.values(PHONES)

let categoryId: number

async function bookAndAccept(userToken: string, driver: { categoryId: number; accessToken: string }) {
  const bookRes = await request(app)
    .post('/api/v1/rides')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING })
  expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
  const rideId = bookRes.body.rideId as string

  await processBroadcast({
    rideId,
    categoryId: String(driver.categoryId),
    originLat: DEFAULT_BOOKING.originLat,
    originLng: DEFAULT_BOOKING.originLng,
    rideType: DEFAULT_BOOKING.rideType,
    isReturnCab: false,
    broadcastRound: 1,
  })

  const acceptRes = await request(app)
    .post(`/api/v1/rides/${rideId}/accept`)
    .set('Authorization', `Bearer ${driver.accessToken}`)
  expect(acceptRes.status, JSON.stringify(acceptRes.body)).toBe(200)

  return rideId
}

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1"
  )
  categoryId = Number(rows[0]!.id)
})

afterAll(async () => {
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

describe('Pickup pin edit (bounded-radius post-booking correction)', () => {
  it('full flow: book → accept → rider nudges pickup within radius → ride updated + driver notified', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.pickupDriver1, { categorySlug: 'sedan' })
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.pickupRider1)
    const rideId = await bookAndAccept(userToken, driver)

    // ~70m from DEFAULT_BOOKING's origin (20.29, 85.82) — inside the 150m radius.
    const newLat = 20.2906
    const newLng = 85.8205

    const patchRes = await request(app)
      .patch(`/api/v1/rides/${rideId}/pickup`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ lat: newLat, lng: newLng, address: 'Corrected pickup spot' })
    expect(patchRes.status, JSON.stringify(patchRes.body)).toBe(200)
    expect(patchRes.body.origin_address).toBe('Corrected pickup spot')
    expect(patchRes.body.origin_lat).toBeCloseTo(newLat, 3)
    expect(patchRes.body.origin_lng).toBeCloseTo(newLng, 3)

    const { rows } = await pool.query<{ origin_address: string }>(
      "SELECT origin_address, ST_Y(origin::geometry) AS origin_lat, ST_X(origin::geometry) AS origin_lng FROM rides WHERE id = $1",
      [rideId]
    )
    expect(rows[0]?.origin_address).toBe('Corrected pickup spot')

    // Driver was assigned (accepted) — notifyOwner must have persisted a real
    // in-app feed row, visible via the driver's own notifications API (same
    // assertion shape as m10.test.ts TC-M10-002).
    const listRes = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${driver.accessToken}`)
    expect(listRes.status, JSON.stringify(listRes.body)).toBe(200)
    const item = listRes.body.items.find((i: { type: string }) => i.type === 'pickup_updated')
    expect(item).toBeTruthy()
  })

  it('rejects a pickup point outside the allowed radius (422), ride left unchanged', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.pickupDriver2, { categorySlug: 'sedan' })
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.pickupRider2)
    const rideId = await bookAndAccept(userToken, driver)

    // ~1.1km from origin — well outside the 150m radius.
    const patchRes = await request(app)
      .patch(`/api/v1/rides/${rideId}/pickup`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ lat: 20.30, lng: 85.82, address: 'Too far' })
    expect(patchRes.status, JSON.stringify(patchRes.body)).toBe(422)

    const { rows } = await pool.query<{ origin_address: string | null }>(
      'SELECT origin_address FROM rides WHERE id = $1', [rideId]
    )
    expect(rows[0]?.origin_address).toBe(DEFAULT_BOOKING.originAddress)
  })

  it('rejects once the driver has arrived (409) — pickup is no longer editable', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.pickupDriver3, { categorySlug: 'sedan' })
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.pickupRider3)
    const rideId = await bookAndAccept(userToken, driver)

    const arrivedRes = await request(app)
      .post(`/api/v1/rides/${rideId}/arrived`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
    expect(arrivedRes.status, JSON.stringify(arrivedRes.body)).toBe(200)

    const patchRes = await request(app)
      .patch(`/api/v1/rides/${rideId}/pickup`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ lat: 20.2906, lng: 85.8205, address: 'Too late' })
    expect(patchRes.status, JSON.stringify(patchRes.body)).toBe(409)
  })

  it('rejects a caller who does not own the ride (403)', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.pickupDriver4, { categorySlug: 'sedan' })
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.pickupRider4)
    const rideId = await bookAndAccept(userToken, driver)

    const { accessToken: otherToken } = await loginUser(app, redis, PHONES.otherUser)
    const patchRes = await request(app)
      .patch(`/api/v1/rides/${rideId}/pickup`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ lat: 20.2906, lng: 85.8205, address: 'Not mine to move' })
    expect(patchRes.status, JSON.stringify(patchRes.body)).toBe(403)
  })
})
