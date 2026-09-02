import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { processBroadcast } from '@/jobs/processors/broadcast.processor'
import {
  loginUser, loginDriver, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING,
} from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

const PHONES = {
  bookerUser: '+919700000001',
  cancelUser: '+919700000002',
  noDriversUser: '+919700000003',
  secondBookerUser: '+919700000004',
  onlineDriver1: '+919700000011',
} as const
const ALL_PHONES = Object.values(PHONES)

let categoryId: number

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1"
  )
  categoryId = Number(rows[0]!.id)
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...ALL_PHONES])
  for (const p of ALL_PHONES) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:user:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.end()
  redis.disconnect()
})

describe('M07 — Ride Lifecycle', () => {
  describe('Booking flow', () => {
    it('TC-M07-001: book ride creates ride in requested status', async () => {
      const { accessToken, userId } = await loginUser(app, redis, PHONES.bookerUser)

      const res = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, ...DEFAULT_BOOKING })

      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.status).toBe('requested')
      expect(typeof res.body.rideId).toBe('string')

      const { rows } = await pool.query<{ status: string; user_id: string }>(
        'SELECT status, user_id FROM rides WHERE id = $1', [res.body.rideId]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('requested')
      expect(rows[0]?.user_id).toBe(userId)
    })

    it('TC-M07-008: user cancels before acceptance sets cancelled', async () => {
      const { accessToken } = await loginUser(app, redis, PHONES.cancelUser)

      const bookRes = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, ...DEFAULT_BOOKING })
      expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
      const rideId = bookRes.body.rideId as string

      const cancelRes = await request(app)
        .post(`/api/v1/rides/${rideId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ reasonCode: 'changed_mind' })
      expect(cancelRes.status, JSON.stringify(cancelRes.body)).toBe(200)

      const { rows } = await pool.query<{ status: string }>(
        'SELECT status FROM rides WHERE id = $1', [rideId]
      )
      expect(rows[0]?.status).toBe('cancelled')
    })

    it('TC-M07-007a: booking with no nearby drivers still succeeds as requested (no_drivers transition covered in Task 3)', async () => {
      // No driver seeded online anywhere near this origin — pick a coordinate
      // far outside Bhubaneswar/Cuttack so round-3's 20km radius still finds nobody.
      const { accessToken } = await loginUser(app, redis, PHONES.noDriversUser)

      const bookRes = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, ...DEFAULT_BOOKING, originLat: 22.5726, originLng: 88.3639 }) // Kolkata — far from any seeded city
      expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
      const rideId = bookRes.body.rideId as string

      // The broadcast processor is a BullMQ job — see Task 3 for how it's invoked
      // directly in tests. This test only asserts the ride exists in `requested`
      // immediately after booking; the `no_drivers` transition itself is exercised
      // together with the processor call in Task 3 (TC-M07-002/007 share setup).
      const { rows } = await pool.query<{ status: string }>(
        'SELECT status FROM rides WHERE id = $1', [rideId]
      )
      expect(rows[0]?.status).toBe('requested')
    })

    it.todo('TC-M07-009: GPS track batch flush writes to gps_tracks table')
    it.todo('TC-M07-010: advance booking dispatches 15 min before pickup')
    it.todo('TC-M07-011: return cab route matching finds eligible drivers')
  })

  describe('Full ride progression', () => {
    it('TC-M07-002 + TC-M07-003 + TC-M07-004 + TC-M07-005 + TC-M07-006: book → broadcast → accept → arrive → start → complete', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.onlineDriver1)
      const { accessToken: userToken } = await loginUser(app, redis, PHONES.secondBookerUser)

      const bookRes = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING })
      expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
      const rideId = bookRes.body.rideId as string

      // TC-M07-002: run the broadcast processor directly against real DB/Redis —
      // it's a plain async function taking a BroadcastJobData object, no BullMQ
      // Job wrapper needed (confirmed against broadcast.processor.test.ts).
      await processBroadcast({
        rideId,
        categoryId: String(driver.categoryId),
        originLat: DEFAULT_BOOKING.originLat,
        originLng: DEFAULT_BOOKING.originLng,
        rideType: DEFAULT_BOOKING.rideType,
        isReturnCab: false,
        broadcastRound: 1,
      })
      const { rows: assignmentRows } = await pool.query<{ driver_id: string }>(
        'SELECT driver_id FROM ride_assignments WHERE ride_id = $1', [rideId]
      )
      expect(assignmentRows.some(r => r.driver_id === driver.driverId)).toBe(true)

      // TC-M07-003: driver accepts
      const acceptRes = await request(app)
        .post(`/api/v1/rides/${rideId}/accept`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
      expect(acceptRes.status, JSON.stringify(acceptRes.body)).toBe(200)
      let { rows } = await pool.query<{ status: string }>('SELECT status FROM rides WHERE id = $1', [rideId])
      expect(rows[0]?.status).toBe('accepted')

      // TC-M07-004: driver marks arrived — generates start OTP
      const arrivedRes = await request(app)
        .post(`/api/v1/rides/${rideId}/arrived`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
      expect(arrivedRes.status, JSON.stringify(arrivedRes.body)).toBe(200)
      ;({ rows } = await pool.query('SELECT status FROM rides WHERE id = $1', [rideId]))
      expect(rows[0]?.status).toBe('driver_arrived')

      // Read the start OTP back as the rider (route exposes startOtp to the ride owner)
      const rideAsUser = await request(app)
        .get(`/api/v1/rides/${rideId}`)
        .set('Authorization', `Bearer ${userToken}`)
      const startOtp = rideAsUser.body.startOtp as string
      expect(startOtp).toMatch(/^\d{4}$/)

      // TC-M07-005: verify start OTP
      const startOtpRes = await request(app)
        .post(`/api/v1/rides/${rideId}/start-otp`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ otp: startOtp })
      expect(startOtpRes.status, JSON.stringify(startOtpRes.body)).toBe(200)
      ;({ rows } = await pool.query('SELECT status FROM rides WHERE id = $1', [rideId]))
      expect(rows[0]?.status).toBe('in_progress')

      // TC-M07-006: verify end OTP
      const rideAsUser2 = await request(app)
        .get(`/api/v1/rides/${rideId}`)
        .set('Authorization', `Bearer ${userToken}`)
      const endOtp = rideAsUser2.body.endOtp as string
      expect(endOtp).toMatch(/^\d{4}$/)

      const endOtpRes = await request(app)
        .post(`/api/v1/rides/${rideId}/end-otp`)
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ otp: endOtp, actual_distance_km: DEFAULT_BOOKING.distanceKm, actual_duration_min: DEFAULT_BOOKING.durationMin })
      expect(endOtpRes.status, JSON.stringify(endOtpRes.body)).toBe(200)
      ;({ rows } = await pool.query('SELECT status FROM rides WHERE id = $1', [rideId]))
      expect(rows[0]?.status).toBe('completed')
    })
  })
})
