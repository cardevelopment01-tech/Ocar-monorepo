import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { hashPassword } from '@/lib/hash'
import {
  loginUser, setupOnlineDriver, driveRideToCompletion, driveRideToInProgress, cleanupRideAndDriverData, DEFAULT_BOOKING,
} from '../helpers/fixtures/rides.fixture'
import { loginAdmin } from '../helpers/fixtures/safety.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

// phone ranges: m07 uses 001-011, m08 uses 021-048, m09's ratings tests use
// 051-056, SOS tests use 057-060 — bump past the highest existing number
// when adding a new integration test file.
const PHONES = {
  ratingUser1: '+919700000051',
  ratingDriver1: '+919700000052',
  ratingUser2: '+919700000053',
  ratingDriver2: '+919700000054',
  ratingUser3: '+919700000055',
  ratingDriver3: '+919700000056',
  sosUser1: '+919700000057',
  sosDriver1: '+919700000058',
  sosUser2: '+919700000059',
  sosDriver2: '+919700000060',
} as const

const SOS_ADMIN_EMAIL = 'm09-safety-admin@ocar.app'
const SOS_ADMIN_PASSWORD = 'Admin@1234'

let categoryId: number

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1"
  )
  categoryId = Number(rows[0]!.id)

  // Seed one admin for TC-M09-005's acknowledge assertion — mirrors
  // m02.test.ts's proven beforeAll pattern. A different email than
  // admin@ocar.app avoids any collision if m02 and m09 ever run concurrently.
  const hash = await hashPassword(SOS_ADMIN_PASSWORD)
  await pool.query(`
    INSERT INTO admins (email, password_hash, role)
    VALUES ($1, $2, 'super_admin')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `, [SOS_ADMIN_EMAIL, hash])
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:user:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.query(`DELETE FROM admins WHERE email = $1`, [SOS_ADMIN_EMAIL])
  await pool.end()
  redis.disconnect()
})

async function bookAndCompleteRide(userPhone: string, driverPhone: string) {
  const driver = await setupOnlineDriver(app, pool, redis, driverPhone, { categorySlug: 'sedan' })
  const { accessToken: userToken, userId } = await loginUser(app, redis, userPhone)
  const bookRes = await request(app)
    .post('/api/v1/rides')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ categoryId, ...DEFAULT_BOOKING })
  if (bookRes.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(bookRes.body)}`)
  const rideId = bookRes.body.rideId as string
  await driveRideToCompletion(app, rideId, driver, userToken)
  return { rideId, userToken, userId, driver }
}

/**
 * Books a ride and drives it to `in_progress` via the shared
 * driveRideToInProgress fixture, stopping short of end-otp. SOS can only be
 * triggered on an active ride ('in_progress' | 'driver_arrived' | 'returning'
 * — see sos.service.ts), so the fixture's driveRideToCompletion (which also
 * completes the ride and takes the driver offline) can't be reused here.
 *
 * The "book" half stays local to this file for now — whether it belongs in
 * the shared fixture is a call better made once the disputes tests (which
 * also need an active ride) show what they need too.
 */
async function bookAndDriveToInProgress(userPhone: string, driverPhone: string) {
  const driver = await setupOnlineDriver(app, pool, redis, driverPhone, { categorySlug: 'sedan' })
  const { accessToken: userToken, userId } = await loginUser(app, redis, userPhone)
  const bookRes = await request(app)
    .post('/api/v1/rides')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ categoryId, ...DEFAULT_BOOKING })
  if (bookRes.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(bookRes.body)}`)
  const rideId = bookRes.body.rideId as string

  await driveRideToInProgress(app, rideId, driver, userToken)

  return { rideId, userToken, userId, driver }
}

