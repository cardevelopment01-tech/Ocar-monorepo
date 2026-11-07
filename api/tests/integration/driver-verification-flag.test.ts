import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { invalidate } from '@/lib/cache/reference-cache'
import { configKey } from '@/constants/redis-keys'
import { loginAdmin, seedAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

// Only AWS and S3 are mocked: routes, validation, config, policy, admin API and every SQL statement are real.
const BUCKET = 'https://test-bucket.s3.ap-south-1.amazonaws.com/'
vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockImplementation(async (_k: string, folder: string) =>
    `https://test-bucket.s3.ap-south-1.amazonaws.com/${folder}/${Math.random().toString(36).slice(2)}.jpg`),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(`${url}?signed=1`)),
  extractS3Key: (url: string) => (url.startsWith('https://test-bucket.s3.ap-south-1.amazonaws.com/')
    ? url.slice('https://test-bucket.s3.ap-south-1.amazonaws.com/'.length).split('?')[0]! : null),
}))
vi.mock('@/modules/drivers/verification.provider', () => ({
  detectFaces: vi.fn(),
  compareFaces: vi.fn(),
  detectText: vi.fn(),
}))

import * as provider from '@/modules/drivers/verification.provider'

const app = createApp()
const PHONE = '+918200000203'
const ADMIN = 'verif-review-admin@ocar.app'
const SUPPORT = 'verif-review-support@ocar.app'
const PASSWORD = 'Admin@1234'
const GOOD_Q = { brightness: 70, sharpness: 70, yaw: 0, pitch: 0 }

async function loginDriver(phone: string): Promise<{ accessToken: string; driverId: string }> {
  await redis.del(`otp_rate:${phone}:login`)
  await redis.del(`otp:driver:${phone}:login`)
  const otpRes = await request(app).post('/api/v1/auth/otp/request').send({ phone, role: 'driver' })
  const { otp } = otpRes.body as { otp: string }
  const verifyRes = await request(app).post('/api/v1/auth/otp/verify').send({ phone, otp, role: 'driver' })
  const { tokens, principal } = verifyRes.body as { tokens: { accessToken: string }; principal: { id: string } }
  return { accessToken: tokens.accessToken, driverId: principal.id }
}

async function setMode(value: string) {
  await pool.query(`UPDATE system_config SET value = $1 WHERE key = 'verification_mode'`, [value])
  await invalidate(configKey('verification_mode'))
}

async function submitDaily(token: string) {
  const init = async (kind: 'selfie' | 'plate') =>
    (await request(app).post('/api/v1/drivers/daily-verification/upload-init')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind, content_type: 'image/jpeg', content_length: 1024 })).body.key as string
  return request(app).post('/api/v1/drivers/daily-verification')
    .set('Authorization', `Bearer ${token}`)
    .send({ selfie_key: await init('selfie'), plate_key: await init('plate') })
}

async function clearToday(driverId: string) {
  await pool.query(`DELETE FROM driver_verification_attempts WHERE driver_id = $1`, [driverId])
  await pool.query(`DELETE FROM driver_verifications WHERE driver_id = $1`, [driverId])
}

function scoreAs(similarity: number | null, plateText = 'OD33AW5615') {
  vi.mocked(provider.detectFaces).mockResolvedValue({ faceCount: 1, quality: GOOD_Q })
  vi.mocked(provider.compareFaces).mockResolvedValue(similarity)
  vi.mocked(provider.detectText).mockResolvedValue([{ text: plateText, confidence: 98 }])
}

let driverToken: string
let driverId: string
let adminToken: string
let supportToken: string

const adminGet = (path: string, token = adminToken) =>
  request(app).get(`/api/v1/admin/verifications${path}`).set('Authorization', `Bearer ${token}`)
const adminResolve = (id: string, body: Record<string, unknown>, token = adminToken) =>
  request(app).post(`/api/v1/admin/verifications/${id}/resolve`).set('Authorization', `Bearer ${token}`).send(body)

beforeAll(async () => {
  const login = await loginDriver(PHONE)
  driverToken = login.accessToken
  driverId = login.driverId
  const { rows: cats } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  const { rows: brands } = await pool.query<{ id: string }>("SELECT id FROM vehicle_brands WHERE name = 'Maruti Suzuki' LIMIT 1")
  const { rows: models } = await pool.query<{ id: string }>('SELECT id FROM vehicle_models WHERE brand_id = $1 LIMIT 1', [brands[0]!.id])
  await pool.query(
    `UPDATE drivers SET status = 'active', reference_selfie_url = $2, full_name = 'ZZ Flag Driver',
            city_id = (SELECT id FROM cities WHERE slug = 'bhubaneswar') WHERE id = $1`,
    [driverId, `${BUCKET}drivers/${driverId}/reference.jpg`]
  )
  await pool.query(
    `INSERT INTO driver_vehicles (driver_id, category_id, brand_id, model_id, number_plate, status, is_primary)
     VALUES ($1, $2, $3, $4, 'OD33AW5615', 'active', true)`,
    [driverId, cats[0]!.id, brands[0]!.id, models[0]!.id]
  )
  await seedAdmin(pool, ADMIN, 'ops_admin', PASSWORD)
  await seedAdmin(pool, SUPPORT, 'support_admin', PASSWORD)
  adminToken = (await loginAdmin(app, ADMIN, PASSWORD)).accessToken
  supportToken = (await loginAdmin(app, SUPPORT, PASSWORD)).accessToken
  await setMode('flag')
})

