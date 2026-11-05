import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { configKey } from '@/constants/redis-keys'
import { invalidateOffers } from '@/modules/offers/offers.repository'
import { finaliseDiscount } from '@/modules/offers/settlement'
import { releaseRedemption } from '@/modules/offers/offers.repository'
import { collectCash, settleRideCompletionPayment } from '@/modules/rides/rides.service'
import { loginUser, loginDriver, seedActiveDriverWithVehicle, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// A discounted ride from booking to money (offers plan Task 7). Value: protects=payments.amount is the payable, the
// commission/earning/redemption follow it, no wallet credit exists, and the final discount can shrink but never grow;
// fails_when=any fare writer or settlement reader goes back to the gross fare; why_new=unit tests mock the database;
// seam=none; no_claim=PayU Checkout itself (dev auto-confirm path) and device UI.

const app = createApp()
const PHONES = { user: '+919700000621', driver: '+919700000622', user2: '+919700000623', user3: '+919700000624' } as const
const FLAGS = ['offers_enabled', 'commission_percent', 'offers_cash_discounts_enabled', 'offers_max_discount_percent'] as const
const saved: Record<string, string> = {}
const offerIds: bigint[] = []
let categoryId: number
let driverId: string

async function setConfig(key: string, value: string) {
  await pool.query(`UPDATE system_config SET value = $2 WHERE key = $1`, [key, value])
  await redis.del(configKey(key))
}

async function newOffer(percent = 20): Promise<{ id: bigint; code: string }> {
  const code = `LC${Date.now().toString(36).toUpperCase()}${offerIds.length}`
  const r = await pool.query(`INSERT INTO offers (name, kind, status, code) VALUES ('lifecycle', 'code', 'active', $1) RETURNING id`, [code])
  const id = BigInt(r.rows[0].id)
  offerIds.push(id)
  const v = await pool.query(`INSERT INTO offer_versions (offer_id, version, benefit) VALUES ($1, 1, $2) RETURNING id`, [id, JSON.stringify({ type: 'percent_off', percent })])
  await pool.query(`UPDATE offers SET current_version_id = $2 WHERE id = $1`, [id, v.rows[0].id])
  await invalidateOffers(code)
  return { id, code }
}

async function bookWithOffer(token: string, channel: 'cash' | 'online', code: string) {
  const res = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${token}`)
    .send({ categoryId, ...DEFAULT_BOOKING, paymentChannel: channel, couponCode: code })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body as { rideId: string; estimatedFare: number; discount: number; payable: number }
}

/** Put the booked ride in the state a finished trip is in, without driving the whole lifecycle. */
async function completeRide(rideId: string) {
  // The status trigger only allows real transitions, so walk them.
  await pool.query(`UPDATE rides SET driver_id = $2, status = 'accepted', accepted_at = now(), billing_mode_snapshot = 'commission' WHERE id = $1`, [rideId, driverId])
  await pool.query(`UPDATE rides SET status = 'driver_arrived' WHERE id = $1`, [rideId])
  await pool.query(`UPDATE rides SET status = 'in_progress', started_at = now() WHERE id = $1`, [rideId])
  await pool.query(`UPDATE rides SET status = 'completed', completed_at = now() WHERE id = $1`, [rideId])
}

beforeAll(async () => {
  for (const k of FLAGS) saved[k] = String((await pool.query(`SELECT value FROM system_config WHERE key = $1`, [k])).rows[0].value)
  await setConfig('offers_enabled', 'true')
  await setConfig('commission_percent', '0')
  await setConfig('offers_cash_discounts_enabled', 'true')
  await setConfig('offers_max_discount_percent', '50')
  categoryId = Number((await pool.query("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")).rows[0].id)
  driverId = (await loginDriver(app, redis, PHONES.driver)).driverId
  await seedActiveDriverWithVehicle(pool, driverId)
})

afterAll(async () => {
  const phones = Object.values(PHONES)
  await pool.query(`DELETE FROM driver_earnings WHERE driver_id = $1`, [driverId]).catch(() => undefined)
  await pool.query(`DELETE FROM offer_redemptions WHERE user_id IN (SELECT id FROM users WHERE phone = ANY($1))`, [phones])
  await pool.query(`DELETE FROM offer_user_usage WHERE user_id IN (SELECT id FROM users WHERE phone = ANY($1))`, [phones])
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

describe('cash ride with an offer', () => {
  it('records the payable, takes no commission at 0%, consumes the redemption and writes no wallet credit', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.user)
    const { code, id } = await newOffer()
    const booked = await bookWithOffer(accessToken, 'cash', code)
    expect(booked.discount).toBeGreaterThan(0)
    await completeRide(booked.rideId)

    const out = await collectCash(BigInt(driverId), BigInt(booked.rideId), {})
    expect(out.collected).toBeCloseTo(booked.payable, 2)
    expect(out.discrepancy).toBe(false)

    const pay = await pool.query(`SELECT amount::float8 AS amount, discount_amount::float8 AS discount, commission_amount::float8 AS commission, driver_earning::float8 AS earning, status FROM payments WHERE ride_id = $1`, [booked.rideId])
    expect(pay.rows[0].amount).toBeCloseTo(booked.estimatedFare - booked.discount, 2)
    expect(pay.rows[0].discount).toBe(booked.discount)
    expect(pay.rows[0].commission).toBe(0)
    expect(pay.rows[0].earning).toBeCloseTo(pay.rows[0].amount, 2)
    const snap = await pool.query(`SELECT discount_amount::float8 AS d FROM fare_snapshots WHERE ride_id = $1`, [booked.rideId])
    expect(snap.rows[0].d).toBe(pay.rows[0].discount)
    const red = await pool.query(`SELECT status, discount_amount::float8 AS d FROM offer_redemptions WHERE offer_id = $1`, [id])
    expect(red.rows[0]).toMatchObject({ status: 'consumed', d: booked.discount })
    const ledger = await pool.query(`SELECT 1 FROM driver_wallet_ledger WHERE driver_id = $1 AND ride_id = $2`, [driverId, booked.rideId])
    expect(ledger.rows).toHaveLength(0) // no commission line at 0%, and never an offer credit
  })

  it('collecting the gross fare instead of the payable is a discrepancy', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.user2)
    const { code } = await newOffer()
    const booked = await bookWithOffer(accessToken, 'cash', code)
    await completeRide(booked.rideId)
    const out = await collectCash(BigInt(driverId), BigInt(booked.rideId), { collectedAmount: booked.estimatedFare })
    expect(out.discrepancy).toBe(true)
  })
})

describe('online ride with an offer', () => {
  it('creates the payment at the payable and credits the driver the same amount', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.user3)
    const { code, id } = await newOffer()
    const booked = await bookWithOffer(accessToken, 'online', code)
    await completeRide(booked.rideId)
    await settleRideCompletionPayment(BigInt(booked.rideId), BigInt(driverId))

    const pay = await pool.query(`SELECT amount::float8 AS amount, status FROM payments WHERE ride_id = $1`, [booked.rideId])
    expect(pay.rows[0].amount).toBeCloseTo(booked.payable, 2)
    if (pay.rows[0].status === 'completed') {
      // dev auto-confirm (no PayU keys): the earnings line is the payable and the redemption is consumed
      const earn = await pool.query(`SELECT amount::float8 AS amount FROM driver_earnings WHERE driver_id = $1 AND entry_type = 'ride_fare_net'`, [driverId])
      expect(earn.rows.at(-1).amount).toBeCloseTo(booked.payable, 2)
      expect((await pool.query(`SELECT status FROM offer_redemptions WHERE offer_id = $1`, [id])).rows[0].status).toBe('consumed')
    }
  })
})

describe('finaliseDiscount (D15, D22)', () => {
  async function rideWithReservation(percent: number, estimate: number) {
    const u = await pool.query(`INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`, [PHONES.user])
    const userId = String(u.rows[0].id)
    const ride = await pool.query(
      `INSERT INTO rides (user_id, category_id, ride_type, origin, status) VALUES ($1, $2, 'one_way', ST_SetSRID(ST_MakePoint(85.82, 20.29), 4326)::geography, 'cancelled') RETURNING id`,
      [userId, categoryId]
    )
    const rideId = String(ride.rows[0].id)
    const { id, code } = await newOffer(percent)
    const rc = await pool.query(`SELECT id FROM rate_cards ORDER BY id LIMIT 1`)
    const discount = Math.round(estimate * percent) / 100
    await pool.query(
      `INSERT INTO fare_snapshots (ride_id, rate_card_id, ride_type, estimated_km, estimated_min, base_fare, total_estimated, status, discount_amount)
       VALUES ($1, $2, 'one_way', 10, 10, $3, $3, 'estimate', $4)`,
      [rideId, rc.rows[0].id, estimate, discount]
    )
    const v = await pool.query(`SELECT current_version_id FROM offers WHERE id = $1`, [id])
    await pool.query(`INSERT INTO offer_redemptions (offer_id, offer_version_id, user_id, ride_id, status, discount_amount) VALUES ($1, $2, $3, $4, 'reserved', $5)`, [id, v.rows[0].current_version_id, userId, rideId, discount])
    await pool.query(`UPDATE offers SET budget_spent = $2, redemption_count = 1 WHERE id = $1`, [id, discount])
    void code
    return { rideId, id, discount }
  }
  const state = async (rideId: string, offerId: bigint) => ({
    discount: (await pool.query(`SELECT discount_amount::float8 AS d FROM fare_snapshots WHERE ride_id = $1`, [rideId])).rows[0].d as number,
    redemption: (await pool.query(`SELECT discount_amount::float8 AS d FROM offer_redemptions WHERE ride_id = $1`, [rideId])).rows[0].d as number,
    spent: (await pool.query(`SELECT budget_spent::float8 AS s FROM offers WHERE id = $1`, [offerId])).rows[0].s as number,
  })

  it('a dearer final fare keeps the discount, a cheaper one shrinks it and trues the budget down, an equal one changes nothing', async () => {
    const { rideId, id } = await rideWithReservation(20, 454)
    await pool.query(`UPDATE fare_snapshots SET total_final = 520 WHERE ride_id = $1`, [rideId])
    await finaliseDiscount(pool, BigInt(rideId))
    expect(await state(rideId, id)).toEqual({ discount: 90.8, redemption: 90.8, spent: 90.8 })

    await pool.query(`UPDATE fare_snapshots SET total_final = 400 WHERE ride_id = $1`, [rideId])
    await finaliseDiscount(pool, BigInt(rideId))
    expect(await state(rideId, id)).toEqual({ discount: 80, redemption: 80, spent: 80 })

    await pool.query(`UPDATE fare_snapshots SET total_final = 400 WHERE ride_id = $1`, [rideId])
    await finaliseDiscount(pool, BigInt(rideId))
    expect(await state(rideId, id)).toEqual({ discount: 80, redemption: 80, spent: 80 }) // idempotent

    await pool.query(`UPDATE fare_snapshots SET total_final = 520 WHERE ride_id = $1`, [rideId])
    await finaliseDiscount(pool, BigInt(rideId))
    expect((await state(rideId, id)).discount).toBe(80) // never grows back
  })

  it('two overlapping finalise calls true the budget down once, not twice', async () => {
    const { rideId, id } = await rideWithReservation(20, 454)
    await pool.query(`UPDATE fare_snapshots SET total_final = 400 WHERE ride_id = $1`, [rideId])
    await Promise.all([finaliseDiscount(pool, BigInt(rideId)), finaliseDiscount(pool, BigInt(rideId)), finaliseDiscount(pool, BigInt(rideId))])
    expect(await state(rideId, id)).toEqual({ discount: 80, redemption: 80, spent: 80 })
  })

  it('releasing the reservation clears the ride discount so every reader shows the gross fare', async () => {
    const { rideId, id } = await rideWithReservation(20, 454)
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      expect(await releaseRedemption(c, BigInt(rideId), 'test')).toBe(true)
      await c.query('COMMIT')
    } finally { c.release() }
    const snap = await pool.query(`SELECT discount_amount::float8 AS d, ocar_payable(total_estimated, discount_amount)::float8 AS payable FROM fare_snapshots WHERE ride_id = $1`, [rideId])
    expect(snap.rows[0]).toEqual({ d: 0, payable: 454 })
    expect((await state(rideId, id)).spent).toBe(0)
  })

  it('a ride with no redemption is left alone', async () => {
    const { rows } = await pool.query(`SELECT ride_id FROM fare_snapshots WHERE discount_amount = 0 LIMIT 1`)
    if (rows[0]) expect(await finaliseDiscount(pool, BigInt(rows[0].ride_id))).toBe(0)
  })
})
