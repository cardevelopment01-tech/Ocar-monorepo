import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { Router } from 'express'
import request from 'supertest'

// metrics.ts pulls in the database client (config validation); only the histogram is needed here.
const observe = vi.hoisted(() => vi.fn())
vi.mock('@/observability/metrics', () => ({ httpRequestDuration: { observe } }))

import { httpMetricsMiddleware } from './http-metrics'

// A real Express app with a NESTED router and an app-level error middleware, which is the shape that lost the prefix.
function makeApp() {
  const app = express()
  app.use(httpMetricsMiddleware)
  const drivers = Router()
  drivers.get('/me', (_req, res) => { res.json({ ok: true }) })
  drivers.get('/boom', (_req, _res, next) => { next(new Error('canceling statement due to statement timeout')) })
  drivers.get('/:id', (req, res) => { res.json({ id: req.params['id'] }) })
  app.use('/api/v1/drivers', drivers)
  app.use(((err, _req, res, _next) => { res.status(503).json({ error: String(err) }) }) as express.ErrorRequestHandler)
  return app
}

describe('httpMetricsMiddleware route label', () => {
  beforeEach(() => observe.mockClear())

  const lastLabels = () => observe.mock.calls[observe.mock.calls.length - 1]![0] as Record<string, string>

  it('labels a normal request with the full mounted path', async () => {
    await request(makeApp()).get('/api/v1/drivers/me').expect(200)
    expect(lastLabels()).toMatchObject({ method: 'GET', route: '/api/v1/drivers/me', status_code: '200' })
  })

  it('keeps the full path when the handler fails and the error middleware answers (was "/boom")', async () => {
    await request(makeApp()).get('/api/v1/drivers/boom').expect(503)
    expect(lastLabels()).toMatchObject({ route: '/api/v1/drivers/boom', status_code: '503' })
  })

  it('uses the route pattern, not the raw URL, for parameterised routes', async () => {
    await request(makeApp()).get('/api/v1/drivers/12345').expect(200)
    expect(lastLabels().route).toBe('/api/v1/drivers/:id')
  })

  it('labels an unmatched request "unmatched"', async () => {
    await request(makeApp()).get('/nope').expect(404)
    expect(lastLabels().route).toBe('unmatched')
  })
})
