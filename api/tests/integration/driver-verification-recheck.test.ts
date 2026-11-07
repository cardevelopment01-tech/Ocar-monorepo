import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { invalidate } from '@/lib/cache/reference-cache'
import { configKey } from '@/constants/redis-keys'
import { loginAdmin, seedAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'
import { setupOnlineDriver, goOnline, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'
import { maybeOpenSpotCheck } from '@/modules/drivers/spot-check.engine'
import { runSpotCheckAfterCompletion } from '@/modules/rides/rides.service'

// Only AWS and S3 are mocked: the trigger, gate, scoring orchestration, admin API and every SQL statement are real.
const BUCKET = 'https://test-bucket.s3.ap-south-1.amazonaws.com/'
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
const PHONE = '+918200000204'
const USER_PHONE = '+918200000205'
const ADMIN = 'verif-recheck-admin@ocar.app'
const PASSWORD = 'Admin@1234'
const GOOD_Q = { brightness: 70, sharpness: 70, yaw: 0, pitch: 0 }

let token = '', driverId = '', vehicleId = '', categoryId = 0, userId = '', adminToken = ''

async function setConfig(key: string, value: string) {
  await pool.query(`UPDATE system_config SET value = $2 WHERE key = $1`, [key, value])
  await invalidate(configKey(key))
}

async function addRide(o: { type?: string; km?: number | null; mins?: number | null; status?: string } = {}): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO rides (user_id, category_id, ride_type, origin, status, driver_id, started_at, completed_at, actual_distance_km, actual_duration_min)
     VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(85.82, 20.29), 4326)::geography, $4, $5,
             clock_timestamp() - interval '30 minutes', clock_timestamp(), $6, $7) RETURNING id::text`,
    [userId, categoryId, o.type ?? 'one_way', o.status ?? 'completed', driverId, o.km ?? 10, o.mins ?? 20]
  )
  return r.rows[0]!.id
}

async function resetChallenges() {
  // Rides this file inserted (they have no children) would otherwise keep counting toward the next test's target.
  await pool.query(`DELETE FROM rides WHERE driver_id = $1 AND status = 'completed'`, [driverId])
  await pool.query(`UPDATE driver_verifications SET challenge_id = NULL WHERE driver_id = $1`, [driverId])
  await pool.query(`DELETE FROM verification_challenges WHERE driver_id = $1`, [driverId])
  await pool.query(`DELETE FROM driver_spot_check_state WHERE driver_id = $1`, [driverId])
}

async function openChallengeRow(reason = 'rides'): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO verification_challenges (driver_id, reason) VALUES ($1, $2) RETURNING id::text`, [driverId, reason])
  return r.rows[0]!.id
}

function scoreAs(similarity: number | null) {
  vi.mocked(provider.detectFaces).mockResolvedValue({ faceCount: 1, quality: GOOD_Q })
  vi.mocked(provider.compareFaces).mockResolvedValue(similarity)
  vi.mocked(provider.detectText).mockResolvedValue([{ text: 'OD33AW5615', confidence: 98 }])
}

async function submit() {
  const init = async (kind: 'selfie' | 'plate') =>
    (await request(app).post('/api/v1/drivers/daily-verification/upload-init').set('Authorization', `Bearer ${token}`)
      .send({ kind, content_type: 'image/jpeg', content_length: 1024 })).body.key as string
  return request(app).post('/api/v1/drivers/daily-verification').set('Authorization', `Bearer ${token}`)
    .send({ selfie_key: await init('selfie'), plate_key: await init('plate') })
}

const status = () => request(app).get('/api/v1/drivers/daily-verification/status').set('Authorization', `Bearer ${token}`)
const online = () => goOnline(app, token, vehicleId, categoryId)
const challengeStatus = async (id: string) =>
  (await pool.query<{ status: string }>(`SELECT status FROM verification_challenges WHERE id = $1`, [id])).rows[0]!.status

