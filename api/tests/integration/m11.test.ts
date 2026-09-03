import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { seedAdmin, loginAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

const app = createApp()

const SUPER_ADMIN_EMAIL = 'm11-super-admin@ocar.app'
const OPS_ADMIN_EMAIL = 'm11-ops-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'

beforeAll(async () => {
  await seedAdmin(pool, SUPER_ADMIN_EMAIL, 'super_admin', ADMIN_PASSWORD)
  await seedAdmin(pool, OPS_ADMIN_EMAIL, 'ops_admin', ADMIN_PASSWORD)
})

afterAll(async () => {
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
      const flag = listRes.body.config.find((c: { value_type?: string; valueType?: string }) => (c.valueType ?? c.value_type) === 'boolean')
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

    it.todo('TC-M11-005: admin suspends user changes user status')
    it.todo('TC-M11-006: rate card update applies to new ride estimates')
  })
})
