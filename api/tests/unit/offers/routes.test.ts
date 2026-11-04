import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@/config', () => ({ config: { NODE_ENV: 'test' } }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/middleware/auth.middleware', () => ({
  authenticate: () => (req: { user?: { id: bigint; status: string } }, _r: unknown, n: () => void) => { req.user = { id: 7n, status: 'active' }; n() },
}))
vi.mock('@/middleware/rateLimit.middleware', () => ({
  offersPreviewLimiter: (_q: unknown, _r: unknown, n: () => void) => n(),
  offersCodeGuessLimiters: [(_q: unknown, _r: unknown, n: () => void) => n()],
}))
const m = vi.hoisted(() => ({ preview: vi.fn(), active: vi.fn(), usage: vi.fn(), granted: vi.fn(), cfg: vi.fn(), city: vi.fn() }))
vi.mock('@/modules/geo/geo.service', () => ({ findNearestCity: m.city }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: m.cfg }))
vi.mock('@/modules/offers/offers.service', () => ({ previewOffers: m.preview }))
vi.mock('@/modules/offers/offers.repository', () => ({ findActiveOffers: m.active, getUserUsage: m.usage, listGrantedOfferIds: m.granted }))

import offersRouter from '@/modules/offers/offers.routes'
import { errorMiddleware } from '@/middleware/error.middleware'

const app = express()
app.use(express.json())
app.use('/offers', offersRouter)
app.use(errorMiddleware)

const valid = { category_id: 1, ride_type: 'one_way', distance_km: 62, duration_min: 90, paymentChannel: 'online' }
const record = (id: bigint, kind: 'auto' | 'code' | 'assigned', extra: object = {}) => ({
  id, code: kind === 'code' ? 'SAVE50' : null, name: `o${id}`, kind, status: 'active', versionId: id, version: 1, rules: [],
  benefit: { type: 'percent_off', percent: 10 }, perUserLimit: null, stacking: 'exclusive', fundedBy: 'driver', display: {},
  budgetTotal: null, budgetSpent: 0, globalLimit: null, redemptionCount: 0, startsAt: null, endsAt: null, ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.preview.mockResolvedValue({ fareTotal: 454, discount: 45, cashback: 0, payable: 409, applied: null, alternatives: [], rejected: [] })
  m.usage.mockResolvedValue(new Map())
  m.granted.mockResolvedValue([])
  m.cfg.mockResolvedValue('true')
  m.city.mockResolvedValue(null)
})

describe('POST /offers/preview', () => {
  it('returns the service result for the signed-in rider', async () => {
    const res = await request(app).post('/offers/preview').send(valid)
    expect(res.status).toBe(200)
    expect(res.body.payable).toBe(409)
    expect(m.preview).toHaveBeenCalledWith(7n, expect.objectContaining({ category_id: 1, paymentChannel: 'online' }))
  })

  it('derives the cities from the pickup and drop the way the booking does, ignoring any client city id', async () => {
    m.city.mockImplementation(async (lat: number) => (lat < 20.4 ? { id: 1 } : { id: 2 }))
    await request(app).post('/offers/preview').send({ ...valid, city_id: 99, originCityId: 98, originLat: 20.29, originLng: 85.82, destinationLat: 20.5, destinationLng: 86.4 })
    expect(m.preview).toHaveBeenCalledWith(7n, expect.objectContaining({ city_id: 1, originCityId: 1, destinationCityId: 2 }))
    expect(m.preview.mock.calls[0]![1]).not.toHaveProperty('originLat')
  })

  it('passes the automatic-offer choice through and rejects a malformed one', async () => {
    await request(app).post('/offers/preview').send({ ...valid, autoOffer: 'none' })
    expect(m.preview).toHaveBeenLastCalledWith(7n, expect.objectContaining({ autoOffer: 'none' }))
    expect((await request(app).post('/offers/preview').send({ ...valid, autoOffer: 'best' })).status).toBe(422)
  })

  it('answers 422 naming the bad field, never a 500', async () => {
    const res = await request(app).post('/offers/preview').send({ ...valid, paymentChannel: 'barter' })
    expect(res.status).toBe(422)
    expect(res.body.error ?? res.body.message).toMatch(/paymentChannel/)
    expect(m.preview).not.toHaveBeenCalled()
  })
})

describe('GET /offers', () => {
  it('never lists a code offer, and lists an assigned offer only for its owner', async () => {
    m.active.mockResolvedValue([record(1n, 'auto'), record(2n, 'code'), record(3n, 'assigned'), record(4n, 'assigned')])
    m.granted.mockResolvedValue([3n])
    const res = await request(app).get('/offers')
    expect(res.status).toBe(200)
    expect(res.body.offers.map((o: { id: string }) => o.id)).toEqual(['1', '3'])
    expect(JSON.stringify(res.body)).not.toContain('SAVE50')
  })

  it('hides an offer the rider has used up, and uses one usage query for any number of offers', async () => {
    const many = Array.from({ length: 20 }, (_, i) => record(BigInt(i + 1), 'auto', { perUserLimit: 1 }))
    m.active.mockResolvedValue(many)
    m.usage.mockResolvedValue(new Map([[1n, 1]]))
    const res = await request(app).get('/offers')
    expect(res.body.offers).toHaveLength(19)
    expect(m.usage).toHaveBeenCalledTimes(1)
    expect(m.granted).toHaveBeenCalledTimes(1)
  })

  it('re-checks the offer window, since the cached list can be 30 s stale', async () => {
    m.active.mockResolvedValue([
      record(1n, 'auto'),
      record(2n, 'auto', { endsAt: new Date(Date.now() - 1000) }),
      record(3n, 'auto', { startsAt: new Date(Date.now() + 60_000) }),
    ])
    const res = await request(app).get('/offers')
    expect(res.body.offers.map((o: { id: string }) => o.id)).toEqual(['1'])
  })

  it('carries a one-line summary from the server', async () => {
    m.active.mockResolvedValue([record(1n, 'auto')])
    const res = await request(app).get('/offers')
    expect(res.body.offers[0].summary).toBe('10% off')
  })
})

describe('GET /offers while offers are off', () => {
  it('lists nothing and reads no offers', async () => {
    m.cfg.mockResolvedValue('false')
    const res = await request(app).get('/offers')
    expect(res.body).toEqual({ offers: [] })
    expect(m.active).not.toHaveBeenCalled()
  })
})
