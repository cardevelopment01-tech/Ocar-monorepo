import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PoolClient } from 'pg'
import { pool } from '@/db/client'
import {
  reserveRedemption, consumeRedemption, releaseRedemption, reverseRedemption, getOfferByCode, normalizeCode,
  toCachedOffer, fromCachedOffer,
} from '@/modules/offers/offers.repository'

// Concurrency and state-machine contract of the redemption lifecycle (offers plan Task 3, Review Focus 1 to 3).
// Value: protects=no double redemption, no budget/limit overrun, no leak on release/reverse; fails_when=a guard in
// the atomic UPDATE/upsert or the savepoint rollback is removed; why_new=nothing else races these statements;
// seam=none; no_claim=application wiring (repository only).

const PHONE = '+919990000122'
let userId: bigint
let categoryId: number
const rideIds: bigint[] = []
const offerIds: bigint[] = []

async function newRide(): Promise<bigint> {
  const r = await pool.query(
    `INSERT INTO rides (user_id, category_id, ride_type, origin, status)
     VALUES ($1, $2, 'one_way', ST_SetSRID(ST_MakePoint(85.82, 20.29), 4326)::geography, 'cancelled') RETURNING id`,
    [userId, categoryId]
  )
  const id = BigInt(r.rows[0].id)
  rideIds.push(id)
  return id
}

async function newOffer(o: { budget?: number | null; globalLimit?: number | null; status?: string; code?: string | null } = {}) {
  const r = await pool.query(
    `INSERT INTO offers (name, kind, status, budget_total, global_limit, code) VALUES ('lifecycle-test', 'auto', $1, $2, $3, $4) RETURNING id`,
    [o.status ?? 'active', o.budget ?? null, o.globalLimit ?? null, o.code ?? null]
  )
  const offerId = BigInt(r.rows[0].id)
  offerIds.push(offerId)
  const v = await pool.query(`INSERT INTO offer_versions (offer_id, version, benefit) VALUES ($1, 1, '{"type":"flat_off","amount":100}') RETURNING id`, [offerId])
  const versionId = BigInt(v.rows[0].id)
  await pool.query(`UPDATE offers SET current_version_id = $2 WHERE id = $1`, [offerId, versionId])
  return { offerId, versionId }
}

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally { c.release() }
}

async function counters(offerId: bigint) {
  const o = await pool.query(`SELECT budget_spent::float8 AS spent, redemption_count AS n FROM offers WHERE id = $1`, [offerId])
  const u = await pool.query(`SELECT COALESCE(SUM(count), 0)::int AS used FROM offer_user_usage WHERE offer_id = $1 AND user_id = $2`, [offerId, userId])
  return { spent: o.rows[0].spent as number, n: o.rows[0].n as number, used: u.rows[0].used as number }
}

const reserve = (offerId: bigint, versionId: bigint, rideId: bigint, o: { perUserLimit?: number | null; discount?: number } = {}) =>
  inTx((c) => reserveRedemption(c, { offerId, versionId, userId, rideId, discount: o.discount ?? 100, cashback: 0, perUserLimit: o.perUserLimit ?? null }))

beforeAll(async () => {
  const u = await pool.query(`INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`, [PHONE])
  userId = BigInt(u.rows[0].id)
  categoryId = Number((await pool.query(`SELECT id FROM vehicle_categories ORDER BY id LIMIT 1`)).rows[0].id)
})

afterAll(async () => {
  await pool.query(`DELETE FROM offer_redemptions WHERE offer_id = ANY($1::bigint[])`, [offerIds])
  await pool.query(`DELETE FROM offer_user_usage WHERE offer_id = ANY($1::bigint[])`, [offerIds])
  await pool.query(`UPDATE offers SET current_version_id = NULL WHERE id = ANY($1::bigint[])`, [offerIds])
  await pool.query(`DELETE FROM offer_versions WHERE offer_id = ANY($1::bigint[])`, [offerIds])
  await pool.query(`DELETE FROM offers WHERE id = ANY($1::bigint[])`, [offerIds])
  await pool.query(`DELETE FROM rides WHERE id = ANY($1::bigint[])`, [rideIds])
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId])
})

