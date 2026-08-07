import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Same pattern as tests/unit/middleware/error-middleware-logging.test.ts —
// mount just the router under test on a bare express app instead of the
// full app.ts (which needs a real DB/Redis at import time).
vi.mock('@/config', () => ({ config: { EXOTEL_WEBHOOK_SECRET: 'sekret', EXOTEL_WAIT_AUDIO_URL: '', EXOTEL_STATUS_CALLBACK_URL: '' } }))
vi.mock('@/modules/call-masking/call-masking.repository')
vi.mock('@/modules/call-masking/call-masking.service')
vi.mock('@/middleware/auth.middleware', () => ({ authenticate: () => (_req: unknown, _res: unknown, next: () => void) => next() }))
vi.mock('@/middleware/rateLimit.middleware', () => ({ maskedCallLimiter: (_req: unknown, _res: unknown, next: () => void) => next() }))

import * as repo from '@/modules/call-masking/call-masking.repository'
import callMaskingRouter from '@/modules/call-masking/call-masking.routes'

function buildApp() {
  const app = express()
  app.use(express.urlencoded({ extended: true }))
  app.use(express.json())
  app.use(callMaskingRouter)
  return app
}

describe('POST /webhooks/exotel/status — token auth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects with 401 when ?token= is missing', async () => {
    const app = buildApp()
    await request(app)
      .post('/webhooks/exotel/status')
      .send({ CallSid: 'CA1', CustomField: '1' })
      .expect(401)
    expect(repo.recordCallEvent).not.toHaveBeenCalled()
  })

  it('rejects with 401 when ?token= does not match EXOTEL_WEBHOOK_SECRET', async () => {
    const app = buildApp()
    await request(app)
      .post('/webhooks/exotel/status?token=wrong')
      .send({ CallSid: 'CA1', CustomField: '1' })
      .expect(401)
    expect(repo.recordCallEvent).not.toHaveBeenCalled()
  })

  it('accepts and records the event when ?token= matches', async () => {
    vi.mocked(repo.recordCallEvent).mockResolvedValue(true)
    const app = buildApp()
    await request(app)
      .post('/webhooks/exotel/status?token=sekret')
      .send({ CallSid: 'CA1', CustomField: '1', Status: 'completed' })
      .expect(200)
    expect(repo.recordCallEvent).toHaveBeenCalledWith(
      expect.objectContaining({ callSid: 'CA1', rideCallMaskId: 1n, callStatus: 'completed' })
    )
  })
})
