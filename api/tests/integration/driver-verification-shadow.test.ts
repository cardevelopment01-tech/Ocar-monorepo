import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { invalidate } from '@/lib/cache/reference-cache'
import { configKey } from '@/constants/redis-keys'

// Only AWS is mocked: the route, validation, config lookup, scoring orchestration and every SQL statement are real.
const BUCKET_URL = 'https://test-bucket.s3.ap-south-1.amazonaws.com/'
vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockImplementation(async (_k: string, folder: string) =>
    `https://test-bucket.s3.ap-south-1.amazonaws.com/${folder}/${Math.random().toString(36).slice(2)}.jpg`),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
  extractS3Key: (url: string) => (url.startsWith('https://test-bucket.s3.ap-south-1.amazonaws.com/')
    ? url.slice('https://test-bucket.s3.ap-south-1.amazonaws.com/'.length) : null),
}))
vi.mock('@/modules/drivers/verification.provider', () => ({
  detectFaces: vi.fn(),
  compareFaces: vi.fn(),
  detectText: vi.fn(),
}))

import * as provider from '@/modules/drivers/verification.provider'

const app = createApp()
const PHONE = '+918200000202'
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

async function submitDaily(accessToken: string) {
  const init = async (kind: 'selfie' | 'plate') =>
    (await request(app).post('/api/v1/drivers/daily-verification/upload-init')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ kind, content_type: 'image/jpeg', content_length: 1024 })).body.key as string
  return request(app).post('/api/v1/drivers/daily-verification')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ selfie_key: await init('selfie'), plate_key: await init('plate') })
}

async function clearToday(driverId: string) {
  await pool.query(`DELETE FROM driver_verification_attempts WHERE driver_id = $1`, [driverId])
  await pool.query(`DELETE FROM driver_verifications WHERE driver_id = $1`, [driverId])
}

let accessToken: string
let driverId: string

beforeAll(async () => {
  const login = await loginDriver(PHONE)
  accessToken = login.accessToken
  driverId = login.driverId
  const { rows: cats } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  const { rows: brands } = await pool.query<{ id: string }>("SELECT id FROM vehicle_brands WHERE name = 'Maruti Suzuki' LIMIT 1")
  const { rows: models } = await pool.query<{ id: string }>('SELECT id FROM vehicle_models WHERE brand_id = $1 LIMIT 1', [brands[0]!.id])
  await pool.query(
    `UPDATE drivers SET status = 'active', reference_selfie_url = $2,
            city_id = (SELECT id FROM cities WHERE slug = 'bhubaneswar') WHERE id = $1`,
    [driverId, `${BUCKET_URL}drivers/${driverId}/reference.jpg`]
  )
  await pool.query(
    `INSERT INTO driver_vehicles (driver_id, category_id, brand_id, model_id, number_plate, status, is_primary)
     VALUES ($1, $2, $3, $4, 'OD33AW5615', 'active', true)`,
    [driverId, cats[0]!.id, brands[0]!.id, models[0]!.id]
  )
})

afterAll(async () => {
  await setMode('off')
  await clearToday(driverId)
  await pool.query(`DELETE FROM driver_vehicles WHERE driver_id = $1`, [driverId])
  await pool.query(`DELETE FROM drivers WHERE phone = $1`, [PHONE])
  await redis.del(`otp_rate:${PHONE}:login`)
  await redis.del(`otp:driver:${PHONE}:login`)
  await pool.end()
  redis.disconnect()
})

