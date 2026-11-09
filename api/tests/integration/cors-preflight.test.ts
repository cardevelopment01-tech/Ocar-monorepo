import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'

// Value: protects=browsers caching the CORS preflight (the admin polls every 30 s); fails_when=maxAge is dropped and every call
// pays an extra OPTIONS round trip again; why_new=measured ~60-80 ms per call; seam=real app; no_claim=browser caching itself.
describe('CORS preflight', () => {
  it('tells browsers to cache it for two hours', async () => {
    const origin = (process.env['ALLOWED_ORIGINS'] ?? '').split(',')[0]!.trim() || 'http://localhost:3000'
    const res = await request(createApp()).options('/api/v1/auth/refresh').set('Origin', origin).set('Access-Control-Request-Method', 'POST')
    expect(res.headers['access-control-max-age']).toBe('7200')
  })
})
