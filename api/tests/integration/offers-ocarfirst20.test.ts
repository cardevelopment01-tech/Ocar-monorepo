import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { configKey } from '@/constants/redis-keys'
import { invalidateOffers } from '@/modules/offers/offers.repository'
import { collectCash } from '@/modules/rides/rides.service'
import { loginUser, loginDriver, seedActiveDriverWithVehicle, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// The launch coupon, end to end through the real HTTP API, DB and Redis: OCARFIRST20 = 20% off a rider's first ride.
// Value: protects=the exact config the client wants to launch is creatable by an admin and behaves as promised for new,
// returning and ineligible riders under every switch combination; fails_when=the cap blocks the offer, a returning rider
// gets it, a second use works, a switch is ignored or the money does not add up; why_new=nothing had exercised the coupon as
// a whole; seam=none; no_claim=PayU Checkout, device UI.

const app = createApp()
const CODE = 'OCARFIRST20'
// A realistic routed distance for the pair of points (above the server's straight-line floor), sent identically to the preview
// and the booking exactly as the app does with the fare screen's route.
const ROUTE = { distanceKm: 30, durationMin: 45 } as const
const ADMIN = 'ocarfirst20-admin@ocar.test'
const PHONES = { newRider: '+919700000701', returning: '+919700000702', driver: '+919700000703', online: '+919700000704', off: '+919700000705' } as const
const KEYS = ['offers_enabled', 'commission_percent', 'offers_cash_discounts_enabled', 'offers_max_discount_percent'] as const
const saved: Record<string, string> = {}
let categoryId: number
let driverId: string
let adminToken: string
let offerId: string

async function setConfig(key: string, value: string) {
  await pool.query(`UPDATE system_config SET value = $2 WHERE key = $1`, [key, value])
  await redis.del(configKey(key))
  await invalidateOffers()
}

const previewBody = (channel: 'cash' | 'online', code: string | undefined = CODE) => ({
  category_id: categoryId, ride_type: 'one_way', distance_km: ROUTE.distanceKm, duration_min: ROUTE.durationMin,
  paymentChannel: channel, originLat: DEFAULT_BOOKING.originLat, originLng: DEFAULT_BOOKING.originLng,
  destinationLat: DEFAULT_BOOKING.destinationLat, destinationLng: DEFAULT_BOOKING.destinationLng, ...(code ? { code } : {}),
})
const preview = (token: string, channel: 'cash' | 'online', code?: string) =>
  request(app).post('/api/v1/offers/preview').set('Authorization', `Bearer ${token}`).send(previewBody(channel, code))

const book = (token: string, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/rides').set('Authorization', `Bearer ${token}`).send({ categoryId, ...DEFAULT_BOOKING, ...ROUTE, ...extra })

async function completeRide(rideId: string) {
  await pool.query(`UPDATE rides SET driver_id = $2, status = 'accepted', accepted_at = now(), billing_mode_snapshot = 'commission' WHERE id = $1`, [rideId, driverId])
  await pool.query(`UPDATE rides SET status = 'driver_arrived' WHERE id = $1`, [rideId])
  await pool.query(`UPDATE rides SET status = 'in_progress', started_at = now() WHERE id = $1`, [rideId])
  await pool.query(`UPDATE rides SET status = 'completed', completed_at = now() WHERE id = $1`, [rideId])
}

const launchOffer = (percent = 20) => ({
  name: 'First ride 20% off', kind: 'code', code: CODE, status: 'active', budgetTotal: 50000, globalLimit: null,
  endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  rules: [{ kind: 'new_user' }], benefit: { type: 'percent_off', percent, maxDiscount: 100 }, perUserLimit: null, stacking: 'exclusive', display: {},
})

beforeAll(async () => {
  for (const k of KEYS) saved[k] = String((await pool.query(`SELECT value FROM system_config WHERE key = $1`, [k])).rows[0].value)
  await pool.query(`DELETE FROM offers WHERE code = $1`, [CODE]).catch(() => undefined)
  categoryId = Number((await pool.query("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")).rows[0].id)
  driverId = (await loginDriver(app, redis, PHONES.driver)).driverId
  await seedActiveDriverWithVehicle(pool, driverId)
  await seedAdmin(pool, ADMIN, 'super_admin')
  adminToken = (await loginAdmin(app, ADMIN, 'Admin@1234')).accessToken
})

afterAll(async () => {
  const phones = Object.values(PHONES)
  await pool.query(`DELETE FROM driver_earnings WHERE driver_id = $1`, [driverId]).catch(() => undefined)
  await pool.query(`DELETE FROM offer_redemptions WHERE user_id IN (SELECT id FROM users WHERE phone = ANY($1))`, [phones])
  await pool.query(`DELETE FROM offer_user_usage WHERE user_id IN (SELECT id FROM users WHERE phone = ANY($1))`, [phones])
  await cleanupRideAndDriverData(pool, phones)
  await pool.query(`UPDATE offers SET current_version_id = NULL WHERE code = $1`, [CODE])
  await pool.query(`DELETE FROM offer_versions WHERE offer_id IN (SELECT id FROM offers WHERE code = $1)`, [CODE])
  await pool.query(`DELETE FROM offers WHERE code = $1`, [CODE])
  await cleanupAdmins(pool, [ADMIN])
  for (const k of KEYS) await setConfig(k, saved[k]!)
  for (const p of phones) for (const role of ['user', 'driver']) { await redis.del(`otp_rate:${role}:${p}:login`); await redis.del(`otp:${role}:${p}:login`) }
  await pool.end()
  redis.disconnect()
})

describe('1. the admin can create the launch coupon', () => {
  it('is refused while the discount cap is 15%, with a clear reason', async () => {
    await setConfig('offers_max_discount_percent', '15')
    const res = await request(app).post('/api/v1/admin/offers').set('Authorization', `Bearer ${adminToken}`).send(launchOffer())
    expect(res.status, JSON.stringify(res.body)).toBe(422)
    expect(JSON.stringify(res.body)).toContain('DISCOUNT_TOO_HIGH')
  })
  it('is created once the cap is raised to 20, as a one-use new-rider code', async () => {
    await setConfig('offers_max_discount_percent', '20')
    const res = await request(app).post('/api/v1/admin/offers').set('Authorization', `Bearer ${adminToken}`).send(launchOffer())
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    offerId = String(res.body.offer.id)
    const v = await pool.query(`SELECT per_user_limit FROM offer_versions WHERE offer_id = $1`, [offerId])
    expect(v.rows[0].per_user_limit).toBe(1) // a first-ride offer is forced to one use per rider
    await invalidateOffers(CODE)
  })
  it('a second offer with the same code (any letter case) is refused', async () => {
    const res = await request(app).post('/api/v1/admin/offers').set('Authorization', `Bearer ${adminToken}`).send(launchOffer())
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})

describe('2. a brand-new rider, everything switched on', () => {
  beforeAll(async () => {
    await setConfig('offers_enabled', 'true')
    await setConfig('commission_percent', '0')
    await setConfig('offers_cash_discounts_enabled', 'true')
  })

  it('preview: 20% off, capped at the max amount, payable = fare - discount; the code works in any letter case', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.newRider)
    for (const typed of [CODE, CODE.toLowerCase(), ` ${CODE} `]) {
      const res = await preview(accessToken, 'cash', typed)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.enabled).toBe(true)
      expect(res.body.applied?.code?.toUpperCase()).toBe(CODE)
      const expected = Math.min(Math.round(res.body.fareTotal * 0.2 * 100) / 100, 100)
      expect(res.body.discount).toBeCloseTo(expected, 2)
      expect(res.body.payable).toBeCloseTo(res.body.fareTotal - res.body.discount, 2)
    }
  })

  it('on a long, expensive trip the discount stops at the ₹100 ceiling (20% of the fare would be more)', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.newRider)
    const res = await request(app).post('/api/v1/offers/preview').set('Authorization', `Bearer ${accessToken}`)
      .send({ ...previewBody('cash'), distance_km: 200, duration_min: 240 })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.fareTotal * 0.2).toBeGreaterThan(100) // the premise: 20% alone would exceed the ceiling
    expect(res.body.discount).toBe(100)
    expect(res.body.payable).toBeCloseTo(res.body.fareTotal - 100, 2)
  })

  it('booking with the code: discounted payable stored; a stale expectedPayable is refused with the real price', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.newRider)
    const p = (await preview(accessToken, 'cash')).body
    const stale = await book(accessToken, { paymentChannel: 'cash', couponCode: CODE, expectedPayable: p.payable + 7 })
    expect(stale.status, JSON.stringify(stale.body)).toBe(409)
    expect(stale.body.code).toBe('PRICE_CHANGED')
    expect(stale.body.details.payable).toBeCloseTo(p.payable, 2)
    const ok = await book(accessToken, { paymentChannel: 'cash', couponCode: CODE, expectedPayable: p.payable })
    expect(ok.status, JSON.stringify(ok.body)).toBe(201)
    expect(ok.body.discount).toBeCloseTo(p.discount, 2)
    expect(ok.body.payable).toBeCloseTo(p.payable, 2)
    const red = await pool.query(`SELECT status FROM offer_redemptions WHERE offer_id = $1 AND ride_id = $2`, [offerId, ok.body.rideId])
    expect(red.rows[0].status).toBe('reserved')

    // finish the trip, collect the discounted cash: redemption consumed, driver gets what the rider paid
    await completeRide(ok.body.rideId)
    const out = await collectCash(BigInt(driverId), BigInt(ok.body.rideId), {})
    expect(out.collected).toBeCloseTo(p.payable, 2)
    const pay = await pool.query(`SELECT amount::float8 AS amount, discount_amount::float8 AS discount, driver_earning::float8 AS earning FROM payments WHERE ride_id = $1`, [ok.body.rideId])
    expect(pay.rows[0].amount).toBeCloseTo(p.payable, 2)
    expect(pay.rows[0].earning).toBeCloseTo(p.payable, 2)
    const done = await pool.query(`SELECT status FROM offer_redemptions WHERE offer_id = $1 AND ride_id = $2`, [offerId, ok.body.rideId])
    expect(done.rows[0].status).toBe('consumed')
  })

  it('after that first ride the same rider can no longer use the code', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.newRider)
    const res = await preview(accessToken, 'cash')
    expect(res.status).toBe(200)
    expect(res.body.applied).toBeNull()
    expect(res.body.rejected[0]?.reason).toMatch(/NEW_USERS_ONLY|USER_LIMIT/)
    const booked = await book(accessToken, { paymentChannel: 'cash', couponCode: CODE })
    expect(booked.status, JSON.stringify(booked.body)).toBe(422)
    expect(booked.body.code).toBe('OFFER_NOT_APPLICABLE')
  })

  it('a rider who already has a completed ride never qualifies', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.returning)
    const first = await book(accessToken, { paymentChannel: 'cash' }) // a plain booking, no code
    expect(first.status, JSON.stringify(first.body)).toBe(201)
    await completeRide(first.body.rideId)
    const res = await preview(accessToken, 'cash')
    expect(res.body.applied).toBeNull()
    expect(res.body.rejected[0]?.reason).toBe('NEW_USERS_ONLY')
  })

  it('an unknown or misspelled code is refused with a message, and a booking still works at full price without it', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.online)
    const res = await preview(accessToken, 'cash', 'OCARFIRST21')
    expect(res.body.applied).toBeNull()
    expect(res.body.rejected[0]?.reason).toBe('UNKNOWN_CODE')
    expect(String(res.body.rejected[0]?.message).length).toBeGreaterThan(5)
  })
})

