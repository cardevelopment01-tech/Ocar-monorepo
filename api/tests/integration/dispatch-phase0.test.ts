import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { configKey } from '@/constants/redis-keys'
import { processBroadcast } from '@/jobs/processors/broadcast.processor'
import { loginUser, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'

// Dispatch phase 0 against a real database (docs/superpowers/plans/2026-11-10-dispatch-phase0-fast-rounds-and-logging.md):
// migration 135's columns and dispatch_rounds table, the diag query, and that a round is recorded with what it did.

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()
const PHONES = { driver: '+919800000051', rider: '+919800000052' } as const
const KEYS = ['dispatch_no_resend_enabled', 'dispatch_fast_rounds_enabled', 'dispatch_decision_log_enabled'] as const

let driver: Awaited<ReturnType<typeof setupOnlineDriver>>
let userToken: string
const saved = new Map<string, string>()

async function setFlag(key: string, value: string) {
  await pool.query(`UPDATE system_config SET value = $2 WHERE key = $1`, [key, value])
  await redis.del(configKey(key))
}

beforeAll(async () => {
  driver = await setupOnlineDriver(app, pool, redis, PHONES.driver, { categorySlug: 'sedan' })
  userToken = (await loginUser(app, redis, PHONES.rider)).accessToken
  for (const k of KEYS) saved.set(k, (await pool.query(`SELECT value FROM system_config WHERE key = $1`, [k])).rows[0]?.value ?? 'false')
})

afterAll(async () => {
  for (const [k, v] of saved) await setFlag(k, v)
  await pool.query(`DELETE FROM dispatch_rounds WHERE ride_id IN (SELECT id FROM rides WHERE user_id = (SELECT id FROM users WHERE phone = $1))`, [PHONES.rider])
  await cleanupRideAndDriverData(pool, Object.values(PHONES))
  for (const p of Object.values(PHONES)) {
    for (const k of [`otp_rate:user:${p}:login`, `otp_rate:driver:${p}:login`, `otp:user:${p}:login`, `otp:driver:${p}:login`]) await redis.del(k)
  }
  await pool.end()
  redis.disconnect()
})

async function book(): Promise<string> {
  await pool.query(`UPDATE rides SET status = 'cancelled' WHERE user_id = (SELECT id FROM users WHERE phone = $1) AND status = 'requested'`, [PHONES.rider])
  const res = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${userToken}`)
    .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.rideId as string
}

const broadcast = (rideId: string, broadcastRound: number) =>
  processBroadcast({
    rideId, categoryId: String(driver.categoryId), originLat: DEFAULT_BOOKING.originLat, originLng: DEFAULT_BOOKING.originLng,
    rideType: DEFAULT_BOOKING.rideType, isReturnCab: false, broadcastRound,
  })

const rounds = async (rideId: string) => (await pool.query(`SELECT * FROM dispatch_rounds WHERE ride_id = $1 ORDER BY id`, [rideId])).rows
const offer = async (rideId: string) => (await pool.query(`SELECT * FROM ride_assignments WHERE ride_id = $1 AND driver_id = $2`, [rideId, driver.driverId])).rows[0]

describe('with the log on', () => {
  beforeAll(async () => {
    await setFlag('dispatch_no_resend_enabled', 'true')
    await setFlag('dispatch_fast_rounds_enabled', 'false')
    await setFlag('dispatch_decision_log_enabled', 'true')
  })

  it('an offer records its distances, rank and how the driver was reached; the round records what it did', async () => {
    const id = await book()
    await broadcast(id, 1)
    const a = await offer(id)
    expect(a.straight_m).toBeGreaterThanOrEqual(0)
    expect(a.shown_m).toBeGreaterThanOrEqual(a.straight_m)
    expect(a.rank).toBe(1)
    expect(a.radius_m).toBeGreaterThan(0)
    expect(['live', 'background', 'no_socket']).toContain(a.reach)
    expect(a.fast_step).toBe(0)

    const r = await rounds(id)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ round: 1, found: 1, offered: 1, outcome: 'offered', fast_step: 0 })
    // fewer than a full wave, so the "why few" picture is there, and it saw the driver
    expect(r[0].diag.online_in_radius).toBeGreaterThanOrEqual(1)
  })

  it('a round that finds nobody is recorded as empty, with why: the driver in range is paused', async () => {
    const id = await book()
    await pool.query(`UPDATE driver_location_snapshots SET is_available = false, updated_at = now() - interval '10 minutes' WHERE driver_id = $1`, [driver.driverId])
    await broadcast(id, 1)
    const r = await rounds(id)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ round: 1, found: 0, offered: 0, outcome: 'empty' })
    expect(r[0].diag.online_in_radius).toBeGreaterThanOrEqual(1)
    expect(r[0].diag.paused).toBeGreaterThanOrEqual(1)
    await pool.query(`UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`, [driver.driverId])
  })
})

describe('with the log off', () => {
  it('nothing is recorded and the offer is unchanged', async () => {
    await setFlag('dispatch_decision_log_enabled', 'false')
    const id = await book()
    await broadcast(id, 1)
    expect(await rounds(id)).toHaveLength(0)
    const a = await offer(id)
    expect(a.straight_m).toBeNull()
    expect(a.rank).toBeNull()
  })

  it('a later offer that carries no record keeps what the earlier offer recorded', async () => {
    await setFlag('dispatch_decision_log_enabled', 'true')
    const id = await book()
    await broadcast(id, 1)
    const first = await offer(id)
    expect(first.rank).toBe(1)
    await setFlag('dispatch_decision_log_enabled', 'false')
    // No-resend leaves a still-open offer alone, so let the first one lapse before the next round re-offers it.
    await pool.query(`UPDATE ride_assignments SET expires_at = now() - interval '1 minute' WHERE ride_id = $1`, [id])
    await broadcast(id, 2)
    const again = await offer(id)
    expect(again.broadcast_round).toBe(2)
    expect(again.rank).toBe(1)
    expect(again.straight_m).toBe(first.straight_m)
    expect(again.reach).toBe(first.reach)
  })
})

describe('fast rounds, end to end', () => {
  it('an empty round 1 with the switch on widens (nothing wider to find here) and still does not close the ride', async () => {
    await setFlag('dispatch_decision_log_enabled', 'true')
    await setFlag('dispatch_fast_rounds_enabled', 'true')
    const id = await book()
    await pool.query(`UPDATE driver_location_snapshots SET is_available = false, updated_at = now() - interval '10 minutes' WHERE driver_id = $1`, [driver.driverId])
    await broadcast(id, 1)
    const r = await rounds(id)
    expect(r[0]).toMatchObject({ outcome: 'empty', found: 0 })
    expect(r[0].widest_radius_m).toBeGreaterThanOrEqual(r[0].radius_m)
    expect((await pool.query(`SELECT status::text AS status FROM rides WHERE id = $1`, [id])).rows[0].status).toBe('requested')
    await pool.query(`UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`, [driver.driverId])
  })
})
