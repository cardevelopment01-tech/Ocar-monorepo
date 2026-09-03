import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { loginUser, setupOnlineDriver, driveRideToCompletion, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

// setupOnlineDriver drives daily-verification, which needs @/lib/storage mocked
// (same pattern as m07/m08/m09/m04/m05.test.ts — real S3 creds aren't configured
// for the test env).
vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

const PHONES = { analyticsUser: '+919700000401', analyticsDriver: '+919700000402' } as const
const ADMIN_EMAIL = 'm12-analytics-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'

let categoryId: number

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  categoryId = Number(rows[0]!.id)
  await seedAdmin(pool, ADMIN_EMAIL, 'super_admin', ADMIN_PASSWORD)
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp_rate:driver:${p}:login`)
  }
  await cleanupAdmins(pool, [ADMIN_EMAIL])
  await pool.end()
  redis.disconnect()
})

describe('M12 — Analytics', () => {
  it('TC-M12-001/002/003/005: driver availability, ride funnel, revenue, and city breakdown reflect real activity', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.analyticsDriver, { categorySlug: 'sedan' })
    const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)

    // TC-M12-003: driver availability is a live (non-period-scoped) snapshot —
    // must be asserted before driveRideToCompletion, which takes the driver
    // offline as its last step.
    const availabilityRes = await request(app)
      .get('/api/v1/admin/analytics/drivers/availability')
      .set('Authorization', `Bearer ${admin.accessToken}`)
    expect(availabilityRes.status, JSON.stringify(availabilityRes.body)).toBe(200)
    expect(Array.isArray(availabilityRes.body)).toBe(true)
    const totalOnline = availabilityRes.body.reduce(
      (sum: number, row: { online_now: number }) => sum + Number(row.online_now), 0
    )
    expect(totalOnline).toBeGreaterThanOrEqual(1)

    // TC-M12-001/002/005: complete a ride+payment, then confirm it's reflected
    // in the funnel/revenue/city-breakdown fields of the summary endpoint.
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.analyticsUser)
    const bookRes = await request(app)
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ categoryId, ...DEFAULT_BOOKING })
    expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
    const rideId = bookRes.body.rideId as string
    await driveRideToCompletion(app, rideId, driver, userToken)

    // With cash_collection_enabled=true (seeded default), settleRideCompletionPayment
    // only signals the driver app to show the cash-collection screen — it does NOT
    // create a payments row on its own. Settlement (and the revenue this test asserts
    // on via daily_revenue/city_breakdown) requires the explicit collect-cash call.
    const { rows: fareRows } = await pool.query<{ amount: string }>(
      `SELECT COALESCE(total_final, total_estimated) AS amount FROM fare_snapshots WHERE ride_id = $1`,
      [rideId]
    )
    const fare = parseFloat(fareRows[0]!.amount)
    const collectRes = await request(app)
      .post(`/api/v1/rides/${rideId}/collect-cash`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ collectedAmount: fare })
    expect(collectRes.status, JSON.stringify(collectRes.body)).toBe(200)

    const summaryRes = await request(app)
      .get('/api/v1/admin/analytics/summary?period=7d')
      .set('Authorization', `Bearer ${admin.accessToken}`)
    expect(summaryRes.status, JSON.stringify(summaryRes.body)).toBe(200)

    // TC-M12-001: ride funnel
    expect(summaryRes.body.funnel.completed).toBeGreaterThanOrEqual(1)
    expect(summaryRes.body.funnel.requested).toBeGreaterThanOrEqual(summaryRes.body.funnel.completed)

    // TC-M12-002: revenue — cash-channel ride settles a `payments` row with
    // status 'completed', which daily_revenue's LEFT JOIN sums.
    const totalRevenue = summaryRes.body.daily_revenue.reduce(
      (sum: number, row: { revenue: number }) => sum + Number(row.revenue), 0
    )
    expect(totalRevenue).toBeGreaterThan(0)

    // TC-M12-005: city breakdown — DEFAULT_BOOKING's origin coords resolve to
    // Bhubaneswar (seeded city).
    const bhubaneswarRow = summaryRes.body.city_breakdown.find(
      (c: { city_name: string }) => c.city_name === 'Bhubaneswar'
    )
    expect(bhubaneswarRow).toBeTruthy()
    expect(Number(bhubaneswarRow.ride_count)).toBeGreaterThanOrEqual(1)
    expect(Number(bhubaneswarRow.revenue)).toBeGreaterThan(0)
  })

  it.todo('TC-M12-004: analytics endpoint returns paginated data — no pagination exists on any analytics endpoint (summary, eta-accuracy, drivers/onboarding, drivers/availability all return full unpaginated arrays/objects)')
})
