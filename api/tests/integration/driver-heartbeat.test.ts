import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { driverHeartbeatKey, driverHeartbeatThrottleKey } from '@/constants/redis-keys'
import { setupOnlineDriver, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'

// The driver heartbeat (liveness without a position) against a real database and Redis.

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()
const PHONE = '+919800000041'
let driver: Awaited<ReturnType<typeof setupOnlineDriver>>

beforeAll(async () => {
  driver = await setupOnlineDriver(app, pool, redis, PHONE, { categorySlug: 'sedan' })
})

afterAll(async () => {
  await redis.del(driverHeartbeatKey(String(driver.driverId)), driverHeartbeatThrottleKey(String(driver.driverId)))
  await cleanupRideAndDriverData(pool, [PHONE])
  for (const k of [`otp_rate:driver:${PHONE}:login`, `otp:driver:${PHONE}:login`]) await redis.del(k)
  await pool.end()
  redis.disconnect()
})

const beat = (body: unknown) => request(app).post('/api/v1/rides/sessions/heartbeat').set('Authorization', `Bearer ${driver.accessToken}`).send(body as object)
const hb = () => redis.get(driverHeartbeatKey(String(driver.driverId)))
const reset = () => redis.del(driverHeartbeatKey(String(driver.driverId)), driverHeartbeatThrottleKey(String(driver.driverId)))

describe('driver heartbeat', () => {
  it('records "still here" in Redis for the driver\'s own session', async () => {
    await reset()
    expect((await beat({ sessionId: driver.sessionId })).status).toBe(200)
    const v = Number(await hb())
    expect(Date.now() - v).toBeLessThan(10_000)
  })

  it('is throttled on the server: a second heartbeat within seconds changes nothing', async () => {
    await reset()
    await beat({ sessionId: driver.sessionId })
    const first = await hb()
    await new Promise((r) => setTimeout(r, 30))
    await beat({ sessionId: driver.sessionId })
    expect(await hb()).toBe(first)
  })

  it('changes neither the position nor the availability, and does not touch the database session', async () => {
    await reset()
    await pool.query(`UPDATE driver_location_snapshots SET is_available = false WHERE driver_id = $1`, [driver.driverId])
    const q = `SELECT is_available, recorded_at, ST_AsText(location::geometry) AS loc FROM driver_location_snapshots WHERE driver_id = $1`
    const before = (await pool.query(q, [driver.driverId])).rows[0]
    const sessBefore = (await pool.query(`SELECT updated_at FROM driver_sessions WHERE id = $1`, [driver.sessionId])).rows[0]
    await beat({ sessionId: driver.sessionId })
    const after = (await pool.query(q, [driver.driverId])).rows[0]
    const sessAfter = (await pool.query(`SELECT updated_at FROM driver_sessions WHERE id = $1`, [driver.sessionId])).rows[0]
    expect(after).toEqual(before)
    expect(after.is_available).toBe(false)
    expect(sessAfter.updated_at).toEqual(sessBefore.updated_at)
  })

  it('a session id that is not the driver\'s current one is ignored (no record, no false "session ended")', async () => {
    await reset()
    const res = await beat({ sessionId: '999999999' })
    expect(res.status).toBe(200)
    expect(await hb()).toBeNull()
  })

  it('rejects a missing or invalid session id', async () => {
    expect((await beat({})).status).toBe(422)
    expect((await beat({ sessionId: 'abc' })).status).toBe(422)
  })

  it('requires a driver login', async () => {
    const res = await request(app).post('/api/v1/rides/sessions/heartbeat').send({ sessionId: driver.sessionId })
    expect(res.status).toBe(401)
  })
})