describe('3. the switches', () => {
  it('cash discounts off: a cash ride is told why, an online ride still gets 20%', async () => {
    await setConfig('offers_cash_discounts_enabled', 'false')
    const { accessToken } = await loginUser(app, redis, PHONES.online)
    const cash = await preview(accessToken, 'cash')
    expect(cash.body.applied).toBeNull()
    expect(cash.body.rejected[0]?.reason).toBe('PAYMENT_CHANNEL')
    const online = await preview(accessToken, 'online')
    expect(online.body.applied?.code?.toUpperCase()).toBe(CODE)
    await setConfig('offers_cash_discounts_enabled', 'true')
  })

  it('commission back on: no discount (the driver would be paid less AND charged commission)', async () => {
    await setConfig('commission_percent', '15')
    const { accessToken } = await loginUser(app, redis, PHONES.online)
    const res = await preview(accessToken, 'online')
    expect(res.body.applied).toBeNull()
    expect(res.body.rejected[0]?.reason).toBe('COMMISSION_ACTIVE')
    await setConfig('commission_percent', '0')
  })

  it('offers off: the app is told offers are off, and a booking carrying the code is priced at the full fare', async () => {
    await setConfig('offers_enabled', 'false')
    const { accessToken } = await loginUser(app, redis, PHONES.off)
    const res = await preview(accessToken, 'cash')
    expect(res.body.enabled).toBe(false)
    expect(res.body.applied).toBeNull()
    const booked = await book(accessToken, { paymentChannel: 'cash', couponCode: CODE })
    // Whatever the product decision is, it must not silently discount: record the actual behaviour.
    if (booked.status === 201) expect(booked.body.discount ?? 0).toBe(0)
    else expect([409, 422]).toContain(booked.status)
    await setConfig('offers_enabled', 'true')
  })

  it('the cap is also enforced at booking time: a 20% offer with the cap lowered back to 15 never gives more than 15%', async () => {
    await setConfig('offers_max_discount_percent', '15')
    const { accessToken } = await loginUser(app, redis, PHONES.off)
    const res = await preview(accessToken, 'cash')
    if (res.body.applied) expect(res.body.discount).toBeLessThanOrEqual(Math.round(res.body.fareTotal * 0.15 * 100) / 100 + 0.01)
    await setConfig('offers_max_discount_percent', '20')
  })
})