beforeAll(async () => {
  const d = await setupOnlineDriver(app, pool, redis, PHONE, { plate: 'OD33AW5615' })
  token = d.accessToken; driverId = d.driverId; vehicleId = d.vehicleId; categoryId = d.categoryId
  await pool.query(`UPDATE drivers SET reference_selfie_url = $2 WHERE id = $1`, [driverId, `${BUCKET}drivers/${driverId}/reference.jpg`])
  const u = await pool.query<{ id: string }>(`INSERT INTO users (phone) VALUES ($1) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id::text`, [USER_PHONE])
  userId = u.rows[0]!.id
  await seedAdmin(pool, ADMIN, 'ops_admin', PASSWORD)
  adminToken = (await loginAdmin(app, ADMIN, PASSWORD)).accessToken
  await setConfig('spot_check_enabled', 'true')
  await setConfig('verification_mode', 'flag')
})

afterAll(async () => {
  await setConfig('verification_mode', 'off')
  await setConfig('spot_check_enabled', 'false')
  await resetChallenges()
  await pool.query(`DELETE FROM driver_verification_attempts WHERE driver_id = $1`, [driverId])
  await pool.query(`DELETE FROM notification_logs WHERE owner_type = 'driver' AND owner_id = $1`, [driverId])
  await cleanupRideAndDriverData(pool, [PHONE, USER_PHONE])
  await cleanupAdmins(pool, [ADMIN])
  await redis.del(`otp_rate:${PHONE}:login`)
  await pool.end()
  redis.disconnect()
})

describe('re-check trigger', () => {
  it('does nothing while the feature is off', async () => {
    await resetChallenges()
    await setConfig('spot_check_enabled', 'false')
    await pool.query(`INSERT INTO driver_spot_check_state (driver_id, rides_target) VALUES ($1, 1)`, [driverId])
    expect(await maybeOpenSpotCheck(BigInt(driverId), BigInt(await addRide()))).toBeNull()
    await setConfig('spot_check_enabled', 'true')
    await setConfig('verification_mode', 'off')
    expect(await maybeOpenSpotCheck(BigInt(driverId), BigInt(await addRide()))).toBeNull()
    await setConfig('verification_mode', 'flag')
  })

  it('opens after the drawn number of rides, once, and redraws the target', async () => {
    await resetChallenges()
    await pool.query(`INSERT INTO driver_spot_check_state (driver_id, rides_target) VALUES ($1, 3)`, [driverId])
    // setup counted rides from the last verified check; these are the 1st, 2nd and 3rd since then
    const r1 = await addRide(), r2 = await addRide()
    expect(await maybeOpenSpotCheck(BigInt(driverId), BigInt(r1))).toBeNull()
    expect(await maybeOpenSpotCheck(BigInt(driverId), BigInt(r2))).toBeNull()
    const r3 = await addRide()
    const id = await maybeOpenSpotCheck(BigInt(driverId), BigInt(r3))
    expect(id).not.toBeNull()
    const ch = (await pool.query(`SELECT reason, status, trigger_data FROM verification_challenges WHERE id = $1`, [id])).rows[0]
    expect(ch).toMatchObject({ reason: 'rides', status: 'open' })
    // a second completion cannot open another while this one is open
    expect(await maybeOpenSpotCheck(BigInt(driverId), BigInt(await addRide()))).toBeNull()
    const target = (await pool.query(`SELECT rides_target FROM driver_spot_check_state WHERE driver_id = $1`, [driverId])).rows[0].rides_target
    expect(target).toBeGreaterThanOrEqual(2)
    expect(target).toBeLessThanOrEqual(3)
  })

  it('a long one-way ride triggers at once; a short one does not; rentals are not counted as long', async () => {
    await resetChallenges()
    await pool.query(`INSERT INTO driver_spot_check_state (driver_id, rides_target) VALUES ($1, 20)`, [driverId])
    expect(await maybeOpenSpotCheck(BigInt(driverId), BigInt(await addRide({ km: 59, mins: 89 })))).toBeNull()
    expect(await maybeOpenSpotCheck(BigInt(driverId), BigInt(await addRide({ type: 'rental', km: 300, mins: 600 })))).toBeNull()
    const id = await maybeOpenSpotCheck(BigInt(driverId), BigInt(await addRide({ type: 'round_trip', km: 10, mins: 95 })))
    expect(id).not.toBeNull()
    expect((await pool.query(`SELECT reason FROM verification_challenges WHERE id = $1`, [id])).rows[0].reason).toBe('long_ride')
  })

  it('never opens while another ride is already accepted or under way', async () => {
    await resetChallenges()
    await pool.query(`INSERT INTO driver_spot_check_state (driver_id, rides_target) VALUES ($1, 1)`, [driverId])
    const next = await addRide({ status: 'accepted' })
    expect(await maybeOpenSpotCheck(BigInt(driverId), BigInt(await addRide({ km: 200 })))).toBeNull()
    await pool.query(`DELETE FROM rides WHERE id = $1`, [next])
    expect(await maybeOpenSpotCheck(BigInt(driverId), BigInt(await addRide({ km: 200 })))).not.toBeNull()
  })
})