afterAll(async () => {
  await setMode('off')
  await pool.query(`DELETE FROM driver_face_references WHERE driver_id = $1`, [driverId])
  await clearToday(driverId)
  await pool.query(`DELETE FROM driver_vehicles WHERE driver_id = $1`, [driverId])
  await pool.query(`DELETE FROM drivers WHERE phone = $1`, [PHONE])
  await cleanupAdmins(pool, [ADMIN, SUPPORT])
  await redis.del(`otp_rate:${PHONE}:login`)
  await redis.del(`otp:driver:${PHONE}:login`)
  await pool.end()
  redis.disconnect()
})

describe('flag mode: daily submit', () => {
  it('a clear match is stored as passed with nothing queued', async () => {
    scoreAs(96)
    const res = await submitDaily(driverToken)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ complete: true, outcome: 'ok' })
    const { rows } = await pool.query(`SELECT kind, status, review_state FROM driver_verifications WHERE driver_id = $1`, [driverId])
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'passed' && r.review_state === 'none')).toBe(true)
  })

  it('a borderline match queues for review but the driver is still through', async () => {
    await clearToday(driverId)
    scoreAs(80)
    const res = await submitDaily(driverToken)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ complete: true, outcome: 'queued' })
    const sel = (await pool.query(`SELECT status, review_state, review_priority FROM driver_verifications WHERE driver_id = $1 AND kind = 'daily_selfie'`, [driverId])).rows[0]
    expect(sel).toMatchObject({ status: 'auto_passed', review_state: 'queued', review_priority: 1 })
    const st = await request(app).get('/api/v1/drivers/daily-verification/status').set('Authorization', `Bearer ${driverToken}`)
    expect(st.body.complete).toBe(true)
  })

  it('a hard mismatch queues first (priority 2) and still does not block', async () => {
    await clearToday(driverId)
    scoreAs(null)
    const res = await submitDaily(driverToken)
    expect(res.status).toBe(201)
    const sel = (await pool.query(`SELECT status, review_state, review_priority FROM driver_verifications WHERE driver_id = $1 AND kind = 'daily_selfie'`, [driverId])).rows[0]
    expect(sel).toMatchObject({ status: 'auto_passed', review_state: 'queued', review_priority: 2 })
  })

  it('asks for a retake of an unusable photo, stores no daily row, and tells the driver which photo and why (no scores)', async () => {
    await clearToday(driverId)
    vi.mocked(provider.detectFaces).mockResolvedValue({ faceCount: 0, quality: null })
    vi.mocked(provider.detectText).mockResolvedValue([{ text: 'OD33AW5615', confidence: 98 }])
    const res = await submitDaily(driverToken)
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VERIFICATION_RETAKE')
    expect(res.body.details).toEqual({ selfie: 'NO_FACE', plate: null })
    expect(JSON.stringify(res.body)).not.toMatch(/similarity|score/i)
    const rows = await pool.query(`SELECT 1 FROM driver_verifications WHERE driver_id = $1`, [driverId])
    expect(rows.rows).toHaveLength(0)
    const attempts = await pool.query(`SELECT kind, decision FROM driver_verification_attempts WHERE driver_id = $1 ORDER BY kind::text`, [driverId])
    expect(attempts.rows).toEqual([{ kind: 'daily_plate', decision: 'pass' }, { kind: 'daily_selfie', decision: 'retake' }])
  })

  it('after the retake limit the photo goes to an admin instead of asking again', async () => {
    // one retake already recorded by the previous test; allow two more, the fourth submission is stored
    for (let i = 0; i < 2; i++) expect((await submitDaily(driverToken)).status).toBe(422)
    const res = await submitDaily(driverToken)
    expect(res.status).toBe(201)
    expect(res.body.outcome).toBe('queued')
    const sel = (await pool.query(`SELECT status, review_state FROM driver_verifications WHERE driver_id = $1 AND kind = 'daily_selfie'`, [driverId])).rows[0]
    expect(sel).toMatchObject({ status: 'auto_passed', review_state: 'queued' })
  })
})

