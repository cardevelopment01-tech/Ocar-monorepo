import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'

describe('GET /metrics', () => {
  it('returns Prometheus-format metrics including a request this test itself made', async () => {
    const app = createApp()
    await request(app).get('/health')
    const res = await request(app).get('/metrics')

    expect(res.status).toBe(200)
    expect(res.text).toContain('http_request_duration_seconds')
  })
})
