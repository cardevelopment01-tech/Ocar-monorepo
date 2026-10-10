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
const PHONES = { driver: '+919800000021', rider: '+919800000022' } as const

let driver: Awaited<ReturnType<typeof setupOnlineDriver>>

beforeAll(async () => {
  driver = await setupOnlineDriver(app, pool, redis, PHONES.driver, { categorySlug: 'sedan' })
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, Object.values(PHONES))
  for (const p of Object.values(PHONES)) {
    for (const k of [`otp_rate:user:${p}:login`, `otp_rate:driver:${p}:login`, `otp:user:${p}:login`, `otp:driver:${p}:login`]) {
      await redis.del(k)
    }
  }
  await pool.end()
  redis.disconnect()
})

const broadcast = (rideId: string, broadcastRound: number) =>
  processBroadcast({
    rideId,
    categoryId: String(driver.categoryId),
    originLat: DEFAULT_BOOKING.originLat,
    originLng: DEFAULT_BOOKING.originLng,
    rideType: DEFAULT_BOOKING.rideType,
    isReturnCab: false,
    broadcastRound,
  })

describe('re-offer to the same driver in a later broadcast round', () => {
  it.each(['declined', 'expired'] as const)('accepts after a %s first offer', async (prior) => {
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.rider)
    const bookRes = await request(app)
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING })
    expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
    const rideId = bookRes.body.rideId as string

    await broadcast(rideId, 1)
    if (prior === 'declined') {
      const res = await request(app)
        .post(`/api/v1/rides/${rideId}/decline`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
      expect(res.status).toBe(200)
    } else {
      await pool.query(`UPDATE ride_assignments SET status = 'expired' WHERE ride_id = $1`, [rideId])
    }

    await broadcast(rideId, 2)

    const accept = await request(app)
      .post(`/api/v1/rides/${rideId}/accept`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
    expect(accept.status, JSON.stringify(accept.body)).toBe(200)

    // Leave the driver free for the next case.
    await pool.query(`UPDATE rides SET status = 'cancelled' WHERE id = $1`, [rideId])
    await pool.query(`UPDATE driver_sessions SET status = 'online' WHERE id = $1`, [driver.sessionId])
    await pool.query(`UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`, [driver.driverId])
  })
})
