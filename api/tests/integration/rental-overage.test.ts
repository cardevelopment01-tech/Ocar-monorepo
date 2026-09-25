import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import {
  loginUser, setupOnlineDriver, driveRideToInProgress, cleanupRideAndDriverData, DEFAULT_BOOKING,
} from '../helpers/fixtures/rides.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

const PHONES = {
  driver: '+919800000011',
  within: '+919800000001',
  overrun: '+919800000002',
  noGps: '+919800000003',
  adminEdit: '+919800000004',
} as const
const ALL_PHONES = Object.values(PHONES)

interface Pkg { id: number; duration_minutes: number; km_limit: number; package_fare: number; extra_per_km: number; extra_per_min: number }
let pkg: Pkg
let driver: Awaited<ReturnType<typeof setupOnlineDriver>>

const GRACE_KM = 2
const GRACE_MIN = 5
const KM_PER_DEG_LNG = 104.4 // at ~20.3°N

beforeAll(async () => {
  const { rows } = await pool.query(
    `SELECT rp.id, rp.duration_minutes, rp.km_limit::float8 AS km_limit, rp.package_fare::float8 AS package_fare,
            rp.extra_per_km::float8 AS extra_per_km, rp.extra_per_min::float8 AS extra_per_min
     FROM rental_packages rp JOIN vehicle_categories vc ON vc.id = rp.category_id
     WHERE vc.slug = 'sedan' AND rp.is_active AND rp.duration_minutes = 240
     ORDER BY rp.city_id NULLS LAST LIMIT 1`
  )
  pkg = rows[0] as Pkg
  driver = await setupOnlineDriver(app, pool, redis, PHONES.driver, { categorySlug: 'sedan' })
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

/**
 * Real rental, real DB/Redis: book -> dispatch -> accept -> arrive -> start OTP, then
 * backdate started_at to simulate elapsed time, write GPS breadcrumbs covering ~gpsKm,
 * and end via the end-OTP endpoint. Returns the settled fare snapshot.
 */
async function runRental(opts: {
  phone: string
  elapsedMin: number
  gpsKm: number | null
  afterBooking?: () => Promise<void>
}) {
  const { accessToken: userToken } = await loginUser(app, redis, opts.phone)
  const bookRes = await request(app)
    .post('/api/v1/rides')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING, rideType: 'rental', rentalPackageId: pkg.id })
  expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
  const rideId = bookRes.body.rideId as string

  await opts.afterBooking?.()

  await driveRideToInProgress(app, rideId, driver, userToken)

  await pool.query(
    `UPDATE rides SET started_at = now() - ($2::int * interval '1 minute') WHERE id = $1`,
    [rideId, opts.elapsedMin]
  )
  if (opts.gpsKm !== null) {
    const points = 30
    const lngStep = opts.gpsKm / points / KM_PER_DEG_LNG
    await pool.query(
      `INSERT INTO gps_tracks (ride_id, driver_id, session_id, location, recorded_at)
       SELECT $1, $2, $3,
              ST_SetSRID(ST_MakePoint($4::float8 + g * $5::float8, 20.29::float8), 4326)::geography,
              (SELECT started_at FROM rides WHERE id = $1) + g * interval '1 minute'
       FROM generate_series(0, $6::int) g`,
      [rideId, driver.driverId, driver.sessionId, 85.82, lngStep, points]
    )
  }

  const rideAsUser = await request(app).get(`/api/v1/rides/${rideId}`).set('Authorization', `Bearer ${userToken}`)
  const endOtpRes = await request(app)
    .post(`/api/v1/rides/${rideId}/end-otp`)
    .set('Authorization', `Bearer ${driver.accessToken}`)
    .send({ otp: rideAsUser.body.endOtp, actual_distance_km: 5, actual_duration_min: 10 })
  expect(endOtpRes.status, JSON.stringify(endOtpRes.body)).toBe(200)

  const { rows } = await pool.query(
    `SELECT fs.status, fs.total_estimated::float8 AS total_estimated, fs.total_final::float8 AS total_final,
            fs.actual_km::float8 AS actual_km, fs.actual_min::float8 AS actual_min,
            fs.overage_km::float8 AS overage_km, fs.overage_min::float8 AS overage_min,
            fs.overage_fare::float8 AS overage_fare, fs.surge_multiplier::float8 AS surge,
            fs.rental_km_limit::float8 AS snap_km_limit, fs.rental_extra_per_km::float8 AS snap_extra_km,
            fs.rental_extra_per_min::float8 AS snap_extra_min,
            r.review_reason
     FROM fare_snapshots fs JOIN rides r ON r.id = fs.ride_id WHERE fs.ride_id = $1`,
    [rideId]
  )
  return rows[0] as Record<string, number | string | null>
}

