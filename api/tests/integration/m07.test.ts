import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
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

    it.todo('TC-M07-002: broadcast finds nearby active drivers')
    it.todo('TC-M07-003: driver accepts ride changes status to accepted')
    it.todo('TC-M07-004: driver arrived changes status to driver_arrived')
    it.todo('TC-M07-005: trip start OTP verified changes status to in_progress')
    it.todo('TC-M07-006: trip end OTP verified changes status to completed')
    it.todo('TC-M07-009: GPS track batch flush writes to gps_tracks table')
    it.todo('TC-M07-010: advance booking dispatches 15 min before pickup')
    it.todo('TC-M07-011: return cab route matching finds eligible drivers')
  })
})
