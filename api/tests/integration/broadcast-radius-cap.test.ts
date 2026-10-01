import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { processBroadcast } from '@/jobs/processors/broadcast.processor'
import {
  loginUser, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING,
} from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

// Real PostGIS distances: drivers are moved due north of the pickup by N km.
const KM_LAT = 1 / 111.19
const DISTANCES_KM = { sedan: [1.5, 3, 3.9, 9, 12], auto: [1.8, 2.2] } as const

const PHONES = {
  user: '+919750000001',
  sedan: DISTANCES_KM.sedan.map((_, i) => `+91975000010${i}`),
  auto: DISTANCES_KM.auto.map((_, i) => `+91975000020${i}`),
}
const ALL_PHONES = [PHONES.user, ...PHONES.sedan, ...PHONES.auto]

let rideId: string
let sedanCategoryId: number
let autoCategoryId: number
const sedanDrivers = new Map<number, string>() // km -> driverId
const autoDrivers = new Map<number, string>()

async function placeDriver(driverId: string, km: number) {
  await pool.query(
    `UPDATE driver_location_snapshots
        SET location = ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography
      WHERE driver_id = $1`,
    [driverId, DEFAULT_BOOKING.originLat + km * KM_LAT, DEFAULT_BOOKING.originLng]
  )
}

async function broadcastAndGetOffered(opts: {
  categoryId: number; rideType: string; tripHours?: number; round?: number
}): Promise<Set<string>> {
  await pool.query('DELETE FROM ride_assignments WHERE ride_id = $1', [rideId])
  await processBroadcast({
    rideId,
    categoryId: String(opts.categoryId),
    originLat: DEFAULT_BOOKING.originLat,
    originLng: DEFAULT_BOOKING.originLng,
    rideType: opts.rideType,
    isReturnCab: false,
    broadcastRound: opts.round ?? 1, // round 1 = the base radius per ride type
    ...(opts.tripHours !== undefined ? { tripHours: opts.tripHours } : {}),
  })
  const { rows } = await pool.query<{ driver_id: string }>(
    'SELECT driver_id::text FROM ride_assignments WHERE ride_id = $1', [rideId]
  )
  return new Set(rows.map(r => r.driver_id))
}

beforeAll(async () => {
  const cats = await pool.query<{ slug: string; id: string }>(
    "SELECT slug, id FROM vehicle_categories WHERE slug IN ('sedan','auto_rickshaw')"
  )
  sedanCategoryId = Number(cats.rows.find(c => c.slug === 'sedan')!.id)
  autoCategoryId = Number(cats.rows.find(c => c.slug === 'auto_rickshaw')!.id)

  for (const [i, km] of DISTANCES_KM.sedan.entries()) {
    const d = await setupOnlineDriver(app, pool, redis, PHONES.sedan[i]!, { categorySlug: 'sedan' })
    await placeDriver(d.driverId, km)
    sedanDrivers.set(km, d.driverId)
  }
  for (const [i, km] of DISTANCES_KM.auto.entries()) {
    const d = await setupOnlineDriver(app, pool, redis, PHONES.auto[i]!, { categorySlug: 'auto_rickshaw' })
    await placeDriver(d.driverId, km)
    autoDrivers.set(km, d.driverId)
  }

  const { accessToken } = await loginUser(app, redis, PHONES.user)
  const res = await request(app)
    .post('/api/v1/rides')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ categoryId: sedanCategoryId, ...DEFAULT_BOOKING })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  rideId = res.body.rideId as string
}, 120_000)

afterAll(async () => {
  await cleanupRideAndDriverData(pool, ALL_PHONES)
  for (const p of ALL_PHONES) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:user:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.end()
  redis.disconnect()
})

const ids = (m: Map<number, string>, kms: number[]) => kms.map(k => m.get(k)!)

describe('Broadcast pickup-distance cap (real PostGIS)', () => {
  it('outstation (one_way): offers drivers within 10 km, not the one at 12 km', async () => {
    const offered = await broadcastAndGetOffered({ categoryId: sedanCategoryId, rideType: 'one_way' })
    for (const id of ids(sedanDrivers, [1.5, 3, 3.9, 9])) expect(offered.has(id)).toBe(true)
    expect(offered.has(sedanDrivers.get(12)!)).toBe(false)
  })

  it('outstation (round_trip): same 10 km cap', async () => {
    const offered = await broadcastAndGetOffered({ categoryId: sedanCategoryId, rideType: 'round_trip' })
    expect(offered.has(sedanDrivers.get(9)!)).toBe(true)
    expect(offered.has(sedanDrivers.get(12)!)).toBe(false)
  })

  it('city cab (rental, 2h): only the 1.5 km driver, cap 2.5 km', async () => {
    const offered = await broadcastAndGetOffered({ categoryId: sedanCategoryId, rideType: 'rental', tripHours: 2 })
    expect(offered.has(sedanDrivers.get(1.5)!)).toBe(true)
    for (const id of ids(sedanDrivers, [3, 3.9, 9, 12])) expect(offered.has(id)).toBe(false)
  })

  it('city rental above 2h: cap 4 km admits 3.9 km, not 9 km', async () => {
    const offered = await broadcastAndGetOffered({ categoryId: sedanCategoryId, rideType: 'rental', tripHours: 4 })
    for (const id of ids(sedanDrivers, [1.5, 3, 3.9])) expect(offered.has(id)).toBe(true)
    expect(offered.has(sedanDrivers.get(9)!)).toBe(false)
  })

  it('city auto (rental, 2h): cap 2 km admits 1.8 km, not 2.2 km', async () => {
    const offered = await broadcastAndGetOffered({ categoryId: autoCategoryId, rideType: 'rental', tripHours: 2 })
    expect(offered.has(autoDrivers.get(1.8)!)).toBe(true)
    expect(offered.has(autoDrivers.get(2.2)!)).toBe(false)
  })

  it('radius grows 1 km per round: rental 2h is 2.5 km in round 1, 4.5 km in round 3', async () => {
    const r1 = await broadcastAndGetOffered({ categoryId: sedanCategoryId, rideType: 'rental', tripHours: 2, round: 1 })
    expect(r1.has(sedanDrivers.get(3)!)).toBe(false)
    const r3 = await broadcastAndGetOffered({ categoryId: sedanCategoryId, rideType: 'rental', tripHours: 2, round: 3 })
    for (const id of ids(sedanDrivers, [3, 3.9])) expect(r3.has(id)).toBe(true)
    expect(r3.has(sedanDrivers.get(9)!)).toBe(false)
  })
})