describe('Rental overage settlement (end to end)', () => {
  it('within package + grace: package fare only, nothing flagged', async () => {
    const s = await runRental({ phone: PHONES.within, elapsedMin: 100, gpsKm: 20 })
    expect(s['status']).toBe('final')
    expect(s['overage_km']).toBe(0)
    expect(s['overage_min']).toBe(0)
    expect(s['overage_fare']).toBe(0)
    expect(s['total_final']).toBe(s['total_estimated'])
    expect(s['snap_km_limit']).toBe(pkg.km_limit) // package terms were pinned at booking
    expect(s['review_reason']).toBeNull()
  })

  it('overruns km and time: bills only beyond limit + grace at the package extra rates, flags for verify', async () => {
    const s = await runRental({ phone: PHONES.overrun, elapsedMin: pkg.duration_minutes + 30, gpsKm: pkg.km_limit + 12 })
    const gpsKm = s['actual_km'] as number
    expect(gpsKm).toBeGreaterThan(pkg.km_limit + 8)
    const expKm = gpsKm - pkg.km_limit - GRACE_KM
    const expMin = 30 - GRACE_MIN
    expect(s['overage_km'] as number).toBeCloseTo(expKm, 1)
    expect(s['overage_min'] as number).toBeCloseTo(expMin, 0)
    const expOverage = expKm * pkg.extra_per_km + expMin * pkg.extra_per_min
    expect(s['overage_fare'] as number).toBeCloseTo(expOverage * (s['surge'] as number), -0.5) // within ~1 rupee
    expect(s['total_final'] as number).toBeCloseTo(((pkg.package_fare + expOverage) * (s['surge'] as number)), -0.5)
    expect(s['total_final'] as number).toBeGreaterThan(s['total_estimated'] as number)
    expect(String(s['review_reason'])).toMatch(/billed from GPS/)
  })

  it('no GPS on a long trip: time overage still billed, km skipped, actual_km NULL, flagged', async () => {
    const s = await runRental({ phone: PHONES.noGps, elapsedMin: pkg.duration_minutes + 30, gpsKm: null })
    expect(s['actual_km']).toBeNull()
    expect(s['overage_km']).toBe(0)
    expect(s['overage_min'] as number).toBeCloseTo(30 - GRACE_MIN, 0)
    expect(s['total_final'] as number).toBeGreaterThan(s['total_estimated'] as number)
    expect(String(s['review_reason'])).toMatch(/not billed/)
  })

  it('admin raises the package rates after booking: rider is still charged the booked rates', async () => {
    const s = await runRental({
      phone: PHONES.adminEdit,
      elapsedMin: pkg.duration_minutes + 65, // 60 min over limit + grace(5) => 60 billable min
      gpsKm: null,
      afterBooking: async () => {
        await pool.query('UPDATE rental_packages SET extra_per_min = extra_per_min * 10 WHERE id = $1', [pkg.id])
      },
    })
    // restore before asserting so a failure can't leave the seed data altered
    await pool.query('UPDATE rental_packages SET extra_per_min = $2 WHERE id = $1', [pkg.id, pkg.extra_per_min])
    expect(s['snap_extra_min']).toBe(pkg.extra_per_min)
    const expected = (pkg.package_fare + 60 * pkg.extra_per_min) * (s['surge'] as number)
    expect(s['total_final'] as number).toBeCloseTo(expected, -0.5)
  })
})
