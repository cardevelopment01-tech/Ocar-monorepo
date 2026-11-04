import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '@/db/client'

// Schema contract of migrations 121 to 123 (offers plan Task 1). Real Postgres: constraints and the
// ocar_payable function are what is under test, so a mocked pool could not tell them apart.
// Value: protects=one live redemption per ride, immutable versions, the payable function, flag defaults;
// fails_when=an index, constraint, default or the function is dropped or changed; why_new=nothing else
// exercises these tables; seam=none; no_claim=application behaviour (SQL only).

const PHONE = '+919990000121'
let userId: string
let rideId: string
let offerId: string
let versionId: string

beforeAll(async () => {
  const u = await pool.query(`INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id`, [PHONE])
  userId = String(u.rows[0].id)
  const cat = await pool.query(`SELECT id FROM vehicle_categories ORDER BY id LIMIT 1`)
  const r = await pool.query(
    `INSERT INTO rides (user_id, category_id, ride_type, origin)
     VALUES ($1, $2, 'one_way', ST_SetSRID(ST_MakePoint(85.82, 20.29), 4326)::geography) RETURNING id`,
    [userId, cat.rows[0].id]
  )
  rideId = String(r.rows[0].id)
  const o = await pool.query(`INSERT INTO offers (name, kind) VALUES ('schema-test', 'auto') RETURNING id`)
  offerId = String(o.rows[0].id)
  const v = await pool.query(
    `INSERT INTO offer_versions (offer_id, version, benefit) VALUES ($1, 1, '{"type":"percent_off","percent":10}') RETURNING id`,
    [offerId]
  )
  versionId = String(v.rows[0].id)
})

afterAll(async () => {
  await pool.query(`DELETE FROM offer_redemptions WHERE offer_id = $1`, [offerId])
  await pool.query(`UPDATE offers SET current_version_id = NULL WHERE id = $1`, [offerId])
  await pool.query(`DELETE FROM offer_versions WHERE offer_id = $1`, [offerId])
  await pool.query(`DELETE FROM offers WHERE id = $1`, [offerId])
  await pool.query(`DELETE FROM rides WHERE id = $1`, [rideId])
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId])
})

async function reserve(): Promise<void> {
  await pool.query(
    `INSERT INTO offer_redemptions (offer_id, offer_version_id, user_id, ride_id, status) VALUES ($1, $2, $3, $4, 'reserved')`,
    [offerId, versionId, userId, rideId]
  )
}

describe('offers schema', () => {
  it('allows one live redemption per ride and rejects a second with 23505', async () => {
    await reserve()
    await expect(reserve()).rejects.toMatchObject({ code: '23505' })
  })

  it('lets a released redemption be followed by a new one for the same ride', async () => {
    await pool.query(`UPDATE offer_redemptions SET status = 'released' WHERE ride_id = $1`, [rideId])
    await expect(reserve()).resolves.toBeUndefined()
  })

  it('rejects a duplicate (offer_id, version)', async () => {
    await expect(
      pool.query(`INSERT INTO offer_versions (offer_id, version, benefit) VALUES ($1, 1, '{}')`, [offerId])
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('defaults discount_amount to 0 on fare_snapshots and payments', async () => {
    const cols = await pool.query(
      `SELECT table_name, column_default, is_nullable FROM information_schema.columns
       WHERE column_name = 'discount_amount' AND table_name IN ('fare_snapshots', 'payments')`
    )
    expect(cols.rows).toHaveLength(2)
    for (const c of cols.rows) {
      expect(c.column_default).toMatch(/^0/)
      expect(c.is_nullable).toBe('NO')
    }
  })

  it('does not add payments.charged_amount (payments.amount is the payable)', async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'charged_amount'`)
    expect(r.rows).toHaveLength(0)
  })

  it('seeds the flags off and the discount cap at 15', async () => {
    const r = await pool.query(
      `SELECT key, value FROM system_config WHERE key IN ('offers_enabled', 'offers_cash_discounts_enabled', 'offers_cashback_enabled', 'offers_max_discount_percent')`
    )
    const byKey = Object.fromEntries(r.rows.map((x: { key: string; value: string }) => [x.key, x.value]))
    expect(byKey).toEqual({
      offers_enabled: 'false',
      offers_cash_discounts_enabled: 'false',
      offers_cashback_enabled: 'false',
      offers_max_discount_percent: '15',
    })
  })
})

describe('ocar_payable', () => {
  const payable = async (g: number, d: number) =>
    Number((await pool.query(`SELECT ocar_payable($1::numeric, $2::numeric) AS p`, [g, d])).rows[0].p)

  it('subtracts the discount, never goes negative, and treats no discount as the gross', async () => {
    expect(await payable(454, 90.8)).toBe(363.2)
    expect(await payable(100, 150)).toBe(0)
    expect(await payable(454, 0)).toBe(454)
    expect(await payable(0, 0)).toBe(0)
  })

  it('treats a NULL discount as none', async () => {
    const r = await pool.query(`SELECT ocar_payable(454::numeric, NULL) AS p`)
    expect(Number(r.rows[0].p)).toBe(454)
  })
})
