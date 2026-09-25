import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { errorMiddleware } from '@/middleware/error.middleware'

// body-parser (express.json) rejects with its own errors carrying `status` /
// `type` — not this app's `httpStatus` convention. They used to fall through to
// the generic 500 branch: an oversized or malformed body was reported as a
// server fault (and error-logged) instead of a client error.
function appWithJsonLimit(limit: string) {
  const app = express()
  app.use((req, _res, next) => {
    ;(req as express.Request & { requestId: string }).requestId = 'test-req'
    next()
  })
  app.use(express.json({ limit }))
  app.post('/echo', (req, res) => { res.json(req.body) })
  app.use(errorMiddleware)
  return app
}

describe('errorMiddleware — body-parser client errors', () => {
  it('returns 413 with a safe code for a body over the limit', async () => {
    const res = await request(appWithJsonLimit('1kb'))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ pad: 'x'.repeat(5_000) }))
    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', requestId: 'test-req' })
    expect(typeof res.body.error).toBe('string')
  })

  it('returns 400 for malformed JSON without echoing the parser message', async () => {
    const res = await request(appWithJsonLimit('1kb'))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"a": secret-token-here')
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'INVALID_JSON', requestId: 'test-req' })
    // The raw parser message quotes the offending input — never reflect it.
    expect(JSON.stringify(res.body)).not.toContain('secret-token-here')
  })

  it('still returns 500 for an unclassified error (behavior unchanged)', async () => {
    const app = express()
    app.get('/boom', () => { throw new Error('real failure') })
    app.use(errorMiddleware)
    await request(app).get('/boom').expect(500)
  })

  it('does not treat a random error carrying a 4xx `status` as a client error', async () => {
    // Only recognized body-parser error types are mapped; anything else that
    // happens to have a `status` field stays a 500 rather than trusting it.
    const app = express()
    app.get('/odd', () => { throw Object.assign(new Error('odd'), { status: 418 }) })
    app.use(errorMiddleware)
    await request(app).get('/odd').expect(500)
  })
})
