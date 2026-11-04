import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { configKey } from '@/constants/redis-keys'
import { invalidateOffers } from '@/modules/offers/offers.repository'
import { loginUser, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// Booking with an offer, against real Postgres (offers plan Task 6, Review Focus 1 and 3). Value: protects=the discount
// and the reservation are written with the ride, a concurrent double tap redeems once, a changed price books nothing;
// fails_when=the reservation leaves the booking transaction or the unique index/limit stops holding; why_new=the unit
// test fakes the database; seam=none; no_claim=payment settlement (PR2 Task 7 covers it).

const app = createApp()
const PHONES = { a: '+919700000611', b: '+919700000612', c: '+919700000613', d: '+919700000614', e: '+919700000615' } as const
const FLAGS = ['offers_enabled', 'commission_percent', 'offers_cash_discounts_enabled'] as const
const saved: Record<string, string> = {}
const offerIds: bigint[] = []
let categoryId: number

async function setConfig(key: string, value: string) {
  await pool.query(`UPDATE system_config SET value = $2 WHERE key = $1`, [key, value])
  await redis.del(configKey(key))
}

async function newOffer(o: { code?: string; kind?: 'code' | 'auto'; perUserLimit?: number | null; budget?: number | null } = {}): Promise<bigint> {
  const kind = o.kind ?? 'code'
  const code = kind === 'code' ? (o.code ?? `IT${Date.now().toString(36).toUpperCase()}`) : null
  const r = await pool.query(`INSERT INTO offers (name, kind, status, code, budget_total) VALUES ('booking-it', $1, 'active', $2, $3) RETURNING id`, [kind, code, o.budget ?? null])
  const id = BigInt(r.rows[0].id)
  offerIds.push(id)
  const v = await pool.query(
    `INSERT INTO offer_versions (offer_id, version, benefit, per_user_limit) VALUES ($1, 1, '{"type":"percent_off","percent":10}', $2) RETURNING id`,
    [id, o.perUserLimit ?? null]
  )
  await pool.query(`UPDATE offers SET current_version_id = $2 WHERE id = $1`, [id, v.rows[0].id])
  await invalidateOffers(code)
  return id
}
const codeOf = async (id: bigint) => String((await pool.query(`SELECT code::text AS c FROM offers WHERE id = $1`, [id])).rows[0].c)

beforeAll(async () => {
  for (const k of FLAGS) saved[k] = String((await pool.query(`SELECT value FROM system_config WHERE key = $1`, [k])).rows[0].value)
  await setConfig('offers_enabled', 'true')
  await setConfig('commission_percent', '0')
  categoryId = Number((await pool.query("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")).rows[0].id)
})

afterAll(async () => {
  // usage rows reference the users the cleanup below deletes
  await pool.query(`DELETE FROM offer_user_usage WHERE offer_id = ANY($1::bigint[])`, [offerIds.map(String)])
  await cleanupRideAndDriverData(pool, Object.values(PHONES))
  await pool.query(`UPDATE offers SET current_version_id = NULL WHERE id = ANY($1::bigint[])`, [offerIds.map(String)])
  await pool.query(`DELETE FROM offer_versions WHERE offer_id = ANY($1::bigint[])`, [offerIds.map(String)])
  await pool.query(`DELETE FROM offers WHERE id = ANY($1::bigint[])`, [offerIds.map(String)])
  for (const k of FLAGS) await setConfig(k, saved[k]!)
  await invalidateOffers()
  for (const p of Object.values(PHONES)) { await redis.del(`otp_rate:user:${p}:login`); await redis.del(`otp:user:${p}:login`) }
  await pool.end()
  redis.disconnect()
})

const book = (token: string, extra: object = {}) =>
  request(app).post('/api/v1/rides').set('Authorization', `Bearer ${token}`).send({ categoryId, ...DEFAULT_BOOKING, paymentChannel: 'online', ...extra })

describe('booking with an offer', () => {
  it('stores the discount and a reserved redemption pinned to the offer version, and reports the payable', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.a)
    const id = await newOffer()
    const res = await book(accessToken, { couponCode: (await codeOf(id)).toLowerCase() })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.discount).toBeGreaterThan(0)
    expect(res.body.payable).toBeCloseTo(res.body.estimatedFare - res.body.discount, 2)
    const snap = await pool.query('SELECT discount_amount::float8 AS d, total_estimated::float8 AS t FROM fare_snapshots WHERE ride_id = $1', [res.body.rideId])
    expect(snap.rows[0].d).toBe(res.body.discount)
    expect(snap.rows[0].t).toBe(res.body.estimatedFare) // total_* stay gross
    const red = await pool.query(`SELECT status, offer_version_id, discount_amount::float8 AS d FROM offer_redemptions WHERE ride_id = $1`, [res.body.rideId])
    expect(red.rows).toHaveLength(1)
    expect(red.rows[0]).toMatchObject({ status: 'reserved', d: res.body.discount })
    const o = await pool.query('SELECT budget_spent::float8 AS s, redemption_count AS n FROM offers WHERE id = $1', [id])
    expect(o.rows[0]).toEqual({ s: res.body.discount, n: 1 })
  })

  it('a double tap with a once-per-rider code gives one ride, one reservation and one use', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.b)
    const id = await newOffer({ perUserLimit: 1 })
    const code = await codeOf(id)
    const [x, y] = await Promise.all([book(accessToken, { couponCode: code }), book(accessToken, { couponCode: code })])
    // The loser is refused either at the live-ride index (409) or, if the winner already committed, because the code is used (422).
    expect([x.status, y.status].filter((st) => st === 201)).toHaveLength(1)
    expect([x.status, y.status].filter((st) => st === 409 || st === 422)).toHaveLength(1)
    const rideId = (x.status === 201 ? x : y).body.rideId
    expect((await pool.query('SELECT 1 FROM offer_redemptions WHERE offer_id = $1', [id])).rows).toHaveLength(1)
    expect((await pool.query('SELECT count FROM offer_user_usage WHERE offer_id = $1', [id])).rows[0].count).toBe(1)
    expect(rideId).toBeTruthy()
  })

  it('an unknown code fails the booking and creates no ride', async () => {
    const { accessToken, userId } = await loginUser(app, redis, PHONES.c)
    const res = await book(accessToken, { couponCode: 'NOSUCHCODE' })
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('OFFER_NOT_APPLICABLE')
    expect((await pool.query('SELECT 1 FROM rides WHERE user_id = $1', [userId])).rows).toHaveLength(0)
  })

  it('a stale expectedPayable answers 409 PRICE_CHANGED with the new price and books nothing', async () => {
    const { accessToken, userId } = await loginUser(app, redis, PHONES.d)
    const res = await book(accessToken, { expectedPayable: 1 })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('PRICE_CHANGED')
    expect(res.body.details.payable).toBeGreaterThan(1)
    expect((await pool.query('SELECT 1 FROM rides WHERE user_id = $1', [userId])).rows).toHaveLength(0)
  })

  it('a scheduled ride reserves at booking; while offers are off the code is ignored', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.e)
    const id = await newOffer()
    const when = new Date(Date.now() + 3 * 24 * 3600_000).toISOString()
    const sched = await book(accessToken, { couponCode: await codeOf(id), scheduledFor: when })
    expect(sched.status, JSON.stringify(sched.body)).toBe(201)
    expect((await pool.query(`SELECT status FROM offer_redemptions WHERE ride_id = $1`, [sched.body.rideId])).rows[0].status).toBe('reserved')

    await setConfig('offers_enabled', 'false')
    try {
      const off = await book(accessToken, { couponCode: await codeOf(id), scheduledFor: new Date(Date.now() + 4 * 24 * 3600_000).toISOString() })
      expect(off.status, JSON.stringify(off.body)).toBe(201)
      expect(off.body.discount).toBe(0)
      expect((await pool.query(`SELECT 1 FROM offer_redemptions WHERE ride_id = $1`, [off.body.rideId])).rows).toHaveLength(0)
    } finally { await setConfig('offers_enabled', 'true') }
  })
})
