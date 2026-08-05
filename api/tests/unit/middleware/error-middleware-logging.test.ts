import { describe, it, expect } from 'vitest'
import express from 'express'
import pinoHttp from 'pino-http'
import pino from 'pino'
import request from 'supertest'
import { errorMiddleware } from '@/middleware/error.middleware'

// Regression test for the pino-http + error-middleware wiring: a 5xx must
// produce exactly ONE structured log line, carrying the real error's
// message/stack — not pino-http's generic "failed with status code 500"
// placeholder, and not two lines (one generic + one explicit).
describe('error middleware structured logging (5xx)', () => {
  it('logs exactly one line with the real error message for a thrown 500', async () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const logger = pino({ level: 'info' }, stream)

    const app = express()
    app.use((req, _res, next) => {
      ;(req as express.Request & { requestId: string }).requestId = 'test-req-id'
      next()
    })
    app.use(pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request & { requestId: string }).requestId,
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error'
        if (res.statusCode >= 400) return 'warn'
        return 'info'
      },
    }))
    app.get('/boom', () => {
      throw new Error('specific real failure detail')
    })
    app.use(errorMiddleware)

    await request(app).get('/boom').expect(500)

    // Exactly one log line for the whole request — not pino-http's generic
    // auto-log PLUS a separate explicit error-middleware log line.
    expect(lines.length).toBe(1)

    const logged = JSON.parse(lines[0]!)
    expect(logged.level).toBe(50) // pino 'error' level
    expect(logged.err.message).toBe('specific real failure detail')
    expect(logged.err.stack).toContain('specific real failure detail')
  })

  it('does not touch res.err for 4xx errors (validation etc.)', async () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const logger = pino({ level: 'info' }, stream)

    const app = express()
    app.use((req, _res, next) => {
      ;(req as express.Request & { requestId: string }).requestId = 'test-req-id-2'
      next()
    })
    app.use(pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request & { requestId: string }).requestId,
      customLogLevel: (_req, res, err) => {
        if (res.statusCode >= 500 || err) return 'error'
        if (res.statusCode >= 400) return 'warn'
        return 'info'
      },
    }))
    app.get('/dup', () => {
      const err = Object.assign(new Error('dup'), { code: '23505' })
      throw err
    })
    app.use(errorMiddleware)

    await request(app).get('/dup').expect(409)

    expect(lines.length).toBe(1)
    const logged = JSON.parse(lines[0]!)
    expect(logged.level).toBe(40) // warn, not error — 4xx path untouched
    expect(logged.err).toBeUndefined()
  })
})