describe('admin review queue', () => {
  let failedId = ''
  let reviewId = ''

  it('lists queued cases, fails before borderline, and rejects roles outside ops/super admin', async () => {
    await clearToday(driverId)
    scoreAs(null)
    await submitDaily(driverToken)
    const list = await adminGet('/')
    expect(list.status).toBe(200)
    expect(list.body.budget).toBe(30)
    const mine = list.body.items.filter((i: { driverId: string }) => i.driverId === driverId)
    expect(mine.length).toBeGreaterThanOrEqual(1)
    const selfie = mine.find((i: { kind: string }) => i.kind === 'daily_selfie')
    expect(selfie).toMatchObject({ decision: 'fail', reviewState: 'queued', priority: 2, driverName: 'ZZ Flag Driver' })
    failedId = selfie.id
    expect(list.body.items[0].priority).toBeGreaterThanOrEqual(list.body.items[list.body.items.length - 1].priority)

    expect((await adminGet('/', supportToken)).status).toBe(403)
    expect((await request(app).get('/api/v1/admin/verifications').set('Authorization', `Bearer ${driverToken}`)).status).toBeGreaterThanOrEqual(401)
    expect((await request(app).get('/api/v1/admin/verifications')).status).toBe(401)
  })

  it('shows one case with signed photo links, the reference, the registered plate and history', async () => {
    const res = await adminGet(`/${failedId}`)
    expect(res.status).toBe(200)
    const c = res.body.case
    expect(c.imageUrl).toMatch(/\?signed=1$/)
    expect(c.referenceUrls).toEqual([`${BUCKET}drivers/${driverId}/reference.jpg?signed=1`])
    expect(c.history.length).toBeGreaterThanOrEqual(1)
    expect((await adminGet('/999999999')).status).toBe(404)
    expect((await adminGet('/abc')).status).toBe(404)
  })

  it('a mismatch needs a note, fails the row, and the driver can redo the check (upsert replaces the failed row)', async () => {
    expect((await adminResolve(failedId, { outcome: 'mismatch' })).status).toBe(422)
    const done = await adminResolve(failedId, { outcome: 'mismatch', note: 'different person' })
    expect(done.status).toBe(200)
    const row = (await pool.query(`SELECT status, review_state, reviewed_by FROM driver_verifications WHERE id = $1`, [failedId])).rows[0]
    expect(row).toMatchObject({ status: 'failed', review_state: 'confirmed_mismatch' })
    expect(row.reviewed_by).not.toBeNull()
    const st = await request(app).get('/api/v1/drivers/daily-verification/status').set('Authorization', `Bearer ${driverToken}`)
    expect(st.body.complete).toBe(false)

    scoreAs(97)
    const redo = await submitDaily(driverToken)
    expect(redo.status).toBe(201)
    const after = (await pool.query(`SELECT status, review_state, reviewed_by FROM driver_verifications WHERE driver_id = $1 AND kind = 'daily_selfie'`, [driverId])).rows
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ status: 'passed', review_state: 'none', reviewed_by: null })
    expect((await request(app).get('/api/v1/drivers/daily-verification/status').set('Authorization', `Bearer ${driverToken}`)).body.complete).toBe(true)
  })

  it('a second resolve of the same case is a 409', async () => {
    const again = await adminResolve(failedId, { outcome: 'ok' })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('ALREADY_RESOLVED')
  })

  it('"looks fine" with add_reference keeps at most two admin-confirmed references, newest first', async () => {
    for (let i = 0; i < 3; i++) {
      await clearToday(driverId)
      scoreAs(80)
      await submitDaily(driverToken)
      const list = await adminGet('/')
      reviewId = list.body.items.find((x: { driverId: string; kind: string }) => x.driverId === driverId && x.kind === 'daily_selfie').id
      expect((await adminResolve(reviewId, { outcome: 'ok', add_reference: true })).status).toBe(200)
    }
    const refs = await pool.query(`SELECT image_url FROM driver_face_references WHERE driver_id = $1`, [driverId])
    expect(refs.rows).toHaveLength(2)
    const ctxCase = await adminGet(`/${reviewId}`)
    expect(ctxCase.body.case.referenceUrls).toHaveLength(3) // onboarding + 2 confirmed
  })

  it('stats count the queue against the budget and give a decision histogram', async () => {
    const s = await adminGet('/stats')
    expect(s.status).toBe(200)
    expect(s.body).toMatchObject({ budget: 30 })
    expect(typeof s.body.queued).toBe('number')
    expect(s.body.resolvedToday).toBeGreaterThanOrEqual(1)
    expect(s.body.histogram.length).toBeGreaterThan(0)
    const resolved = await adminGet('/?state=resolved_today')
    expect(resolved.body.items.length).toBeGreaterThanOrEqual(1)
  })
})
