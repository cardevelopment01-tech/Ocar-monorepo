import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { hashPassword } from '@/lib/hash'
import { setupOnlineDriver, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'
import { loginAdmin } from '../helpers/fixtures/safety.fixture'

// setupOnlineDriver drives completeDailyVerification, which needs S3 mocked
// (see rides.fixture.ts's comment) — same pattern as m07/m08/m09.test.ts.
vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

const PHONES = {
  blacklistDriver: '+919700000101',
} as const

const ADMIN_EMAIL = 'm04-vehicles-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'

beforeAll(async () => {
  const hash = await hashPassword(ADMIN_PASSWORD)
  await pool.query(`
    INSERT INTO admins (email, password_hash, role)
    VALUES ($1, $2, 'super_admin')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `, [ADMIN_EMAIL, hash])
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.query(`DELETE FROM admins WHERE email = $1`, [ADMIN_EMAIL])
  await pool.end()
  redis.disconnect()
})

describe('M04 — Vehicle Management', () => {
  describe('Public vehicle lookups', () => {
    it('TC-M04-001: category/brand/model lookups return only active seeded rows', async () => {
      const catRes = await request(app).get('/api/v1/vehicles/categories')
      expect(catRes.status, JSON.stringify(catRes.body)).toBe(200)
      expect(Array.isArray(catRes.body)).toBe(true)
      expect(catRes.body.length).toBeGreaterThan(0)
      expect(catRes.body.every((c: { is_active: boolean }) => c.is_active)).toBe(true)
      const sedan = catRes.body.find((c: { slug: string }) => c.slug === 'sedan')
      expect(sedan).toBeTruthy()

      const brandRes = await request(app).get('/api/v1/vehicles/brands')
      expect(brandRes.status, JSON.stringify(brandRes.body)).toBe(200)
      expect(brandRes.body.length).toBeGreaterThan(0)
      const maruti = brandRes.body.find((b: { name: string }) => b.name === 'Maruti Suzuki')
      expect(maruti).toBeTruthy()

      const modelRes = await request(app).get(`/api/v1/vehicles/brands/${maruti.id}/models`)
      expect(modelRes.status, JSON.stringify(modelRes.body)).toBe(200)
      expect(modelRes.body.length).toBeGreaterThan(0)
      expect(modelRes.body.every((m: { brand_id: string }) => String(m.brand_id) === String(maruti.id))).toBe(true)

      const badModelRes = await request(app).get('/api/v1/vehicles/brands/not-a-number/models')
      expect(badModelRes.status).toBe(400)
      expect(badModelRes.body.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('Fleet blacklist', () => {
    it('TC-M04-004: blacklisting a primary vehicle suspends the driver', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.blacklistDriver, { categorySlug: 'sedan' })
      const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)

      const blacklistRes = await request(app)
        .patch(`/api/v1/admin/vehicles/fleet/${driver.vehicleId}/blacklist`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'Fraudulent registration documents' })
      expect(blacklistRes.status, JSON.stringify(blacklistRes.body)).toBe(200)
      expect(blacklistRes.body.driver_suspended).toBe(true)

      const { rows: vehicleRows } = await pool.query(
        'SELECT status FROM driver_vehicles WHERE id = $1', [driver.vehicleId]
      )
      expect(vehicleRows[0]?.status).toBe('blacklisted')

      const { rows: driverRows } = await pool.query(
        'SELECT status FROM drivers WHERE id = $1', [driver.driverId]
      )
      expect(driverRows[0]?.status).toBe('suspended')

      const unblacklistRes = await request(app)
        .patch(`/api/v1/admin/vehicles/fleet/${driver.vehicleId}/unblacklist`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
      expect(unblacklistRes.status, JSON.stringify(unblacklistRes.body)).toBe(200)
      const { rows: afterUnblacklist } = await pool.query(
        'SELECT status FROM driver_vehicles WHERE id = $1', [driver.vehicleId]
      )
      expect(afterUnblacklist[0]?.status).toBe('active')
      // Per research: unblacklisting does NOT restore driver status automatically —
      // confirm this real (if surprising) behavior rather than assuming symmetry.
      const { rows: driverAfter } = await pool.query(
        'SELECT status FROM drivers WHERE id = $1', [driver.driverId]
      )
      expect(driverAfter[0]?.status).toBe('suspended')
    })
  })

  describe('Vehicle lifecycle', () => {
    it.todo('TC-M04-002: vehicle docs upload changes doc status to pending')
    it.todo('TC-M04-003: admin approves vehicle changes state to active')
    it.todo('TC-M04-005: driver can only have one active vehicle per ride type')
  })
})