describe('Daily verification: shadow mode scoring', () => {
  it('stores the score and an attempt row, but still auto-passes (nothing a driver sees changes)', async () => {
    await setMode('shadow')
    vi.mocked(provider.detectFaces).mockResolvedValue({ faceCount: 1, quality: GOOD_Q })
    vi.mocked(provider.compareFaces).mockResolvedValue(96.4)
    vi.mocked(provider.detectText).mockResolvedValue([{ text: 'OD33 AW5615', confidence: 97 }])

    const res = await submitDaily(accessToken)
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ complete: true })

    const rows = await pool.query(
      `SELECT kind, status, decision, decision_reason, mode, match_similarity::float8 AS sim, ocr_text, face_quality, thresholds
         FROM driver_verifications WHERE driver_id = $1 ORDER BY kind`, [driverId])
    expect(rows.rows).toHaveLength(2)
    const plate = rows.rows.find((r) => r.kind === 'daily_plate')!
    const selfie = rows.rows.find((r) => r.kind === 'daily_selfie')!
    expect(selfie).toMatchObject({ status: 'auto_passed', decision: 'pass', decision_reason: 'MATCH', mode: 'shadow', sim: 96.4 })
    expect(selfie.face_quality).toMatchObject({ brightness: 70 })
    expect(selfie.thresholds).toMatchObject({ facePassMin: 90 })
    expect(plate).toMatchObject({ status: 'auto_passed', decision: 'pass', ocr_text: 'OD33AW5615' })

    const attempts = await pool.query(`SELECT kind, decision FROM driver_verification_attempts WHERE driver_id = $1`, [driverId])
    expect(attempts.rows).toHaveLength(2)

    const status = await request(app).get('/api/v1/drivers/daily-verification/status').set('Authorization', `Bearer ${accessToken}`)
    expect(status.body).toEqual({ selfieDone: true, plateDone: true, complete: true })
  })

  it('records a mismatch as a fail but still lets the driver through in shadow mode', async () => {
    await clearToday(driverId)
    vi.mocked(provider.compareFaces).mockResolvedValue(null)
    vi.mocked(provider.detectText).mockResolvedValue([{ text: 'KA01AB1234', confidence: 90 }])

    const res = await submitDaily(accessToken)
    expect(res.status).toBe(201)
    const rows = await pool.query(`SELECT kind, status, decision FROM driver_verifications WHERE driver_id = $1`, [driverId])
    expect(rows.rows.find((r) => r.kind === 'daily_selfie')).toMatchObject({ status: 'auto_passed', decision: 'fail' })
    expect(rows.rows.find((r) => r.kind === 'daily_plate')).toMatchObject({ status: 'auto_passed', decision: 'fail' })
  })

  it('survives an AWS outage: the check still completes and the error is recorded', async () => {
    await clearToday(driverId)
    vi.mocked(provider.detectFaces).mockRejectedValue(new Error('AWS down'))
    vi.mocked(provider.detectText).mockRejectedValue(new Error('AWS down'))

    const res = await submitDaily(accessToken)
    expect(res.status).toBe(201)
    const rows = await pool.query(`SELECT decision, decision_reason, status FROM driver_verifications WHERE driver_id = $1`, [driverId])
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.every((r) => r.decision === 'error' && r.decision_reason === 'PROVIDER_ERROR' && r.status === 'auto_passed')).toBe(true)
  })

  it('does not call AWS or store scores when the mode is off', async () => {
    await clearToday(driverId)
    await setMode('off')
    vi.mocked(provider.detectFaces).mockClear()

    const res = await submitDaily(accessToken)
    expect(res.status).toBe(201)
    expect(provider.detectFaces).not.toHaveBeenCalled()
    const rows = await pool.query(`SELECT decision, mode FROM driver_verifications WHERE driver_id = $1`, [driverId])
    expect(rows.rows.every((r) => r.decision === null && r.mode === null)).toBe(true)
    const attempts = await pool.query(`SELECT 1 FROM driver_verification_attempts WHERE driver_id = $1`, [driverId])
    expect(attempts.rows).toHaveLength(0)
  })

  it('a per-driver override turns scoring on while the global mode is off', async () => {
    await clearToday(driverId)
    await pool.query(`UPDATE drivers SET verification_mode_override = 'shadow' WHERE id = $1`, [driverId])
    vi.mocked(provider.detectFaces).mockResolvedValue({ faceCount: 1, quality: GOOD_Q })
    vi.mocked(provider.compareFaces).mockResolvedValue(80)
    vi.mocked(provider.detectText).mockResolvedValue([{ text: 'OD33AW5615', confidence: 99 }])

    const res = await submitDaily(accessToken)
    expect(res.status).toBe(201)
    const sel = await pool.query(`SELECT decision FROM driver_verifications WHERE driver_id = $1 AND kind = 'daily_selfie'`, [driverId])
    expect(sel.rows[0]!.decision).toBe('review')
    await pool.query(`UPDATE drivers SET verification_mode_override = NULL WHERE id = $1`, [driverId])
  })
})