describe('reserveRedemption', () => {
  it('(a) two concurrent reservations by one user on a per-user limit of 1: exactly one wins', async () => {
    const { offerId, versionId } = await newOffer()
    const [r1, r2] = [await newRide(), await newRide()]
    const res = await Promise.all([reserve(offerId, versionId, r1, { perUserLimit: 1 }), reserve(offerId, versionId, r2, { perUserLimit: 1 })])
    expect(res.filter((r) => r.ok)).toHaveLength(1)
    expect(res.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'USER_LIMIT' }])
    expect(await counters(offerId)).toEqual({ spent: 100, n: 1, used: 1 })
  })

  it('(b) 10 parallel reservations of 100 against a budget of 450: exactly 4 succeed', async () => {
    const { offerId, versionId } = await newOffer({ budget: 450 })
    const rides = await Promise.all(Array.from({ length: 10 }, () => newRide()))
    const res = await Promise.all(rides.map((r) => reserve(offerId, versionId, r)))
    expect(res.filter((r) => r.ok)).toHaveLength(4)
    expect(res.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'BUDGET')).toBe(true)
    expect(await counters(offerId)).toMatchObject({ spent: 400, n: 4 })
  })

  it('(g) a global limit of 3 admits exactly 3, then GLOBAL_LIMIT', async () => {
    const { offerId, versionId } = await newOffer({ globalLimit: 3 })
    const rides = await Promise.all(Array.from({ length: 5 }, () => newRide()))
    const res = await Promise.all(rides.map((r) => reserve(offerId, versionId, r)))
    expect(res.filter((r) => r.ok)).toHaveLength(3)
    expect(res.filter((r) => !r.ok).every((r) => !r.ok && r.reason === 'GLOBAL_LIMIT')).toBe(true)
  })

  it('(h) a null budget and a null limit are unlimited', async () => {
    const { offerId, versionId } = await newOffer()
    const rides = await Promise.all(Array.from({ length: 6 }, () => newRide()))
    const res = await Promise.all(rides.map((r) => reserve(offerId, versionId, r, { discount: 9999 })))
    expect(res.every((r) => r.ok)).toBe(true)
  })

  it('(f) a paused or ended offer is DISABLED', async () => {
    for (const status of ['paused', 'ended']) {
      const { offerId, versionId } = await newOffer({ status })
      expect(await reserve(offerId, versionId, await newRide())).toEqual({ ok: false, reason: 'DISABLED' })
    }
  })

  it('(j) a rejection leaves every counter unchanged while the transaction carries on and commits', async () => {
    const { offerId, versionId } = await newOffer({ budget: 50 })
    const ride = await newRide()
    const out = await inTx(async (c) => {
      const r = await reserveRedemption(c, { offerId, versionId, userId, rideId: ride, discount: 100, cashback: 0, perUserLimit: 5 })
      const mid = await c.query(`SELECT COALESCE(SUM(count), 0)::int AS used FROM offer_user_usage WHERE offer_id = $1`, [offerId])
      return { r, usedInsideTx: mid.rows[0].used as number }
    })
    expect(out.r).toEqual({ ok: false, reason: 'BUDGET' })
    expect(out.usedInsideTx).toBe(0)
    expect(await counters(offerId)).toEqual({ spent: 0, n: 0, used: 0 })
  })

  it('a second live redemption for one ride throws and leaves the counters as they were', async () => {
    const { offerId, versionId } = await newOffer()
    const ride = await newRide()
    await reserve(offerId, versionId, ride)
    await expect(reserve(offerId, versionId, ride)).rejects.toMatchObject({ code: '23505' })
    expect(await counters(offerId)).toEqual({ spent: 100, n: 1, used: 1 })
  })
})

describe('lifecycle transitions', () => {
  it('(c) release restores budget, count and usage, and is idempotent', async () => {
    const { offerId, versionId } = await newOffer({ budget: 500 })
    const ride = await newRide()
    await reserve(offerId, versionId, ride, { perUserLimit: 2 })
    expect(await inTx((c) => releaseRedemption(c, ride, 'cancelled'))).toBe(true)
    expect(await counters(offerId)).toEqual({ spent: 0, n: 0, used: 0 })
    expect(await inTx((c) => releaseRedemption(c, ride, 'cancelled'))).toBe(false)
    expect(await counters(offerId)).toEqual({ spent: 0, n: 0, used: 0 })
  })

  it('(d) consume returns the amounts once, then null', async () => {
    const { offerId, versionId } = await newOffer()
    const ride = await newRide()
    await reserve(offerId, versionId, ride)
    expect(await inTx((c) => consumeRedemption(c, ride))).toEqual({ discount: 100, cashback: 0, userId })
    expect(await inTx((c) => consumeRedemption(c, ride))).toBeNull()
  })

  it('(e) reverse after consume restores budget and usage', async () => {
    const { offerId, versionId } = await newOffer()
    const ride = await newRide()
    await reserve(offerId, versionId, ride, { perUserLimit: 3 })
    await inTx((c) => consumeRedemption(c, ride))
    expect(await inTx((c) => reverseRedemption(c, ride, 'refund'))).toBe(true)
    expect(await counters(offerId)).toEqual({ spent: 0, n: 0, used: 0 })
  })

  it('(i) the state machine refuses consume-after-release and release-after-consume (no double counting)', async () => {
    const { offerId, versionId } = await newOffer()
    const a = await newRide()
    await reserve(offerId, versionId, a)
    await inTx((c) => releaseRedemption(c, a, 'x'))
    expect(await inTx((c) => consumeRedemption(c, a))).toBeNull()
    const b = await newRide()
    await reserve(offerId, versionId, b)
    await inTx((c) => consumeRedemption(c, b))
    expect(await inTx((c) => releaseRedemption(c, b, 'x'))).toBe(false)
    expect(await counters(offerId)).toMatchObject({ spent: 100, n: 1 })
  })
})

describe('offer reads', () => {
  it('finds a code regardless of case and whitespace, and the cache form round-trips ids and dates', async () => {
    const code = `T${Date.now().toString(36).toUpperCase()}`
    const { offerId } = await newOffer({ code })
    expect(normalizeCode(`  ${code.toLowerCase().slice(0, 2)} ${code.toLowerCase().slice(2)} `)).toBe(code)
    const found = await getOfferByCode(`  ${code.toLowerCase()} `)
    expect(found?.id).toBe(offerId)
    const copy = fromCachedOffer(JSON.parse(JSON.stringify(toCachedOffer(found!))))
    expect(copy).toEqual(found)
  })
})
