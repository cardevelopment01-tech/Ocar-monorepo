import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { setupOnlineDriver, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'
import { loginAdmin, seedAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

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
  docApprovalDriver: '+919700000102',
  primaryVehicleDriver: '+919700000103',
  driverApprovalDriver: '+919700000104',
  docApprovalDriver2: '+919700000105',
} as const

const ADMIN_EMAIL = 'm04-vehicles-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'

beforeAll(async () => {
  await seedAdmin(pool, ADMIN_EMAIL, 'super_admin', ADMIN_PASSWORD)
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await cleanupAdmins(pool, [ADMIN_EMAIL])
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

  describe('Driver and vehicle-doc approval', () => {
    it('TC-M04-002: rejects vehicle-doc approval with a stale seen_updated_at (409 DOC_CHANGED)', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.docApprovalDriver, { categorySlug: 'sedan' })
      const { rows: docRows } = await pool.query<{ id: string; updated_at: string }>(
        `INSERT INTO driver_vehicle_documents (vehicle_id, doc_type, file_url, status)
         VALUES ($1, 'vehicle_rc', 'https://storage.test/rc.jpg', 'pending')
         RETURNING id, updated_at`,
        [driver.vehicleId]
      )
      const docId = docRows[0]!.id

      const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)

      // Stale seen_updated_at must 409, not silently succeed.
      const staleRes = await request(app)
        .patch(`/api/v1/admin/vehicles/documents/${docId}/approve`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ verified_valid_until: '2030-12-31', seen_updated_at: '2000-01-01T00:00:00.000Z' })
      expect(staleRes.status, JSON.stringify(staleRes.body)).toBe(409)
      expect(staleRes.body.code).toBe('DOC_CHANGED')

      const { rows } = await pool.query(
        'SELECT status FROM driver_vehicle_documents WHERE id = $1', [docId]
      )
      expect(rows[0]?.status).toBe('pending')
    })

    // Was blocked by a real app bug: approveVehicleDoc's optimistic-lock guard
    // compared the client-supplied seen_updated_at (JS Date, millisecond
    // precision) against the stored TIMESTAMPTZ (microsecond precision) with
    // exact equality, so a real client's approve request almost always got a
    // false 409 DOC_CHANGED. Fixed in admin.repository.ts (approveVehicleDoc +
    // approveDriverDoc) by comparing both sides truncated to millisecond
    // precision via date_trunc('milliseconds', ...); verified against the real
    // test DB before and after the fix.
    it('TC-M04-002b: approves a vehicle document given the correct seen_updated_at', async () => {
      // Distinct phone from TC-M04-002 above — reusing docApprovalDriver would
      // call setupOnlineDriver a second time for the same driver in this same
      // file run (no per-test cleanup, only afterAll), and seedActiveDriverWithVehicle
      // derives the plate deterministically from driverId, so the second
      // driver_vehicles insert would collide on the plate's UNIQUE constraint.
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.docApprovalDriver2, { categorySlug: 'sedan' })
      const { rows: docRows } = await pool.query<{ id: string; updated_at: string }>(
        `INSERT INTO driver_vehicle_documents (vehicle_id, doc_type, file_url, status)
         VALUES ($1, 'vehicle_rc', 'https://storage.test/rc.jpg', 'pending')
         RETURNING id, updated_at`,
        [driver.vehicleId]
      )
      const docId = docRows[0]!.id
      const seenUpdatedAt = docRows[0]!.updated_at

      const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)
      const approveRes = await request(app)
        .patch(`/api/v1/admin/vehicles/documents/${docId}/approve`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ verified_valid_until: '2030-12-31', seen_updated_at: seenUpdatedAt })
      expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200)

      const { rows } = await pool.query(
        'SELECT status, verified_valid_until FROM driver_vehicle_documents WHERE id = $1', [docId]
      )
      expect(rows[0]?.status).toBe('approved')
    })

    it('TC-M04-003: admin approves driver — pending_approval to active', async () => {
      // Fresh login creates the driver row at onboarding_step=personal_info/status=pending_docs.
      const loginRes = await request(app)
        .post('/api/v1/auth/otp/request')
        .send({ phone: PHONES.driverApprovalDriver, role: 'driver' })
      const { otp } = loginRes.body as { otp: string }
      const verifyRes = await request(app)
        .post('/api/v1/auth/otp/verify')
        .send({ phone: PHONES.driverApprovalDriver, otp, role: 'driver' })
      const realDriverId = (verifyRes.body.principal.id as string)

      await pool.query(`UPDATE drivers SET status = 'pending_approval' WHERE id = $1`, [realDriverId])

      const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)
      const approveRes = await request(app)
        .patch(`/api/v1/admin/drivers/${realDriverId}/status`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ status: 'active', reason: 'Documents verified' })
      expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200)

      const { rows } = await pool.query<{ status: string; approved_by: string | null }>(
        'SELECT status, approved_by FROM drivers WHERE id = $1', [realDriverId]
      )
      expect(rows[0]?.status).toBe('active')
      expect(rows[0]?.approved_by).toBe(admin.adminId)

      const { rows: historyRows } = await pool.query(
        `SELECT from_status, to_status FROM driver_status_history WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [realDriverId]
      )
      expect(historyRows[0]?.from_status).toBe('pending_approval')
      expect(historyRows[0]?.to_status).toBe('active')
    })

    it('TC-M04-005: a driver can only have one non-blacklisted primary vehicle', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.primaryVehicleDriver, { categorySlug: 'sedan' })

      const { rows: catRows } = await pool.query<{ id: string }>(
        "SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1"
      )
      const { rows: brandRows } = await pool.query<{ id: string }>(
        "SELECT id FROM vehicle_brands WHERE name = 'Maruti Suzuki' LIMIT 1"
      )

      // Attempting to insert a SECOND primary, non-blacklisted vehicle for the same
      // driver must violate driver_vehicles_one_primary_idx — this is a real DB
      // constraint, not app-level validation, so assert the Postgres error directly.
      await expect(
        pool.query(
          `INSERT INTO driver_vehicles (driver_id, category_id, brand_id, number_plate, status, is_primary)
           VALUES ($1, $2, $3, 'OD02TESTSECOND', 'active', true)`,
          [driver.driverId, catRows[0]!.id, brandRows[0]!.id]
        )
      ).rejects.toMatchObject({ code: '23505' })
    })
  })
})
