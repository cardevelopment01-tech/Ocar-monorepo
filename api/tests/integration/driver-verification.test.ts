import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'

vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://storage.test/drivers/1/daily-verification/test.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()
const PHONE = '+918200000201'

async function loginDriver(phone: string): Promise<{ accessToken: string; driverId: string }> {
  await redis.del(`otp_rate:${phone}:login`)
  await redis.del(`otp:driver:${phone}:login`)
  const otpRes = await request(app).post('/api/v1/auth/otp/request').send({ phone, role: 'driver' })
  expect(otpRes.status, `OTP request failed: ${JSON.stringify(otpRes.body)}`).toBe(200)
  const { otp } = otpRes.body as { otp: string }
  const verifyRes = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp, role: 'driver' })
  expect(verifyRes.status, `OTP verify failed: ${JSON.stringify(verifyRes.body)}`).toBeGreaterThanOrEqual(200)
  const { tokens, principal } = verifyRes.body as { tokens: { accessToken: string }; principal: { id: string } }
  return { accessToken: tokens.accessToken, driverId: principal.id }
}

let categoryId: number
let brandId: number
let modelId: number

beforeAll(async () => {
  const { rows: cats } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  categoryId = parseInt(cats[0]!.id)
  const { rows: brands } = await pool.query<{ id: string }>("SELECT id FROM vehicle_brands WHERE name = 'Maruti Suzuki' LIMIT 1")
  brandId = parseInt(brands[0]!.id)
  const { rows: models } = await pool.query<{ id: string }>('SELECT id FROM vehicle_models WHERE brand_id = $1 LIMIT 1', [brandId])
  modelId = parseInt(models[0]!.id)
})

afterAll(async () => {
  // driver_verifications, driver_sessions and driver_location_snapshots all
  // reference drivers(id) with no ON DELETE CASCADE — TC-DV-003 creates the
  // first, TC-DV-004's goOnline() creates the other two (session insert +
  // location upsert). All three must be cleared before deleting the driver,
  // or the DELETE below throws a foreign-key violation.
  await pool.query(`DELETE FROM driver_verifications WHERE driver_id IN (SELECT id FROM drivers WHERE phone = $1)`, [PHONE])
  await pool.query(`DELETE FROM driver_location_snapshots WHERE driver_id IN (SELECT id FROM drivers WHERE phone = $1)`, [PHONE])
  await pool.query(`DELETE FROM driver_sessions WHERE driver_id IN (SELECT id FROM drivers WHERE phone = $1)`, [PHONE])
  await pool.query(`DELETE FROM driver_wallet_ledger WHERE driver_id IN (SELECT id FROM drivers WHERE phone = $1)`, [PHONE])
  await pool.query(`DELETE FROM driver_wallets WHERE driver_id IN (SELECT id FROM drivers WHERE phone = $1)`, [PHONE])
  await pool.query(`DELETE FROM drivers WHERE phone = $1`, [PHONE])
  await redis.del(`otp_rate:${PHONE}:login`)
  await redis.del(`otp:driver:${PHONE}:login`)
  await pool.end()
  redis.disconnect()
})

// These 4 tests deliberately run as one continuous flow (login → incomplete
// status → blocked go-online → submit → complete status → allowed go-online)
// sharing accessToken/driverId set in TC-DV-001 — not independently runnable
// via .only, unlike most tests in m03.test.ts.
describe('Driver daily verification', () => {
  let accessToken: string
  let driverId: string

  it('TC-DV-001: new driver has an incomplete status before any submission', async () => {
    const login = await loginDriver(PHONE)
    accessToken = login.accessToken
    driverId = login.driverId

    // goOnline() (TC-DV-002/004) now requires drivers.city_id to be set — no
    // GPS fallback — so assign one directly since this test never runs the
    // personal-info onboarding step that normally sets it.
    await pool.query(
      `UPDATE drivers SET status = 'active', city_id = (SELECT id FROM cities WHERE slug = 'bhubaneswar') WHERE id = $1`,
      [driverId]
    )

    await pool.query(
      `INSERT INTO driver_vehicles (driver_id, category_id, brand_id, model_id, number_plate, status, is_primary)
       VALUES ($1, $2, $3, $4, 'OD02XX9999', 'active', true)`,
      [driverId, categoryId, brandId, modelId]
    )

    // TC-DV-004 calls goOnline(), which since the minimum-wallet-balance
    // gate (driver_minimum_balance, default 500) requires balance >= that
    // threshold — fund well above it so this flow isn't coupled to the
    // configured minimum's exact value.
    await pool.query(
      `INSERT INTO driver_wallets (driver_id, balance) VALUES ($1, 10000)`,
      [driverId]
    )

    const res = await request(app)
      .get('/api/v1/drivers/daily-verification/status')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ selfieDone: false, plateDone: false, complete: false })
  })

  it('TC-DV-002: going online is blocked with 428 before verification', async () => {
    const vehicleRes = await pool.query<{ id: string }>(
      'SELECT id FROM driver_vehicles WHERE driver_id = $1 LIMIT 1', [driverId]
    )
    const vehicleId = vehicleRes.rows[0]!.id

    const res = await request(app)
      .post('/api/v1/rides/sessions/online')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mode: 'standard', vehicleId: Number(vehicleId), categoryId, lat: 20.29, lng: 85.82 })
    expect(res.status).toBe(428)
    expect(res.body.code).toBe('DAILY_CHECK_REQUIRED')
  })

  it('TC-DV-003: submitting both photos marks today complete and creates two rows', async () => {
    const res = await request(app)
      .post('/api/v1/drivers/daily-verification')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('selfie', Buffer.from('fake-selfie'), { filename: 'selfie.jpg', contentType: 'image/jpeg' })
      .attach('plate',  Buffer.from('fake-plate'),  { filename: 'plate.jpg',  contentType: 'image/jpeg' })
    expect(res.status).toBe(201)

    const rows = await pool.query<{ kind: string; status: string }>(
      `SELECT kind, status FROM driver_verifications
       WHERE driver_id = $1 AND verified_for = (now() AT TIME ZONE 'Asia/Kolkata')::date`,
      [driverId]
    )
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.every((r) => r.status === 'auto_passed')).toBe(true)
    expect(new Set(rows.rows.map((r) => r.kind))).toEqual(new Set(['daily_selfie', 'daily_plate']))

    const statusRes = await request(app)
      .get('/api/v1/drivers/daily-verification/status')
      .set('Authorization', `Bearer ${accessToken}`)
    expect(statusRes.body).toEqual({ selfieDone: true, plateDone: true, complete: true })
  })

  it('TC-DV-004: going online succeeds after verification is complete', async () => {
    const vehicleRes = await pool.query<{ id: string }>(
      'SELECT id FROM driver_vehicles WHERE driver_id = $1 LIMIT 1', [driverId]
    )
    const vehicleId = vehicleRes.rows[0]!.id

    const res = await request(app)
      .post('/api/v1/rides/sessions/online')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ mode: 'standard', vehicleId: Number(vehicleId), categoryId, lat: 20.29, lng: 85.82 })
    // route responds via res.json(session) with no explicit status code, so this is 200 not 201
    expect(res.status).toBe(200)
  })
})
