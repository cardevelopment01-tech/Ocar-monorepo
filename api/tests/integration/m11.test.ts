import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'
import { loginUser, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'

const app = createApp()

const SUPER_ADMIN_EMAIL = 'm11-super-admin@ocar.app'
const OPS_ADMIN_EMAIL = 'm11-ops-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'

const PHONES = {
  suspendUser: '+919700000301',
} as const

beforeAll(async () => {
  await seedAdmin(pool, SUPER_ADMIN_EMAIL, 'super_admin', ADMIN_PASSWORD)
  await seedAdmin(pool, OPS_ADMIN_EMAIL, 'ops_admin', ADMIN_PASSWORD)
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, Object.values(PHONES))
  await cleanupAdmins(pool, [SUPER_ADMIN_EMAIL, OPS_ADMIN_EMAIL])
  await pool.end()
  redis.disconnect()
})

describe('M11 — Admin Panel', () => {
  describe('Admin operations', () => {
    // TC-M11-001 (super_admin approves driver) is already covered by
    // m04.test.ts's TC-M04-003 — same endpoint (`PATCH /admin/drivers/:id/status`),
    // same mechanics. Not duplicated here.

    it('TC-M11-002: ops_admin cannot access the finance-gated payments endpoint', async () => {
      const opsAdmin = await loginAdmin(app, OPS_ADMIN_EMAIL, ADMIN_PASSWORD)
      const res = await request(app)
        .get('/api/v1/admin/payments')
        .set('Authorization', `Bearer ${opsAdmin.accessToken}`)
      expect(res.status, JSON.stringify(res.body)).toBe(403)

      const superAdmin = await loginAdmin(app, SUPER_ADMIN_EMAIL, ADMIN_PASSWORD)
      const superRes = await request(app)
        .get('/api/v1/admin/payments')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      expect(superRes.status, JSON.stringify(superRes.body)).toBe(200)
    })

    it('TC-M11-003: system config read returns active config value', async () => {
      const superAdmin = await loginAdmin(app, SUPER_ADMIN_EMAIL, ADMIN_PASSWORD)
      const res = await request(app)
        .get('/api/v1/admin/system-config/')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(Array.isArray(res.body.config)).toBe(true)
      expect(res.body.config.length).toBeGreaterThan(0)

      // system-config router is super_admin-only, router-wide — ops_admin must be forbidden.
      const opsAdmin = await loginAdmin(app, OPS_ADMIN_EMAIL, ADMIN_PASSWORD)
      const opsRes = await request(app)
        .get('/api/v1/admin/system-config/')
        .set('Authorization', `Bearer ${opsAdmin.accessToken}`)
      expect(opsRes.status, JSON.stringify(opsRes.body)).toBe(403)
    })

    it('TC-M11-004: feature flag update propagates to app config', async () => {
      const superAdmin = await loginAdmin(app, SUPER_ADMIN_EMAIL, ADMIN_PASSWORD)
      const listRes = await request(app)
        .get('/api/v1/admin/system-config/')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      const flag = listRes.body.config.find((c: { valueType: string }) => c.valueType === 'boolean')
      if (!flag) throw new Error('No boolean-typed system_config row seeded to test against')
      const originalValue = flag.value as string

      const newValue = originalValue === 'true' ? 'false' : 'true'
      try {
        const patchRes = await request(app)
          .patch(`/api/v1/admin/system-config/${flag.id}`)
          .set('Authorization', `Bearer ${superAdmin.accessToken}`)
          .send({ value: newValue })
        expect(patchRes.status, JSON.stringify(patchRes.body)).toBe(200)
        expect(patchRes.body.config.value).toBe(newValue)

        const { getConfigValue } = await import('@/lib/system-config')
        const readBack = await getConfigValue(flag.key, 'unset')
        expect(readBack).toBe(newValue)
      } finally {
        // Restore — this is a real shared system_config row.
        await request(app)
          .patch(`/api/v1/admin/system-config/${flag.id}`)
          .set('Authorization', `Bearer ${superAdmin.accessToken}`)
          .send({ value: originalValue })
      }
    })

    it('TC-M11-005: admin suspends a user, changing their status', async () => {
      const { userId } = await loginUser(app, redis, PHONES.suspendUser)
      const superAdmin = await loginAdmin(app, SUPER_ADMIN_EMAIL, ADMIN_PASSWORD)

      const res = await request(app)
        .patch(`/api/v1/admin/users/${userId}/status`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({ status: 'suspended' })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.status).toBe('suspended')

      const { rows } = await pool.query('SELECT status FROM users WHERE id = $1', [userId])
      expect(rows[0]?.status).toBe('suspended')

      // Restore, asserted (not fire-and-forget) — catches a regression in the
      // restore path itself (e.g. status:'active' breaking) rather than letting
      // it surface as a confusing downstream failure.
      const restoreRes = await request(app)
        .patch(`/api/v1/admin/users/${userId}/status`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({ status: 'active' })
      expect(restoreRes.status, JSON.stringify(restoreRes.body)).toBe(200)
    })
  })

  describe('Rate-card admin authorization', () => {
    it('TC-M11-006: only super_admin/ops_admin can create rate cards', async () => {
      const { rows: catRows } = await pool.query<{ id: string }>(
        "SELECT id FROM vehicle_categories WHERE slug = 'suv' LIMIT 1"
      )
      const categoryId = Number(catRows[0]!.id)
      const opsAdmin = await loginAdmin(app, OPS_ADMIN_EMAIL, ADMIN_PASSWORD)

      // ops_admin IS allowed here (unlike the payments endpoint in TC-M11-002) —
      // confirm the positive case, not just a blanket "ops_admin is always blocked".
      try {
        const res = await request(app)
          .post('/api/v1/admin/pricing/rate-cards')
          .set('Authorization', `Bearer ${opsAdmin.accessToken}`)
          .send({ category_id: categoryId, ride_type: 'one_way', rate_per_km: 17, rate_per_min: 2.5, min_fare: 350 })
        expect(res.status, JSON.stringify(res.body)).toBe(201)
      } finally {
        // Restore the real seeded suv/one_way rate card (016_seed.sql, verified
        // live: rate_per_km=17.00, rate_per_min=2.50, min_fare=350.00,
        // return_rate_per_km=14.00) — this test mutates shared seed data.
        const restoreRes = await request(app)
          .post('/api/v1/admin/pricing/rate-cards')
          .set('Authorization', `Bearer ${opsAdmin.accessToken}`)
          .send({
            category_id: categoryId,
            ride_type: 'one_way',
            rate_per_km: 17,
            rate_per_min: 2.5,
            min_fare: 350,
            return_rate_per_km: 14,
          })
        expect(restoreRes.status, JSON.stringify(restoreRes.body)).toBe(201)
      }

      // support_admin/finance_admin cannot create rate cards — outside requireAdmin's list.
      const FINANCE_ADMIN_EMAIL = 'm11-finance-admin@ocar.app'
      await seedAdmin(pool, FINANCE_ADMIN_EMAIL, 'finance_admin', ADMIN_PASSWORD)
      try {
        const financeLogin = await loginAdmin(app, FINANCE_ADMIN_EMAIL, ADMIN_PASSWORD)
        const forbiddenRes = await request(app)
          .post('/api/v1/admin/pricing/rate-cards')
          .set('Authorization', `Bearer ${financeLogin.accessToken}`)
          .send({ category_id: categoryId, ride_type: 'one_way', rate_per_km: 17, rate_per_min: 2.5, min_fare: 350 })
        expect(forbiddenRes.status, JSON.stringify(forbiddenRes.body)).toBe(403)
      } finally {
        await cleanupAdmins(pool, [FINANCE_ADMIN_EMAIL])
      }
    })
  })
})
