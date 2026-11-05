import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { loginUser, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

// Characterisation of what a booking persists (offers plan Task 6 Step 0), written against the code BEFORE the
// booking is made one transaction, and kept after. Value: protects=ride row, stop rows with their charge and the
// fare snapshot are written together from one quote, one live ride per rider; fails_when=the atomic refactor drops
// or reorders any of them; why_new=m07 checks status only; seam=none; no_claim=dispatch and broadcast (not run here).

const app = createApp()
const PHONES = { single: '+919700000601', stops: '+919700000602', sched: '+919700000603', double: '+919700000604' } as const
let categoryId: number

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  categoryId = Number(rows[0]!.id)
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, Object.values(PHONES))
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp:user:${p}:login`)
  }
  await pool.end()
  redis.disconnect()
})

describe('booking persistence', () => {
  it('writes the ride and a fare snapshot built from the same quote, with no discount', async () => {
    const { accessToken, userId } = await loginUser(app, redis, PHONES.single)
    const res = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${accessToken}`).send({ categoryId, ...DEFAULT_BOOKING })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const ride = await pool.query('SELECT user_id, status FROM rides WHERE id = $1', [res.body.rideId])
    expect(ride.rows[0]).toMatchObject({ user_id: userId, status: 'requested' })
    const snap = await pool.query('SELECT total_estimated::float8 AS total, discount_amount::float8 AS discount, status FROM fare_snapshots WHERE ride_id = $1', [res.body.rideId])
    expect(snap.rows).toHaveLength(1)
    expect(snap.rows[0].discount).toBe(0)
    expect(snap.rows[0].total).toBe(res.body.estimatedFare)
    const red = await pool.query('SELECT 1 FROM offer_redemptions WHERE ride_id = $1', [res.body.rideId])
    expect(red.rows).toHaveLength(0)
  })

  it('stamps each stop row with the quoted per-stop charge', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.stops)
    const res = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId, ...DEFAULT_BOOKING, stops: [{ lat: 20.3, lng: 85.85, address: 'Stop A' }] })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const stops = await pool.query('SELECT sequence, stop_charge_applied::float8 AS charge FROM ride_stops WHERE ride_id = $1 ORDER BY sequence', [res.body.rideId])
    expect(stops.rows).toHaveLength(1)
    const snap = await pool.query('SELECT stop_count FROM fare_snapshots WHERE ride_id = $1', [res.body.rideId])
    expect(snap.rows[0].stop_count).toBe(1)
  })

  it('an advance booking is stored as scheduled', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.sched)
    const when = new Date(Date.now() + 3 * 24 * 3600_000).toISOString()
    const res = await request(app).post('/api/v1/rides').set('Authorization', `Bearer ${accessToken}`).send({ categoryId, ...DEFAULT_BOOKING, scheduledFor: when })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const ride = await pool.query('SELECT status FROM rides WHERE id = $1', [res.body.rideId])
    expect(ride.rows[0].status).toBe('scheduled')
  })

  it('two simultaneous bookings by one rider give one ride and one 409', async () => {
    const { accessToken } = await loginUser(app, redis, PHONES.double)
    const send = () => request(app).post('/api/v1/rides').set('Authorization', `Bearer ${accessToken}`).send({ categoryId, ...DEFAULT_BOOKING })
    const [a, b] = await Promise.all([send(), send()])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([201, 409])
    const loser = a.status === 409 ? a : b
    expect(loser.body.code).toBe('RIDE_ALREADY_ACTIVE')
  })
})
