import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import * as repo from '@/modules/rides/rides.repository'
import { setupOnlineDriver, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'

// The driver heartbeat (liveness without a position) against a real database.

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
  await cleanupRideAndDriverData(pool, [PHONE])
  for (const k of [`otp_rate:driver:${PHONE}:login`, `otp:driver:${PHONE}:login`]) await redis.del(k)
  await pool.end()
  redis.disconnect()
})

// updated_at has a trigger that resets it on every UPDATE; age it with triggers off, inside a transaction.
async function ageSession(minutes: number) {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(`SET LOCAL session_replication_role = replica`)
    await c.query(`UPDATE driver_sessions SET updated_at = now() - ($2 || ' minutes')::interval WHERE id = $1`, [driver.sessionId, minutes])
    await c.query(`UPDATE driver_location_snapshots SET recorded_at = now() - ($2 || ' minutes')::interval WHERE driver_id = $1`, [driver.driverId, minutes])
    await c.query('COMMIT')
  } finally { c.release() }
}
const isStale = async () => (await repo.findStaleOnlineDrivers(300)).some((d) => d.driver_id === String(driver.driverId))
const beat = (body: unknown) => request(app).post('/api/v1/rides/sessions/heartbeat').set('Authorization', `Bearer ${driver.accessToken}`).send(body as object)

describe('driver heartbeat', () => {
  it('a driver silent for 10 minutes is stale, and one heartbeat makes them fresh again', async () => {
    await ageSession(10)
    expect(await isStale()).toBe(true)
    const res = await beat({ sessionId: driver.sessionId })
    expect(res.status).toBe(200)
    expect(await isStale()).toBe(false)
  })

  it('it changes neither the position nor the availability (those keep their own checks)', async () => {
    await pool.query(`UPDATE driver_location_snapshots SET is_available = false WHERE driver_id = $1`, [driver.driverId])
    const before = (await pool.query(`SELECT recorded_at, ST_AsText(location::geometry) AS loc FROM driver_location_snapshots WHERE driver_id = $1`, [driver.driverId])).rows[0]
    await beat({ sessionId: driver.sessionId })
    const after = (await pool.query(`SELECT recorded_at, is_available, ST_AsText(location::geometry) AS loc FROM driver_location_snapshots WHERE driver_id = $1`, [driver.driverId])).rows[0]
    expect(after.is_available).toBe(false)
    expect(after.loc).toBe(before.loc)
    expect(new Date(after.recorded_at).getTime()).toBe(new Date(before.recorded_at).getTime())
  })

  it('a session that is not the driver\'s own is not refreshed', async () => {
    await ageSession(10)
    const res = await beat({ sessionId: '999999999' })
    expect(res.status).toBe(200)
    expect(await isStale()).toBe(true)
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
