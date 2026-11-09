import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@/config', () => ({ config: { NODE_ENV: 'test' } }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/middleware/auth.middleware', () => ({
  authenticate: () => (req: { admin?: { id: bigint; role: string } }, _r: unknown, n: () => void) => { req.admin = { id: 1n, role: 'super_admin' }; n() },
}))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
const m = vi.hoisted(() => ({ byId: vi.fn(), update: vi.fn(), cfg: {} as Record<string, string> }))
vi.mock('@/modules/offers/offers.repository', () => ({ openDiscountedRideCount: vi.fn().mockResolvedValue(0) }))
vi.mock('@/lib/system-config', () => ({
  listConfig: vi.fn(), getConfigById: m.byId, getConfigValue: vi.fn(async (k: string, fb: string) => m.cfg[k] ?? fb),
  validateConfigValue: vi.fn(() => null), updateConfigValue: m.update,
}))

import router from '@/modules/admin/system-config.routes'
import { errorMiddleware } from '@/middleware/error.middleware'
import { CASH_DUE_MIN_DRIVER_VERSION as V } from '@/constants/limits'

const app = express()
app.use(express.json())
app.use('/cfg', router)
app.use(errorMiddleware)

// Value: protects=the go-live safety: cash discounts cannot be switched on below the driver build that shows cash_due,
// nor that minimum lowered under them; fails_when=the route stops calling the guard; why_new=Task 11/12 guard wiring;
// seam=none; no_claim=the guard's own cases (cash-discount-guard.test.ts).
const row = (key: string, value: string) => ({ id: '3', key, value, valueType: 'string', updatedAt: '2026-11-04T00:00:00Z' })

beforeEach(() => {
  vi.clearAllMocks()
  m.cfg = { offers_cash_discounts_enabled: 'false', app_update_driver_android_min: '0.0.0', app_update_enabled: 'true' }
  m.update.mockImplementation(async (_id: string, value: string) => row('x', value))
})

describe('cash discount guard on the config route', () => {
  it('refuses to switch cash discounts on while the driver minimum is old, and saves nothing', async () => {
    m.byId.mockResolvedValue(row('offers_cash_discounts_enabled', 'false'))
    const res = await request(app).patch('/cfg/3').send({ value: 'true' })
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('CASH_DISCOUNT_GUARD')
    expect(res.body.error).toMatch(new RegExp(V.replace(/\./g, '\\.')))
    expect(m.update).not.toHaveBeenCalled()
  })

  it('allows it once the driver minimum is at the build', async () => {
    m.cfg['app_update_driver_android_min'] = V
    m.byId.mockResolvedValue(row('offers_cash_discounts_enabled', 'false'))
    expect((await request(app).patch('/cfg/3').send({ value: 'true' })).status).toBe(200)
  })

  it('refuses lowering the driver minimum while cash discounts are on', async () => {
    m.cfg = { offers_cash_discounts_enabled: 'true', app_update_driver_android_min: V, app_update_driver_android_recommended: '9.0.0', app_update_enabled: 'true' }
    m.byId.mockResolvedValue(row('app_update_driver_android_min', V))
    const res = await request(app).patch('/cfg/3').send({ value: '1.0.0' })
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('CASH_DISCOUNT_GUARD')
    expect(m.update).not.toHaveBeenCalled()
  })

  it('with the guard switched off on purpose, cash discounts can be turned on below the build, and the switch itself saves', async () => {
    m.cfg['offers_cash_guard_enforced'] = 'false'
    m.byId.mockResolvedValue(row('offers_cash_discounts_enabled', 'false'))
    expect((await request(app).patch('/cfg/3').send({ value: 'true' })).status).toBe(200)
    m.cfg = { offers_cash_discounts_enabled: 'true', app_update_driver_android_min: '0.0.0', app_update_enabled: 'true', offers_cash_guard_enforced: 'false' }
    m.byId.mockResolvedValue(row('offers_cash_guard_enforced', 'false'))
    const back = await request(app).patch('/cfg/3').send({ value: 'true' })
    expect(back.status).toBe(422) // cannot be put back while cash discounts are on and the minimum is still low
    expect(back.body.code).toBe('CASH_DISCOUNT_GUARD')
  })

  it('does not touch other settings', async () => {
    m.byId.mockResolvedValue(row('cashback_ride_percent', '5'))
    expect((await request(app).patch('/cfg/3').send({ value: '9' })).status).toBe(200)
  })
})
