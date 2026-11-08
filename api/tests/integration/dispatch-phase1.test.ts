import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { configKey } from '@/constants/redis-keys'
import { processBroadcast } from '@/jobs/processors/broadcast.processor'
import * as repo from '@/modules/rides/rides.repository'
import {
  loginUser, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING,
} from '../helpers/fixtures/rides.fixture'

// Dispatch phase 1 against a real database (docs/superpowers/plans/2026-11-08-dispatch-spread-to-more-drivers.md):
// the booking stamp, the open-offer guarantee, the ack column and the exclusion in the driver query.

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()
const PHONES = { driver: '+919800000031', rider: '+919800000032' } as const
const FLAG = 'dispatch_no_resend_enabled'

let driver: Awaited<ReturnType<typeof setupOnlineDriver>>
let userToken: string
let savedFlag = 'false'

async function setFlag(value: string) {
  await pool.query(`UPDATE system_config SET value = $2 WHERE key = $1`, [FLAG, value])
  await redis.del(configKey(FLAG))
}

beforeAll(async () => {
  driver = await setupOnlineDriver(app, pool, redis, PHONES.driver, { categorySlug: 'sedan' })
  userToken = (await loginUser(app, redis, PHONES.rider)).accessToken
  savedFlag = (await pool.query(`SELECT value FROM system_config WHERE key = $1`, [FLAG])).rows[0]?.value ?? 'false'
})

afterAll(async () => {
  await setFlag(savedFlag)
  await cleanupRideAndDriverData(pool, Object.values(PHONES))
  for (const p of Object.values(PHONES)) {
    for (const k of [`otp_rate:user:${p}:login`, `otp_rate:driver:${p}:login`, `otp:user:${p}:login`, `otp:driver:${p}:login`]) {
      await redis.del(k)
    }
  }
  await pool.end()
  redis.disconnect()
})

// A rider may have only one live ride, so close whatever the previous test left before booking.
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

const assignment = async (rideId: string) =>
  (await pool.query(`SELECT status::text AS status, expires_at, offered_at, broadcast_round, acked_at FROM ride_assignments WHERE ride_id = $1 AND driver_id = $2`, [rideId, driver.driverId])).rows
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('the booking stamps which dispatch rules the ride lives under', () => {
  it('flag off: variant 0', async () => {
    await setFlag('false')
    const id = await book()
    expect((await pool.query(`SELECT dispatch_variant FROM rides WHERE id = $1`, [id])).rows[0].dispatch_variant).toBe(0)
  })

  it('flag on: variant 1, and a later flip does not change that ride', async () => {
    await setFlag('true')
    const id = await book()
    await setFlag('false')
    expect((await pool.query(`SELECT dispatch_variant FROM rides WHERE id = $1`, [id])).rows[0].dispatch_variant).toBe(1)
  })
})

describe('an open offer in a later round', () => {
  it('variant 0 (the original behaviour, documented): round 2 moves the expiry of the driver\'s still-open offer', async () => {
    await setFlag('false')
    const id = await book()
    await broadcast(id, 1)
    const first = (await assignment(id))[0]
    await pause(30)
    await broadcast(id, 2)
    const second = (await assignment(id))[0]
    expect(new Date(second.expires_at).getTime()).toBeGreaterThan(new Date(first.expires_at).getTime())
    expect(second.broadcast_round).toBe(2)
  })

  it('variant 1: round 2 leaves the still-open offer exactly as it was (same expiry, same round, one row)', async () => {
    await setFlag('true')
    const id = await book()
    await broadcast(id, 1)
    const first = await assignment(id)
    await pause(30)
    await broadcast(id, 2)
    const second = await assignment(id)
    expect(second).toHaveLength(1)
    expect(new Date(second[0].expires_at).getTime()).toBe(new Date(first[0].expires_at).getTime())
    expect(second[0].broadcast_round).toBe(1)
    await setFlag('false')
  })

  it('variant 1: a driver who DECLINED still comes back in a later round (re-offer is kept; only a live offer is left alone)', async () => {
    await setFlag('true')
    const id = await book()
    await broadcast(id, 1)
    const res = await request(app).post(`/api/v1/rides/${id}/decline`).set('Authorization', `Bearer ${driver.accessToken}`)
    expect(res.status).toBe(200)
    await broadcast(id, 2)
    const row = (await assignment(id))[0]
    expect(row.status).toBe('offered')
    expect(row.broadcast_round).toBe(2)
    await setFlag('false')
  })
})

describe('repository: live offers, acks and the exclusion list', () => {
  it('getLiveOfferDriverIds counts only offered rows that have not expired', async () => {
    const id = await book()
    await broadcast(id, 1)
    // Other online drivers may sit at the same spot in a shared test database, so assert on THIS driver, not an exact list.
    const mine = BigInt(driver.driverId)
    expect(await repo.getLiveOfferDriverIds(BigInt(id))).toContain(mine)
    await pool.query(`UPDATE ride_assignments SET expires_at = now() - interval '1 second' WHERE ride_id = $1`, [id])
    expect(await repo.getLiveOfferDriverIds(BigInt(id))).not.toContain(mine)
    await pool.query(`UPDATE ride_assignments SET expires_at = now() + interval '20 seconds', status = 'declined' WHERE ride_id = $1`, [id])
    expect(await repo.getLiveOfferDriverIds(BigInt(id))).not.toContain(mine)
  })

  it('markOfferAcked records the first ack once, only for an open offer, and a reopened row starts un-acked', async () => {
    const id = await book()
    await broadcast(id, 1)
    await repo.markOfferAcked(BigInt(id), BigInt(driver.driverId))
    const firstAck = (await assignment(id))[0].acked_at
    expect(firstAck).not.toBeNull()
    await pause(20)
    await repo.markOfferAcked(BigInt(id), BigInt(driver.driverId))
    expect((await assignment(id))[0].acked_at).toEqual(firstAck)
    // declined, then re-offered in a later round: the old ack no longer says the driver received THIS offer
    await pool.query(`UPDATE ride_assignments SET status = 'declined' WHERE ride_id = $1`, [id])
    await repo.markOfferAcked(BigInt(id), BigInt(driver.driverId))
    expect((await assignment(id))[0].acked_at).toEqual(firstAck)
    await broadcast(id, 2)
    expect((await assignment(id))[0].acked_at).toBeNull()
  })

  it('findNearbyDrivers leaves out the drivers it is told to, and is unchanged when the list is empty', async () => {
    const base = {
      lat: DEFAULT_BOOKING.originLat, lng: DEFAULT_BOOKING.originLng, categoryIds: [BigInt(driver.categoryId)], minWalletBalance: 0, radiusMetres: 10_000,
    }
    const all = await repo.findNearbyDrivers(base)
    expect(all.map((d) => String(d.driver_id))).toContain(String(driver.driverId))
    expect((await repo.findNearbyDrivers({ ...base, excludeDriverIds: [] })).map((d) => String(d.driver_id))).toContain(String(driver.driverId))
    expect((await repo.findNearbyDrivers({ ...base, excludeDriverIds: [BigInt(driver.driverId)] })).map((d) => String(d.driver_id))).not.toContain(String(driver.driverId))
  })
})
