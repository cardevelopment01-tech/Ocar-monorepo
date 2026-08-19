import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Same pattern as tests/unit/call-masking/call-masking.routes.test.ts — mount
// just the controller under test on a bare express app, mocking the service
// layer so no real DB/Redis is needed.
vi.mock('@/modules/auth/auth.service', () => ({
  requestOtp: vi.fn(() => Promise.resolve({ otp: '1234' })),
}))

import { requestOtp } from '@/modules/auth/auth.controller'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.post('/otp/request', requestOtp)
  return app
}

describe('POST /otp/request — DEMO_MODE must never leak the OTP in real production', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('includes the OTP in non-production, regardless of DEMO_MODE', async () => {
    process.env['NODE_ENV'] = 'staging'
    delete process.env['DEMO_MODE']

    const res = await request(buildApp())
      .post('/otp/request')
      .send({ phone: '9876543210', role: 'user' })
      .expect(200)

    expect(res.body.otp).toBe('1234')
  })

  it('REGRESSION GUARD: never includes the OTP in production, even when DEMO_MODE=true', async () => {
    process.env['NODE_ENV'] = 'production'
    process.env['DEMO_MODE'] = 'true'

    const res = await request(buildApp())
      .post('/otp/request')
      .send({ phone: '9876543210', role: 'user' })
      .expect(200)

    expect(res.body.otp).toBeUndefined()
  })

  it('does not include the OTP in production when DEMO_MODE is unset', async () => {
    process.env['NODE_ENV'] = 'production'
    delete process.env['DEMO_MODE']

    const res = await request(buildApp())
      .post('/otp/request')
      .send({ phone: '9876543210', role: 'user' })
      .expect(200)

    expect(res.body.otp).toBeUndefined()
  })
})
