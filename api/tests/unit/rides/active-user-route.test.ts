import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Same pattern as tests/unit/call-masking/call-masking.routes.test.ts: mount only the router on a bare express app and
// stub everything it imports, so no DB/Redis is needed.
vi.mock('@/middleware/auth.middleware', () => ({
  authenticate: () => (req: express.Request, _res: express.Response, next: () => void) => {
    if (req.headers['x-test-role'] !== 'driver') req.user = { id: 1n, status: 'active' } as never
    next()
  },
}))
vi.mock('@/modules/rides/rides.repository', () => ({ getActiveRideIdForUser: vi.fn() }))
vi.mock('@/modules/rides/rides.service', () => ({}))
vi.mock('@/modules/payments/payments.service', () => ({}))
vi.mock('@/db/redis', () => ({ client: {} }))
vi.mock('@/lib/storage', () => ({ getPresignedUrl: vi.fn() }))
vi.mock('@/lib/trip-window', () => ({ withTripWindow: vi.fn() }))

import * as repo from '@/modules/rides/rides.repository'
import ridesRouter from '@/modules/rides/rides.routes'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(ridesRouter)
  return app
}

describe('GET /me/active-user', () => {
  beforeEach(() => vi.clearAllMocks())

  it('answers 204 with no body when the rider has no active ride (not a 404 error)', async () => {
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null as never)
    const res = await request(buildApp()).get('/me/active-user').expect(204)
    expect(res.text).toBe('')
  })

  it('returns the ride id when there is one', async () => {
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue('42' as never)
    await request(buildApp()).get('/me/active-user').expect(200, { rideId: '42' })
  })

  it('still refuses a driver token with 403', async () => {
    await request(buildApp()).get('/me/active-user').set('x-test-role', 'driver').expect(403)
  })
})
