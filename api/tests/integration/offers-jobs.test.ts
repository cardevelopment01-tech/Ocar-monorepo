import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { configKey } from '@/constants/redis-keys'
import { invalidateOffers } from '@/modules/offers/offers.repository'
import { endExpiredOffers, releaseStaleReservations } from '@/modules/offers/offers.worker'
import { cancelRideAsDriver } from '@/modules/rides/rides.service'
import { loginUser, loginDriver, seedActiveDriverWithVehicle, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// Reservation lifecycle jobs and the cancel hooks (offers plan Task 8, Review Focus 3). Value: protects=a ride that
// never ran gives its offer back exactly once, a live ride keeps it, expired offers end; fails_when=a cancel path or the
// sweep stops releasing, or releases a live ride; why_new=nothing else exercises these paths against the database;
// seam=none; no_claim=the BullMQ scheduling itself (the job bodies are called directly).

const app = createApp()
const PHONES = { a: '+919700000631', b: '+919700000632', c: '+919700000633', d: '+919700000634', driver: '+919700000635' } as const
const FLAGS = ['offers_enabled', 'commission_percent'] as const
const saved: Record<string, string> = {}
const offerIds: bigint[] = []
let categoryId: number
let driverId: string

async function setConfig(key: string, value: string) {
  await pool.query(`UPDATE system_config SET value = $2 WHERE key = $1`, [key, value])
  await redis.del(configKey(key))
}

async function newOffer(extra: { endsAt?: string } = {}): Promise<{ id: bigint; code: string }> {
  const code = `JB${Date.now().toString(36).toUpperCase()}${offerIds.length}`
  const r = await pool.query(`INSERT INTO offers (name, kind, status, code, ends_at) VALUES ('jobs', 'code', 'active', $1, $2) RETURNING id`, [code, extra.endsAt ?? null])
  const id = BigInt(r.rows[0].id)
  offerIds.push(id)
  const v = await pool.query(`INSERT INTO offer_versions (offer_id, version, benefit, per_user_limit) VALUES ($1, 1, '{"type":"percent_off","percent":10}', 1) RETURNING id`, [id])
  await pool.query(`UPDATE offers SET current_version_id = $2 WHERE id = $1`, [id, v.rows[0].id])
  await invalidateOffers(code)
  return { id, code }
}

const book = async (token: string, code: string) => {
  const res = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${token}`)
    .send({ categoryId, ...DEFAULT_BOOKING, paymentChannel: 'online', couponCode: code })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body as { rideId: string; discount: number }
}
const counters = async (offerId: bigint) => {
  const o = await pool.query(`SELECT budget_spent::float8 AS spent, redemption_count AS n FROM offers WHERE id = $1`, [offerId])
  const u = await pool.query(`SELECT COALESCE(SUM(count), 0)::int AS used FROM offer_user_usage WHERE offer_id = $1`, [offerId])
  return { spent: o.rows[0].spent as number, n: o.rows[0].n as number, used: u.rows[0].used as number }
}

beforeAll(async () => {
  for (const k of FLAGS) saved[k] = String((await pool.query(`SELECT value FROM system_config WHERE key = $1`, [k])).rows[0].value)
  await setConfig('offers_enabled', 'true')
  await setConfig('commission_percent', '0')
  categoryId = Number((await pool.query("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")).rows[0].id)
  driverId = (await loginDriver(app, redis, PHONES.driver)).driverId
  await seedActiveDriverWithVehicle(pool, driverId)
})

afterAll(async () => {
  const phones = Object.values(PHONES)
  await pool.query(`DELETE FROM offer_redemptions WHERE offer_id = ANY($1::bigint[])`, [offerIds.map(String)])
  await pool.query(`DELETE FROM offer_user_usage WHERE offer_id = ANY($1::bigint[])`, [offerIds.map(String)])
  await cleanupRideAndDriverData(pool, phones)
  await pool.query(`UPDATE offers SET current_version_id = NULL WHERE id = ANY($1::bigint[])`, [offerIds.map(String)])
  await pool.query(`DELETE FROM offer_versions WHERE offer_id = ANY($1::bigint[])`, [offerIds.map(String)])
  await pool.query(`DELETE FROM offers WHERE id = ANY($1::bigint[])`, [offerIds.map(String)])
  for (const k of FLAGS) await setConfig(k, saved[k]!)
  await invalidateOffers()
  for (const p of phones) { await redis.del(`otp_rate:user:${p}:login`); await redis.del(`otp_rate:driver:${p}:login`); await redis.del(`otp:user:${p}:login`); await redis.del(`otp:driver:${p}:login`) }
  await pool.end()
  redis.disconnect()
})

describe('cancel hooks', () => {
  it('a rider cancelling before a driver accepts gets the offer back', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.a)
    const { id, code } = await newOffer()
    const booked = await book(accessToken, code)
    expect(await counters(id)).toMatchObject({ n: 1, used: 1 })
    const res = await request(app).post(`/api/v1/rides/${booked.rideId}/cancel`).set('Authorization', `Bearer ${accessToken}`).send({ reasonCode: 'changed_mind' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(await counters(id)).toEqual({ spent: 0, n: 0, used: 0 })
    expect((await pool.query(`SELECT status FROM offer_redemptions WHERE offer_id = $1`, [id])).rows[0].status).toBe('released')
    // and they can use the once-per-rider code again
    expect((await book(accessToken, code)).rideId).toBeTruthy()
  })

  it('a driver cancelling an accepted ride gives the rider their offer back', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.b)
    const { id, code } = await newOffer()
    const booked = await book(accessToken, code)
    await pool.query(`UPDATE rides SET driver_id = $2, status = 'accepted', accepted_at = now(), billing_mode_snapshot = 'commission' WHERE id = $1`, [booked.rideId, driverId])
    await cancelRideAsDriver(BigInt(driverId), BigInt(booked.rideId), 'vehicle_issue')
    expect((await pool.query(`SELECT status FROM offer_redemptions WHERE offer_id = $1`, [id])).rows[0].status).toBe('released')
    expect(await counters(id)).toEqual({ spent: 0, n: 0, used: 0 })
  })
})

describe('stale reservation sweep', () => {
  it('releases an old reservation on a cancelled ride once, and leaves a live ride and a young one alone', async () => {
    const cancelled = await loginUser(app, redis, PHONES.c)
    const live = await loginUser(app, redis, PHONES.d)
    const { id: offA, code: codeA } = await newOffer()
    const { id: offB, code: codeB } = await newOffer()
    const rideC = await book(cancelled.accessToken, codeA)
    const rideL = await book(live.accessToken, codeB)
    // Make the cancelled ride's cancellation "leak": cancel the ride directly, bypassing the hook, and age both reservations.
    await pool.query(`UPDATE rides SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [rideC.rideId])
    await pool.query(`UPDATE offer_redemptions SET reserved_at = now() - interval '2 hours' WHERE ride_id = ANY($1)`, [[rideC.rideId, rideL.rideId]])

    const released = await releaseStaleReservations(30)
    expect(released).toBeGreaterThanOrEqual(1)
    expect((await pool.query(`SELECT status FROM offer_redemptions WHERE ride_id = $1`, [rideC.rideId])).rows[0].status).toBe('released')
    expect((await pool.query(`SELECT status FROM offer_redemptions WHERE ride_id = $1`, [rideL.rideId])).rows[0].status).toBe('reserved')
    expect(await counters(offA)).toEqual({ spent: 0, n: 0, used: 0 })
    expect((await counters(offB)).n).toBe(1)
    expect(await releaseStaleReservations(30)).toBe(0) // exactly once
  })
})

describe('offer expiry', () => {
  it('ends an offer past its end time and leaves a current one active', async () => {
    const past = await newOffer({ endsAt: new Date(Date.now() - 3600_000).toISOString() })
    const future = await newOffer({ endsAt: new Date(Date.now() + 3600_000).toISOString() })
    expect(await endExpiredOffers()).toBeGreaterThanOrEqual(1)
    expect((await pool.query(`SELECT status FROM offers WHERE id = $1`, [past.id])).rows[0].status).toBe('ended')
    expect((await pool.query(`SELECT status FROM offers WHERE id = $1`, [future.id])).rows[0].status).toBe('active')
  })
})