describe('forced offline, gate and re-verify', () => {
  let challengeId = ''

  it('takes the driver offline with a calm notification, and the status asks for a re-check', async () => {
    await resetChallenges()
    await pool.query(`INSERT INTO driver_spot_check_state (driver_id, rides_target) VALUES ($1, 1)`, [driverId])
    await runSpotCheckAfterCompletion(BigInt(driverId), BigInt(await addRide()))
    const session = (await pool.query(`SELECT status, offline_reason FROM driver_sessions WHERE driver_id = $1 ORDER BY id DESC LIMIT 1`, [driverId])).rows[0]
    expect(session).toMatchObject({ status: 'offline', offline_reason: 'spot_check' })
    const notif = (await pool.query(`SELECT title, body FROM notification_logs WHERE owner_type = 'driver' AND owner_id = $1 AND type = 'verification_required'`, [driverId])).rows
    expect(notif).toHaveLength(1)
    expect(notif[0].title).toBe('Quick safety check')
    expect(JSON.stringify(notif[0])).not.toMatch(/mismatch|fraud|share|suspicious/i)
    challengeId = (await pool.query(`SELECT id::text FROM verification_challenges WHERE driver_id = $1 AND status = 'open'`, [driverId])).rows[0].id

    const st = await status()
    expect(st.body).toMatchObject({ complete: false, reverify: true, selfieDone: true, plateDone: true })
  })

  it('going online is refused with 428 SPOT_CHECK_REQUIRED until the re-check is done', async () => {
    const res = await online()
    expect(res.status).toBe(428)
    expect(res.body.code).toBe('SPOT_CHECK_REQUIRED')
  })

  it('a good selfie + plate closes it with spot rows, and the driver can go online again', async () => {
    scoreAs(96)
    const res = await submit()
    expect(res.status).toBe(201)
    expect(await challengeStatus(challengeId)).toBe('satisfied')
    const rows = (await pool.query(`SELECT kind::text, status, challenge_id::text FROM driver_verifications WHERE challenge_id = $1 ORDER BY kind::text`, [challengeId])).rows
    expect(rows).toEqual([
      { kind: 'spot_plate', status: 'passed', challenge_id: challengeId },
      { kind: 'spot_selfie', status: 'passed', challenge_id: challengeId },
    ])
    expect((await status()).body.reverify).toBeUndefined()
    expect((await online()).status).toBe(200)
  })

  it('an unusable photo on a re-check is a retake and keeps it open', async () => {
    await resetChallenges()
    challengeId = await openChallengeRow()
    vi.mocked(provider.detectFaces).mockResolvedValue({ faceCount: 0, quality: null })
    vi.mocked(provider.detectText).mockResolvedValue([{ text: 'OD33AW5615', confidence: 98 }])
    const res = await submit()
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('VERIFICATION_RETAKE')
    expect(res.body.details).toEqual({ selfie: 'NO_FACE', plate: null })
    expect(await challengeStatus(challengeId)).toBe('open')
    const attempts = (await pool.query(`SELECT kind::text FROM driver_verification_attempts WHERE driver_id = $1 AND decision = 'retake'`, [driverId])).rows
    expect(attempts.every((a) => a.kind === 'spot_selfie')).toBe(true)
  })

  it('switching verification off releases a driver who still had an open re-check', async () => {
    await setConfig('verification_mode', 'off')
    expect((await status()).body.reverify).toBeUndefined()
    expect((await online()).status).toBe(200)
    await setConfig('verification_mode', 'flag')
  })
})

