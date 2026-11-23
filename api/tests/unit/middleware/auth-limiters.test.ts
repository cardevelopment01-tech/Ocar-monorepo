import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@/db/redis', async () => ({ client: { call: vi.fn() }, withTimeout: (await import('@/lib/with-timeout')).withTimeout }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/jwt', () => ({
  verifyAccessToken: vi.fn(),
  verifyPendingTotpToken: (t: string) => {
    if (!t.startsWith('pending-')) throw new Error('bad token')
    return { adminId: t.slice('pending-'.length) }
  },
}))

import { makeAuthLimiters } from '@/middleware/rateLimit.middleware'

// The real limiters, switched on (they are skipped under NODE_ENV=test), in front of stub handlers whose
// outcome the test controls: a wrong password / code answers 401, the right one 200.
function build() {
  const l = makeAuthLimiters(() => false)
  const app = express()
  app.use(express.json())
  app.set('trust proxy', 1)
  const ok = (req: express.Request, res: express.Response) => {
    const good = req.body?.password === 'right' || req.body?.code === '123456' || req.body?.otp === 'right'
    res.status(good ? 200 : 401).json({ ok: good })
  }
  app.post('/otp/verify', l.otpLimiter, ok)
  app.post('/admin/login', l.adminLoginIpLimiter, l.adminLoginAccountLimiter, ok)
  app.post('/admin/totp-verify', l.adminTotpIpLimiter, l.adminTotpAccountLimiter, ok)
  app.get('/invite/verify', l.inviteVerifyLimiter, (req, res) => { const good = req.query['token'] === 'good'; res.status(good ? 200 : 400).json({ ok: good }) })
  app.post('/invite/redeem', l.inviteRedeemLimiter, ok)
  app.post('/refresh', l.refreshLimiter, (_req, res) => { res.status(200).json({ ok: true }) })
  app.get('/me', (_req, res) => { res.status(200).json({ ok: true }) }) // no auth limiter: must never 429
  return app
}
const ip = (n: string) => ({ 'x-forwarded-for': n })

let app: express.Express
beforeEach(() => { app = build() })

describe('admin login', () => {
  it('counts only FAILED attempts per IP: many good logins never lock, the 11th bad one does', async () => {
    for (let i = 0; i < 25; i++) {
      const r = await request(app).post('/admin/login').set(ip('1.1.1.1')).send({ email: `a${i}@x.com`, password: 'right' })
      expect(r.status).toBe(200)
    }
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post('/admin/login').set(ip('1.1.1.1')).send({ email: `b${i}@x.com`, password: 'bad' })).status).toBe(401)
    }
    const blocked = await request(app).post('/admin/login').set(ip('1.1.1.1')).send({ email: 'c@x.com', password: 'bad' })
    expect(blocked.status).toBe(429)
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('locks one email after 10 failures even when every attempt comes from a different IP', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post('/admin/login').set(ip(`9.9.9.${i}`)).send({ email: 'Boss@X.com', password: 'bad' })).status).toBe(401)
    }
    // email match is case-insensitive, and a brand-new IP does not escape it
    expect((await request(app).post('/admin/login').set(ip('9.9.9.99')).send({ email: 'boss@x.com', password: 'right' })).status).toBe(429)
    // another account from the same IPs is unaffected
    expect((await request(app).post('/admin/login').set(ip('9.9.9.98')).send({ email: 'other@x.com', password: 'right' })).status).toBe(200)
  })
})

describe('admin TOTP step', () => {
  it('allows 5 wrong codes per admin, then blocks, and a fresh pending token does not reset it', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/admin/totp-verify').set(ip(`2.2.2.${i}`)).send({ pendingToken: 'pending-7', code: '000000' })).status).toBe(401)
    }
    const r = await request(app).post('/admin/totp-verify').set(ip('2.2.2.50')).send({ pendingToken: 'pending-7', code: '123456' })
    expect(r.status).toBe(429)
    // a different admin is not affected
    expect((await request(app).post('/admin/totp-verify').set(ip('2.2.2.51')).send({ pendingToken: 'pending-8', code: '123456' })).status).toBe(200)
  })
})

describe('OTP, refresh and /me', () => {
  it('OTP allows 30 per minute per IP, then blocks', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await request(app).post('/otp/verify').set(ip('3.3.3.3')).send({ otp: 'right' })).status).toBe(200)
    }
    expect((await request(app).post('/otp/verify').set(ip('3.3.3.3')).send({ otp: 'right' })).status).toBe(429)
    expect((await request(app).post('/otp/verify').set(ip('3.3.3.4')).send({ otp: 'right' })).status).toBe(200)
  })

  it('refresh allows 60 per minute per IP (a whole NAT refreshing after a deploy), then blocks', async () => {
    for (let i = 0; i < 60; i++) expect((await request(app).post('/refresh').set(ip('4.4.4.4')).send({})).status).toBe(200)
    expect((await request(app).post('/refresh').set(ip('4.4.4.4')).send({})).status).toBe(429)
  })

  it('/me is not on any auth limiter, so page loads never lock anyone out', async () => {
    for (let i = 0; i < 100; i++) expect((await request(app).get('/me').set(ip('5.5.5.5'))).status).toBe(200)
  })
})

describe('public admin-invite endpoints', () => {
  it('verify: counts only FAILED lookups per IP (people opening their own link are never slowed), the 21st bad one is throttled', async () => {
    for (let i = 0; i < 40; i++) {
      expect((await request(app).get('/invite/verify').set(ip('5.5.5.5')).query({ token: 'good' })).status).toBe(200)
    }
    for (let i = 0; i < 20; i++) {
      expect((await request(app).get('/invite/verify').set(ip('5.5.5.5')).query({ token: `guess${i}` })).status).toBe(400)
    }
    const blocked = await request(app).get('/invite/verify').set(ip('5.5.5.5')).query({ token: 'guess-more' })
    expect(blocked.status).toBe(429)
    expect(blocked.body.code).toBe('RATE_LIMIT_EXCEEDED')
    expect((await request(app).get('/invite/verify').set(ip('6.6.6.6')).query({ token: 'good' })).status).toBe(200) // another address is unaffected
  })

  it('redeem: counts only failed attempts per IP, the 11th is throttled, and a good one is never counted', async () => {
    for (let i = 0; i < 15; i++) {
      expect((await request(app).post('/invite/redeem').set(ip('7.7.7.7')).send({ password: 'right' })).status).toBe(200)
    }
    for (let i = 0; i < 10; i++) {
      expect((await request(app).post('/invite/redeem').set(ip('7.7.7.7')).send({ password: 'bad' })).status).toBe(401)
    }
    expect((await request(app).post('/invite/redeem').set(ip('7.7.7.7')).send({ password: 'bad' })).status).toBe(429)
  })
})
