import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Same pattern as tests/unit/middleware/error-middleware-logging.test.ts —
// mount just the router under test on a bare express app instead of the
// full app.ts (which needs a real DB/Redis at import time).
vi.mock('@/modules/call-masking/call-masking.service')
vi.mock('@/middleware/auth.middleware', () => ({
  authenticate: () => (req: express.Request, _res: express.Response, next: () => void) => {
    if (req.headers['x-test-role'] === 'driver') req.driver = { id: 9n } as never
    else req.user = { id: 1n } as never
    next()
  },
}))
vi.mock('@/middleware/rateLimit.middleware', () => ({ maskedCallLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }))

import * as service from '@/modules/call-masking/call-masking.service'
import { CallMaskingError } from '@/modules/call-masking/call-masking.types'
import callMaskingRouter from '@/modules/call-masking/call-masking.routes'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(callMaskingRouter)
  return app
}

describe('POST /rides/:id/call', () => {
  beforeEach(() => vi.clearAllMocks())

  it('triggers the call and returns 200 on success', async () => {
    vi.mocked(service.triggerCall).mockResolvedValue(undefined)
    const app = buildApp()
    await request(app).post('/rides/1/call').expect(200, { status: 'calling' })
    expect(service.triggerCall).toHaveBeenCalledWith({ rideId: 1n, callerRole: 'user', callerId: 1n })
  })

  it('resolves the caller as driver when the request is driver-authenticated', async () => {
    vi.mocked(service.triggerCall).mockResolvedValue(undefined)
    const app = buildApp()
    await request(app).post('/rides/1/call').set('x-test-role', 'driver').expect(200)
    expect(service.triggerCall).toHaveBeenCalledWith({ rideId: 1n, callerRole: 'driver', callerId: 9n })
  })

  it('maps a CallMaskingError to a 409 with its code', async () => {
    vi.mocked(service.triggerCall).mockRejectedValue(new CallMaskingError('CALL_LIMIT_REACHED', 'too many calls'))
    const app = buildApp()
    await request(app).post('/rides/1/call').expect(409, { error: 'too many calls', code: 'CALL_LIMIT_REACHED' })
  })

  it('passes an unexpected error to the error middleware (500)', async () => {
    vi.mocked(service.triggerCall).mockRejectedValue(new Error('boom'))
    const app = buildApp()
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: 'internal' })
    })
    await request(app).post('/rides/1/call').expect(500)
  })
})
