import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
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

const PHONES = { user: '+919700000041', otherUser: '+919700000042', driver: '+919700000043' } as const
const ALL_PHONES = Object.values(PHONES)

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

describe('Stops — rider owns skipping, driver can only ask', () => {
  let rideId: string
  let userToken: string
  let otherUserToken: string
  let driverToken: string

  beforeAll(async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.driver)
    driverToken = driver.accessToken
    userToken = (await loginUser(app, redis, PHONES.user)).accessToken
    otherUserToken = (await loginUser(app, redis, PHONES.otherUser)).accessToken

    const book = await request(app)
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING })
    expect(book.status, JSON.stringify(book.body)).toBe(201)
    rideId = book.body.rideId as string

    await driveRideToInProgress(app, rideId, driver, userToken)

    for (const [i, off] of [0.03, 0.06].entries()) {
      const add = await request(app)
        .post(`/api/v1/rides/${rideId}/stops`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ lat: DEFAULT_BOOKING.originLat + off, lng: DEFAULT_BOOKING.originLng + off, address: `Stop ${i + 1}` })
      expect(add.status, JSON.stringify(add.body)).toBe(201)
    }
  })

  const stopRow = async (sequence: number) => {
    const { rows } = await pool.query<{ status: string; unreachable_requested_at: string | null }>(
      'SELECT status, unreachable_requested_at FROM ride_stops WHERE ride_id = $1 AND sequence = $2',
      [rideId, sequence],
    )
    return rows[0]!
  }

  it('driver can no longer skip a stop through the status endpoint', async () => {
    const res = await request(app)
      .patch(`/api/v1/rides/${rideId}/stops/1`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'skipped' })
    expect(res.status).toBe(400)
    expect((await stopRow(1)).status).toBe('pending')
  })

  it("driver can't skip through the rider endpoint either", async () => {
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/stops/1/skip`)
      .set('Authorization', `Bearer ${driverToken}`)
    expect(res.status).toBe(403)
    expect((await stopRow(1)).status).toBe('pending')
  })

  it('driver "can\'t reach" flags the stop and notifies the rider, without resolving it', async () => {
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/stops/1/unreachable`)
      .set('Authorization', `Bearer ${driverToken}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const row = await stopRow(1)
    expect(row.status).toBe('pending')
    expect(row.unreachable_requested_at).not.toBeNull()

    const { rows: notes } = await pool.query(
      `SELECT 1 FROM notification_logs WHERE type = 'stop_unreachable' AND ride_id = $1`, [rideId],
    )
    expect(notes.length).toBe(1)

    // A repeat tap keeps the original timestamp and does not notify again.
    const again = await request(app)
      .post(`/api/v1/rides/${rideId}/stops/1/unreachable`)
      .set('Authorization', `Bearer ${driverToken}`)
    expect(again.status).toBe(200)
    expect((await stopRow(1)).unreachable_requested_at).toEqual(row.unreachable_requested_at)
    const { rows: notes2 } = await pool.query(
      `SELECT 1 FROM notification_logs WHERE type = 'stop_unreachable' AND ride_id = $1`, [rideId],
    )
    expect(notes2.length).toBe(1)
  })

  it('the rider sees the request on the ride detail read', async () => {
    const res = await request(app)
      .get(`/api/v1/rides/${rideId}`)
      .set('Authorization', `Bearer ${userToken}`)
    expect(res.status).toBe(200)
    const stop = (res.body.stops as Array<Record<string, unknown>>).find(s => s['sequence'] === 1)!
    expect(stop['unreachable_requested_at'] ?? stop['unreachableRequestedAt']).toBeTruthy()
  })

  it("another rider can't skip this ride's stop", async () => {
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/stops/1/skip`)
      .set('Authorization', `Bearer ${otherUserToken}`)
    expect(res.status).toBe(403)
    expect((await stopRow(1)).status).toBe('pending')
  })

  it('driver is blocked from the drop while a stop is still pending', async () => {
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/arrived-at-drop`)
      .set('Authorization', `Bearer ${driverToken}`)
    expect(res.status).toBe(409)
  })

  it('rider skips both stops, then the driver can reach the drop', async () => {
    for (const seq of [1, 2]) {
      const res = await request(app)
        .post(`/api/v1/rides/${rideId}/stops/${seq}/skip`)
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect((await stopRow(seq)).status).toBe('skipped')
    }

    const again = await request(app)
      .post(`/api/v1/rides/${rideId}/stops/1/skip`)
      .set('Authorization', `Bearer ${userToken}`)
    expect(again.status).toBe(409)

    const atDrop = await request(app)
      .post(`/api/v1/rides/${rideId}/arrived-at-drop`)
      .set('Authorization', `Bearer ${driverToken}`)
    expect(atDrop.status, JSON.stringify(atDrop.body)).toBe(200)
  })

  it('rider cannot skip once the driver has reached the drop', async () => {
    const stopsBefore = await pool.query('SELECT 1 FROM ride_stops WHERE ride_id = $1', [rideId])
    expect(stopsBefore.rows.length).toBe(2)
    const res = await request(app)
      .post(`/api/v1/rides/${rideId}/stops/2/skip`)
      .set('Authorization', `Bearer ${userToken}`)
    expect(res.status).toBe(409) // already resolved, and past the drop either way
  })
})
