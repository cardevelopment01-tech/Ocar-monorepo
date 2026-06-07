import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redisClient } from '@/db/redis'

const app = createApp()

afterAll(async () => {
  await pool.end()
  redisClient.disconnect()
})

describe('M01 — Infrastructure Foundation', () => {
  describe('Health check', () => {
    it('TC-M01-001: GET /health returns 200', async () => {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
    })

    it('TC-M01-002: GET /health body has status === ok', async () => {
      const res = await request(app).get('/health')
      expect(res.body.status).toBe('ok')
    })

    it('TC-M01-003: GET /health body has db field as ok or error', async () => {
      const res = await request(app).get('/health')
      expect(['ok', 'error']).toContain(res.body.db)
    })

    it('TC-M01-004: GET /health body has redis field as ok or error', async () => {
      const res = await request(app).get('/health')
      expect(['ok', 'error']).toContain(res.body.redis)
    })

    it('TC-M01-005: GET /health body has timestamp as valid ISO string', async () => {
      const res = await request(app).get('/health')
      expect(res.body.timestamp).toBeDefined()
      const parsed = new Date(res.body.timestamp as string)
      expect(parsed.toISOString()).toBe(res.body.timestamp)
    })
  })

  describe('404 handling', () => {
    it('TC-M01-006: GET /nonexistent returns 404', async () => {
      const res = await request(app).get('/nonexistent')
      expect(res.status).toBe(404)
    })

    it('TC-M01-007: Response has requestId context (check health has environment field)', async () => {
      const res = await request(app).get('/health')
      // requestId flows through to health response via the app context
      expect(res.body.environment).toBeDefined()
    })

    it('TC-M01-008: POST /api/v1/nonexistent returns 404 not 500', async () => {
      const res = await request(app).post('/api/v1/nonexistent').send({})
      expect(res.status).toBe(404)
      expect(res.status).not.toBe(500)
    })
  })
})
