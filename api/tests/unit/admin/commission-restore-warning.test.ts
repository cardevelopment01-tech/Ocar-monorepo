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
const m = vi.hoisted(() => ({ open: vi.fn(), byId: vi.fn(), update: vi.fn() }))
vi.mock('@/modules/offers/offers.repository', () => ({ openDiscountedRideCount: m.open }))
vi.mock('@/lib/system-config', () => ({
  listConfig: vi.fn(), getConfigById: m.byId, getConfigValue: vi.fn(async (_k: string, fb: string) => fb),
  validateConfigValue: vi.fn(() => null), updateConfigValue: m.update,
}))

import router from '@/modules/admin/system-config.routes'
import { errorMiddleware } from '@/middleware/error.middleware'

const app = express()
app.use(express.json())
app.use('/cfg', router)
app.use(errorMiddleware)

// Value: protects=restoring the commission with unpaid discounted rides open shows the admin how many; fails_when=the
// warning is dropped, shown when nothing is open, or turns into a block; why_new=D21 chose warn-not-block;
// seam=none; no_claim=the count query (mocked; the integration lifecycle covers real rows).
const row = (key: string, value: string) => ({ id: '3', key, value, valueType: 'decimal', updatedAt: '2026-11-04T00:00:00Z' })

beforeEach(() => {
  vi.clearAllMocks()
  m.byId.mockResolvedValue(row('commission_percent', '0'))
  m.update.mockResolvedValue(row('commission_percent', '15'))
  m.open.mockResolvedValue(0)
})

describe('commission_percent save', () => {
  it('warns with the count of unpaid discounted rides when the rate goes up, and still saves', async () => {
    m.open.mockResolvedValue(3)
    const res = await request(app).patch('/cfg/3').send({ value: '15' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.config.value).toBe('15')
    expect(res.body.warnings).toEqual([expect.objectContaining({ code: 'OPEN_DISCOUNTED_RIDES', openDiscountedRides: 3, message: expect.stringContaining('3 rides') })])
  })
  it('says nothing when no discounted ride is open', async () => {
    const res = await request(app).patch('/cfg/3').send({ value: '15' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.warnings).toBeUndefined()
    expect(m.open).toHaveBeenCalledTimes(1)
  })
  it('does not even look when the rate goes down or another setting changes', async () => {
    m.byId.mockResolvedValue(row('commission_percent', '15'))
    m.update.mockResolvedValue(row('commission_percent', '0'))
    await request(app).patch('/cfg/3').send({ value: '0' })
    m.byId.mockResolvedValue(row('cashback_ride_percent', '5'))
    m.update.mockResolvedValue(row('cashback_ride_percent', '9'))
    await request(app).patch('/cfg/3').send({ value: '9' })
    expect(m.open).not.toHaveBeenCalled()
  })
  it('uses the singular for one ride, and a failing count never blocks the save', async () => {
    m.open.mockResolvedValue(1)
    expect((await request(app).patch('/cfg/3').send({ value: '15' })).body.warnings[0].message).toContain('1 ride with a rider offer is not paid')
    m.open.mockRejectedValue(new Error('db'))
    const res = await request(app).patch('/cfg/3').send({ value: '15' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.warnings).toBeUndefined()
  })
})
