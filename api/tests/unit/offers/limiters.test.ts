import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@/config', () => ({ config: { NODE_ENV: 'test' } }))
vi.mock('@/db/redis', () => ({ client: { call: vi.fn() }, withTimeout: (p: Promise<unknown>) => p }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { makeOffersCodeGuessLimiters, makeOffersPreviewLimiter } from '@/middleware/rateLimit.middleware'

// Switched on (skip = false) with the in-memory store, so the counting rules themselves are what is tested.
// Value: protects=the 61st preview and the 11th wrong code are refused, correct previews never count against guessing;
// fails_when=a limit, window or the failed-only counting changes; why_new=route tests mock the limiters;
// seam=skip injectable; no_claim=the Redis store (memory store here).

describe('offers limiters', () => {
  it('refuses the 61st preview in a minute with 429', async () => {
    const app = express()
    app.use(makeOffersPreviewLimiter(() => false))
    app.post('/p', (_q, r) => r.json({ ok: true }))
    for (let i = 0; i < 60; i++) expect((await request(app).post('/p')).status).toBe(200)
    const res = await request(app).post('/p')
    expect(res.status).toBe(429)
    expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('refuses the 11th WRONG code with 429 and Retry-After, and never counts successful previews', async () => {
    const app = express()
    app.use(express.json())
    app.use(...makeOffersCodeGuessLimiters(() => false))
    app.post('/p', (req, res) => {
      res.locals['codeGuessFailed'] = req.body.wrong === true
      res.json({ ok: true })
    })
    for (let i = 0; i < 25; i++) expect((await request(app).post('/p').send({ wrong: false })).status).toBe(200) // 25 good previews: free
    for (let i = 0; i < 10; i++) expect((await request(app).post('/p').send({ wrong: true })).status).toBe(200)
    const res = await request(app).post('/p').send({ wrong: true })
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBeDefined()
  })
})
