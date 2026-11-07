import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('@/config', () => ({ config: { NODE_ENV: 'test' } }))
vi.mock('@/db/redis', () => ({ client: { call: vi.fn() }, withTimeout: (p: Promise<unknown>) => p }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { makePublicTripLimiters } from '@/middleware/rateLimit.middleware'

// Value: protects=scanners are cut off after 20 wrong tries a minute from one IP, while many relatives watching one valid trip
// (even behind one IP) are never locked out, and one noisy link cannot starve another; fails_when=a limit, the miss-only counting
// or the per-token keying changes; why_new=new public endpoint (eng review D5); seam=skip injectable, in-memory store;
// no_claim=the Redis store and real carrier NAT.
function app(valid: (token: string) => boolean) {
  const a = express()
  const { misses, perToken } = makePublicTripLimiters(() => false)
  a.get('/t/:token', perToken, misses, (req, res) => {
    const ok = valid(req.params['token']!)
    res.locals['tripMiss'] = !ok
    res.status(ok ? 200 : 404).json({})
  })
  return a
}

describe('public trip limiters', () => {
  it('refuses the 21st WRONG lookup in a minute from one IP with 429, but never counts valid ones', async () => {
    const a = app((t) => t === 'good')
    for (let i = 0; i < 50; i++) expect((await request(a).get('/t/good')).status).toBe(200) // 50 valid polls: free
    for (let i = 0; i < 20; i++) expect((await request(a).get(`/t/bad${i}`)).status).toBe(404)
    const res = await request(a).get('/t/bad-final')
    expect(res.status).toBe(429)
    expect(res.headers['retry-after']).toBeDefined()
  })

  it('lets 15 viewers poll one valid link at once (180 a minute) and refuses the 181st request for that link', async () => {
    const a = app(() => true)
    for (let i = 0; i < 180; i++) expect((await request(a).get('/t/shared-link-token')).status).toBe(200)
    expect((await request(a).get('/t/shared-link-token')).status).toBe(429)
  })

  it('a noisy link does not starve another link from the same IP', async () => {
    const a = app(() => true)
    for (let i = 0; i < 180; i++) await request(a).get('/t/noisy-link-token')
    expect((await request(a).get('/t/noisy-link-token')).status).toBe(429)
    expect((await request(a).get('/t/another-link-token')).status).toBe(200)
  })
})