describe('M09 — Safety', () => {
  describe('Ratings', () => {
    it('TC-M09-001: user submits rating after ride completion', async () => {
      const { rideId, userToken, driver } = await bookAndCompleteRide(PHONES.ratingUser1, PHONES.ratingDriver1)

      const { rows: tagRows } = await pool.query<{ id: string }>(
        "SELECT id FROM rating_tag_definitions WHERE applies_to IN ('driver','both') AND is_active = true LIMIT 1"
      )
      if (!tagRows[0]) throw new Error('No active driver-applicable rating tag seeded — check rating_tag_definitions')

      const res = await request(app)
        .post('/api/v1/safety/ratings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rideId, direction: 'user_to_driver', score: 5, comment: 'Great ride', tagIds: [tagRows[0].id] })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.score).toBe(5)

      const { rows } = await pool.query(
        'SELECT direction, score, to_driver_id FROM ratings WHERE ride_id = $1', [rideId]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.direction).toBe('user_to_driver')
      expect(String(rows[0]?.to_driver_id)).toBe(String(driver.driverId))

      const { rows: tagLinkRows } = await pool.query(
        'SELECT * FROM rating_tags WHERE rating_id = $1', [res.body.id]
      )
      expect(tagLinkRows).toHaveLength(1)
    })

    it('TC-M09-002: driver submits rating after ride completion', async () => {
      const { rideId, driver } = await bookAndCompleteRide(PHONES.ratingUser2, PHONES.ratingDriver2)

      const res = await request(app)
        .post('/api/v1/safety/ratings')
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ rideId, direction: 'driver_to_user', score: 4 })
      expect(res.status, JSON.stringify(res.body)).toBe(201)

      const { rows } = await pool.query(
        'SELECT direction, score FROM ratings WHERE ride_id = $1 AND direction = $2', [rideId, 'driver_to_user']
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.score).toBe(4)

      // Duplicate submission on the same ride+direction must 409, not double-insert.
      const dupRes = await request(app)
        .post('/api/v1/safety/ratings')
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ rideId, direction: 'driver_to_user', score: 3 })
      expect(dupRes.status, JSON.stringify(dupRes.body)).toBe(409)

      const { rows: afterDup } = await pool.query(
        'SELECT count(*)::int AS n FROM ratings WHERE ride_id = $1 AND direction = $2', [rideId, 'driver_to_user']
      )
      expect(afterDup[0]?.n).toBe(1)
    })

    it('TC-M09-003: rating average updates on driver profile', async () => {
      const { rideId, driver, userToken } = await bookAndCompleteRide(PHONES.ratingUser3, PHONES.ratingDriver3)

      const { rows: before } = await pool.query<{ rating_avg: string; total_ratings: number }>(
        'SELECT rating_avg, total_ratings FROM drivers WHERE id = $1', [driver.driverId]
      )

      const res = await request(app)
        .post('/api/v1/safety/ratings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rideId, direction: 'user_to_driver', score: 5 })
      expect(res.status, JSON.stringify(res.body)).toBe(201)

      const { rows: after } = await pool.query<{ rating_avg: string; total_ratings: number }>(
        'SELECT rating_avg, total_ratings FROM drivers WHERE id = $1', [driver.driverId]
      )
      expect(after[0]!.total_ratings).toBe((before[0]?.total_ratings ?? 0) + 1)
      // ratingDriver3 is fresh — this is its first-ever rating, so the average is deterministic.
      expect(Number(after[0]!.rating_avg)).toBe(5)
    })
  })

  describe('SOS', () => {
    it('TC-M09-004: SOS triggered creates sos_alert with high severity', async () => {
      const { rideId, userToken } = await bookAndDriveToInProgress(PHONES.sosUser1, PHONES.sosDriver1)

      const res = await request(app)
        .post('/api/v1/safety/sos')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rideId, severity: 'high' })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.severity).toBe('high')

      const { rows } = await pool.query(
        'SELECT severity, status FROM sos_alerts WHERE ride_id = $1', [rideId]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.severity).toBe('high')
      expect(rows[0]?.status).toBe('triggered')
    })

    it('TC-M09-005: SOS acknowledged updates status', async () => {
      const { rideId, userToken } = await bookAndDriveToInProgress(PHONES.sosUser2, PHONES.sosDriver2)

      const sosRes = await request(app)
        .post('/api/v1/safety/sos')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rideId })
      expect(sosRes.status, JSON.stringify(sosRes.body)).toBe(201)
      const alertId = sosRes.body.id as string

      const admin = await loginAdmin(app, SOS_ADMIN_EMAIL, SOS_ADMIN_PASSWORD)

      const ackRes = await request(app)
        .patch(`/api/v1/admin/safety/sos/${alertId}/acknowledge`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
      expect(ackRes.status, JSON.stringify(ackRes.body)).toBe(200)

      const { rows } = await pool.query(
        'SELECT status, acknowledged_by FROM sos_alerts WHERE id = $1', [alertId]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('acknowledged')
      expect(String(rows[0]?.acknowledged_by)).toBe(String(admin.adminId))
    })
  })

  describe('Disputes', () => {
    it.todo('TC-M09-006: dispute created with evidence uploads')
    it.todo('TC-M09-007: dispute resolution applies fare adjustment')
    it.todo('TC-M09-008: driver warning issued increments warning count')
    it.todo('TC-M09-009: dispute trip-replay returns actual GPS trail and planned route')
  })
})
