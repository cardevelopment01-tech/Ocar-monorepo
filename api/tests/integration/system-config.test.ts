import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { loginAdmin, seedAdmin, cleanupAdmins } from '../helpers/fixtures/safety.fixture'

const app = createApp()
const SUPER = 'sysconfig-super@ocar.app'
const OPS = 'sysconfig-ops@ocar.app'
const PASSWORD = 'Admin@1234'

let superToken: string
let opsToken: string
let expiry: { id: string; value: string; updatedAt: string }

async function listConfig(token: string) {
  return request(app).get('/api/v1/admin/system-config').set('Authorization', `Bearer ${token}`)
}

beforeAll(async () => {
  await seedAdmin(pool, SUPER, 'super_admin', PASSWORD)
  await seedAdmin(pool, OPS, 'ops_admin', PASSWORD)
  superToken = (await loginAdmin(app, SUPER, PASSWORD)).accessToken
  opsToken = (await loginAdmin(app, OPS, PASSWORD)).accessToken
  const row = (await listConfig(superToken)).body.config.find((c: { key: string }) => c.key === 'cashback_expiry_days')
  expiry = { id: row.id, value: row.value, updatedAt: row.updatedAt }
})

afterAll(async () => {
  await pool.query('UPDATE system_config SET value = $2 WHERE id = $1', [expiry.id, expiry.value])
  // system_config.updated_by is a nullable FK with no ON DELETE action — release it before deleting the admins.
  await pool.query('UPDATE system_config SET updated_by = NULL WHERE updated_by = ANY(SELECT id FROM admins WHERE email = ANY($1))', [[SUPER, OPS]])
  await cleanupAdmins(pool, [SUPER, OPS])
  await pool.end()
  redis.disconnect()
})

describe('System config API guardrails', () => {
  it('exposes min/max for bounded keys and null for unbounded ones', async () => {
    const config = (await listConfig(superToken)).body.config as Array<{ key: string; min: number | null; max: number | null }>
    const commission = config.find(c => c.key === 'commission_percent')!
    expect([commission.min, commission.max]).toEqual([0, 50])
    const flag = config.find(c => c.key === 'razorpay_enabled')!
    expect([flag.min, flag.max]).toEqual([null, null])
  })

  it('is super_admin only', async () => {
    expect((await listConfig(opsToken)).status).toBe(403)
  })

  it('rejects an out-of-range value (a typo that parses as a number)', async () => {
    const commission = (await listConfig(superToken)).body.config.find((c: { key: string }) => c.key === 'commission_percent')
    const res = await request(app).patch(`/api/v1/admin/system-config/${commission.id}`)
      .set('Authorization', `Bearer ${superToken}`).send({ value: '1500' })
    expect(res.status).toBe(422)
    expect(res.body.error ?? res.body.message).toMatch(/between 0 and 50/)
  })

  it('rejects a non true/false value on the string-typed boolean', async () => {
    const flag = (await listConfig(superToken)).body.config.find((c: { key: string }) => c.key === 'cash_collection_enabled')
    const res = await request(app).patch(`/api/v1/admin/system-config/${flag.id}`)
      .set('Authorization', `Bearer ${superToken}`).send({ value: 'maybe' })
    expect(res.status).toBe(422)
  })

  it('saves a valid value when expectedUpdatedAt matches, then 409s a stale writer without overwriting', async () => {
    const ok = await request(app).patch(`/api/v1/admin/system-config/${expiry.id}`)
      .set('Authorization', `Bearer ${superToken}`).send({ value: '45', expectedUpdatedAt: expiry.updatedAt })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.config.value).toBe('45')
    expect(ok.body.config.updatedAt).not.toBe(expiry.updatedAt)

    // A second admin still holding the OLD updatedAt tries to save:
    const stale = await request(app).patch(`/api/v1/admin/system-config/${expiry.id}`)
      .set('Authorization', `Bearer ${superToken}`).send({ value: '99', expectedUpdatedAt: expiry.updatedAt })
    expect(stale.status).toBe(409)
    expect(stale.body.code).toBe('CONFIG_CHANGED')

    const now = (await listConfig(superToken)).body.config.find((c: { key: string }) => c.key === 'cashback_expiry_days')
    expect(now.value).toBe('45') // the stale save did not clobber it
  })

  it('still accepts a save with no expectedUpdatedAt (backward compatible)', async () => {
    const res = await request(app).patch(`/api/v1/admin/system-config/${expiry.id}`)
      .set('Authorization', `Bearer ${superToken}`).send({ value: expiry.value })
    expect(res.status).toBe(200)
  })
})