describe('block mode and admin clearing', () => {
  let challengeId = ''

  it('a selfie mismatch keeps it open and counts down the tries; then an admin must decide', async () => {
    await setConfig('verification_mode', 'block')
    await pool.query(`DELETE FROM driver_verification_attempts WHERE driver_id = $1`, [driverId])
    await resetChallenges()
    challengeId = await openChallengeRow()
    scoreAs(null)

    const a1 = await submit()
    expect(a1.status).toBe(422)
    expect(a1.body.code).toBe('VERIFICATION_FAILED')
    expect(a1.body.details).toEqual({ attemptsLeft: 2 })
    expect(JSON.stringify(a1.body)).not.toMatch(/similarity|score|mismatch/i)
    expect((await submit()).body.details).toEqual({ attemptsLeft: 1 })
    expect((await submit()).body.details).toEqual({ attemptsLeft: 0 })
    expect(await challengeStatus(challengeId)).toBe('open')

    vi.mocked(provider.detectFaces).mockClear()
    const blocked = await submit()
    expect(blocked.status).toBe(422)
    expect(blocked.body.code).toBe('VERIFICATION_UNDER_REVIEW')
    expect(provider.detectFaces).not.toHaveBeenCalled() // out of tries: no Rekognition spend
    expect((await online()).status).toBe(428)
  })

  it('an admin sees the failed re-check first, and "looks fine" closes the challenge so the driver can go online', async () => {
    const list = await request(app).get('/api/v1/admin/verifications').set('Authorization', `Bearer ${adminToken}`)
    const mine = list.body.items.filter((i: { driverId: string; kind: string }) => i.driverId === driverId && i.kind === 'spot_selfie')
    expect(mine.length).toBe(3)
    expect(mine[0]).toMatchObject({ decision: 'fail', priority: 2 })
    const res = await request(app).post(`/api/v1/admin/verifications/${mine[0].id}/resolve`)
      .set('Authorization', `Bearer ${adminToken}`).send({ outcome: 'ok', note: 'bad light, same person' })
    expect(res.status).toBe(200)
    expect(await challengeStatus(challengeId)).toBe('satisfied')
    expect((await online()).status).toBe(200)
  })

  it('an admin can waive an open re-check (broken camera), once', async () => {
    await resetChallenges()
    challengeId = await openChallengeRow()
    const open = await request(app).get('/api/v1/admin/verifications/challenges').set('Authorization', `Bearer ${adminToken}`)
    expect(open.body.items.some((c: { id: string; driverId: string }) => c.id === challengeId && c.driverId === driverId)).toBe(true)
    const waive = await request(app).post(`/api/v1/admin/verifications/challenges/${challengeId}/waive`).set('Authorization', `Bearer ${adminToken}`)
    expect(waive.status).toBe(200)
    expect(await challengeStatus(challengeId)).toBe('waived')
    expect((await request(app).post(`/api/v1/admin/verifications/challenges/${challengeId}/waive`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(409)
    expect((await online()).status).toBe(200)
    await setConfig('verification_mode', 'flag')
  })
})

describe('consent', () => {
  it('flag mode asks once; agreeing is recorded with the app version and never moves', async () => {
    await pool.query(`UPDATE drivers SET verification_consent_at = NULL, verification_consent_app_version = NULL WHERE id = $1`, [driverId])
    expect((await status()).body.consentRequired).toBe(true)
    const ok = await request(app).post('/api/v1/drivers/daily-verification/consent').set('Authorization', `Bearer ${token}`).send({ app_version: '1.4.0' })
    expect(ok.status).toBe(200)
    const first = (await pool.query(`SELECT verification_consent_at, verification_consent_app_version FROM drivers WHERE id = $1`, [driverId])).rows[0]
    expect(first.verification_consent_app_version).toBe('1.4.0')
    expect((await status()).body.consentRequired).toBeUndefined()
    await request(app).post('/api/v1/drivers/daily-verification/consent').set('Authorization', `Bearer ${token}`).send({ app_version: '9.9.9' })
    const again = (await pool.query(`SELECT verification_consent_at, verification_consent_app_version FROM drivers WHERE id = $1`, [driverId])).rows[0]
    expect(again).toEqual(first)
  })

  it('shadow mode never asks (it is invisible to drivers)', async () => {
    await pool.query(`UPDATE drivers SET verification_consent_at = NULL WHERE id = $1`, [driverId])
    await setConfig('verification_mode', 'shadow')
    expect((await status()).body.consentRequired).toBeUndefined()
    await setConfig('verification_mode', 'flag')
  })
})
