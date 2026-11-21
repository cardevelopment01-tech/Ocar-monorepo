import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Mount only the rides router and stub what it imports (same pattern as active-user-route.test.ts); the PDF itself is real.
vi.mock('@/middleware/auth.middleware', () => ({
  authenticate: () => (req: express.Request, _res: express.Response, next: () => void) => {
    const role = req.headers['x-test-role']
    if (role === 'driver') req.driver = { id: 9n, status: 'active' } as never
    else req.user = { id: 1n, status: 'active' } as never
    next()
  },
}))
vi.mock('@/modules/rides/rides.repository', () => ({ getRideById: vi.fn(), getRideStops: vi.fn(), getTrailPoints: vi.fn() }))
vi.mock('@/modules/rides/rides.service', () => ({}))
vi.mock('@/modules/payments/payments.service', () => ({}))
vi.mock('@/db/redis', () => ({ client: {} }))
vi.mock('@/lib/storage', () => ({ getPresignedUrl: vi.fn() }))

import * as repo from '@/modules/rides/rides.repository'
import ridesRouter from '@/modules/rides/rides.routes'
import { CITY_RIDE, CANCELLED_FEE, CANCELLED_FREE, trail } from './receipt-fixtures'

const app = () => { const a = express(); a.use(express.json()); a.use(ridesRouter); return a }
const ride = (over: Record<string, unknown> = {}) => ({ ...CITY_RIDE, user_id: 1n, ...over }) as never

describe('GET /:id/receipt.pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideStops).mockResolvedValue([])
    vi.mocked(repo.getTrailPoints).mockResolvedValue(trail())
  })

  it('sends the rider their own receipt as a private, uncached PDF download', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(ride())
    const res = await request(app()).get('/48213/receipt.pdf').buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))) }).expect(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toContain('Ocar-receipt-48213.pdf')
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it("never serves another rider's receipt (404, same as a ride that does not exist)", async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(ride({ user_id: 2n }))
    await request(app()).get('/48213/receipt.pdf').expect(404)
    vi.mocked(repo.getRideById).mockResolvedValue(null as never)
    await request(app()).get('/48213/receipt.pdf').expect(404)
  })

  it('is for riders only: a driver token is refused', async () => {
    await request(app()).get('/48213/receipt.pdf').set('x-test-role', 'driver').expect(403)
    expect(repo.getRideById).not.toHaveBeenCalled()
  })

  it('has no receipt for a trip still running or a free cancellation, but does for a cancellation that carried a fee', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(ride({ status: 'in_progress' }))
    expect((await request(app()).get('/48213/receipt.pdf').expect(409)).body.code).toBe('RECEIPT_NOT_AVAILABLE')
    vi.mocked(repo.getRideById).mockResolvedValue(ride({ ...CANCELLED_FREE }))
    await request(app()).get('/48221/receipt.pdf').expect(409)
    vi.mocked(repo.getRideById).mockResolvedValue(ride({ ...CANCELLED_FEE }))
    await request(app()).get('/48220/receipt.pdf').expect(200)
  })

  it('skips the route lookup for a cancellation (no trip happened)', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(ride({ ...CANCELLED_FEE }))
    await request(app()).get('/48220/receipt.pdf').expect(200)
    expect(repo.getTrailPoints).not.toHaveBeenCalled()
  })
})
