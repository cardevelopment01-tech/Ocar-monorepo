import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import express from 'express'
import pino from 'pino'
import pinoHttp from 'pino-http'
import request from 'supertest'
import { serializeReq, serializeRes, requestLogLevel, actorProps } from '@/observability/http-log'

// Runs requests through the real pino-http with the same options app.ts uses (trust proxy, serializers, level policy)
// and returns every line it logged.
function harness() {
  const lines: Array<{ level: number; req: Record<string, unknown>; res: { statusCode: number }; actor_role?: string; actor_id?: string }> = []
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()))
      cb()
    },
  })
  const app = express()
  app.set('trust proxy', 1)
  app.use(
    pinoHttp({
      logger: pino({ level: 'debug' }, sink),
      customLogLevel: requestLogLevel,
      customProps: actorProps,
      serializers: { req: serializeReq, res: serializeRes },
    }),
  )
  app.get('/x', (_req, res) => res.send('ok'))
  // authenticate() runs AFTER pino-http in the real app and sets one of these on the request
  app.get('/api/v1/me/user', (req, res) => { (req as unknown as { user: unknown }).user = { id: 42n }; res.json({}) })
  app.get('/api/v1/me/driver', (req, res) => { (req as unknown as { driver: unknown }).driver = { id: 7n }; res.json({}) })
  app.get('/api/v1/me/admin', (req, res) => { (req as unknown as { admin: unknown }).admin = { id: 3n }; res.json({}) })
  app.get('/api/v1/rides/me/active', (_req, res) => res.status(404).json({ code: 'NO_ACTIVE_RIDE' }))
  app.get('/api/v1/rides/:id', (_req, res) => res.status(404).json({ code: 'RIDE_NOT_FOUND' }))
  app.post('/api/v1/auth/otp/verify', (_req, res) => res.status(401).json({ code: 'INVALID_OTP' }))
  app.get('/api/v1/boom', (_req, res) => res.status(500).json({ code: 'INTERNAL_ERROR' }))
  app.get('/api/v1/admin/safety/sos', (_req, res) => res.json([]))
  app.get('/api/v1/notifications/unread-count', (_req, res) => res.json({ count: 0 }))
  const last = async () => {
    await new Promise((r) => setImmediate(r))
    return lines[lines.length - 1]!
  }
  return { app, last }
}

describe('request log line: client address and fields', () => {
  it('records the client address from X-Forwarded-For, not the proxy and not nothing', async () => {
    const { app, last } = harness()
    await request(app).get('/x').set('X-Forwarded-For', '203.0.113.9')
    expect((await last()).req['ip']).toBe('203.0.113.9')
  })

  it('still records an address when there is no proxy header', async () => {
    const { app, last } = harness()
    await request(app).get('/x')
    const ip = (await last()).req['ip']
    expect(typeof ip).toBe('string')
    expect(ip).not.toBe('')
  })

  it('keeps the user agent, drops the query string, and logs no headers', async () => {
    const { app, last } = harness()
    await request(app).get('/x?token=secret-invite').set('User-Agent', 'OcarDriver/1.4').set('Authorization', 'Bearer abc.def.ghi')
    const line = await last()
    expect(line.req['userAgent']).toBe('OcarDriver/1.4')
    expect(line.req['url']).toBe('/x')
    expect(JSON.stringify(line)).not.toContain('secret-invite')
    expect(JSON.stringify(line)).not.toContain('Bearer')
    expect(line.res.statusCode).toBe(200)
  })
})

describe('request log line: who made the request', () => {
  it('names the account when authentication happened later in the request', async () => {
    const { app, last } = harness()
    await request(app).get('/api/v1/me/user')
    expect(await last()).toMatchObject({ actor_role: 'user', actor_id: '42' })
    await request(app).get('/api/v1/me/driver')
    expect(await last()).toMatchObject({ actor_role: 'driver', actor_id: '7' })
    await request(app).get('/api/v1/me/admin')
    expect(await last()).toMatchObject({ actor_role: 'admin', actor_id: '3' })
  })

  it('leaves the actor out for anonymous requests (scanners, failed logins)', async () => {
    const { app, last } = harness()
    await request(app).get('/x')
    const line = await last()
    expect(line.actor_role).toBeUndefined()
    expect(line.actor_id).toBeUndefined()
  })
})

describe('request log line: level policy (warn means someone should look)', () => {
  const INFO = 30
  const WARN = 40
  const ERROR = 50
  const DEBUG = 20

  it('scanner probes (no route matched) are info, not warn', async () => {
    const { app, last } = harness()
    await request(app).get('/wp-login.php')
    const line = await last()
    expect(line.res.statusCode).toBe(404)
    expect(line.level).toBe(INFO)
  })

  it('the driver app\'s deliberate "no active ride" 404 is info, not warn', async () => {
    const { app, last } = harness()
    await request(app).get('/api/v1/rides/me/active')
    const line = await last()
    expect(line.res.statusCode).toBe(404)
    expect(line.level).toBe(INFO)
  })

  it('a 404 from a real route (a ride that does not exist) is still a warning', async () => {
    const { app, last } = harness()
    await request(app).get('/api/v1/rides/999')
    expect((await last()).level).toBe(WARN)
  })

  it('failed logins stay warnings and 5xx stay errors', async () => {
    const { app, last } = harness()
    await request(app).post('/api/v1/auth/otp/verify')
    expect((await last()).level).toBe(WARN)
    await request(app).get('/api/v1/boom')
    expect((await last()).level).toBe(ERROR)
  })

  it('polling endpoints are debug, normal successes are info', async () => {
    const { app, last } = harness()
    await request(app).get('/api/v1/admin/safety/sos')
    expect((await last()).level).toBe(DEBUG)
    await request(app).get('/api/v1/notifications/unread-count')
    expect((await last()).level).toBe(DEBUG)
    await request(app).get('/x')
    expect((await last()).level).toBe(INFO)
  })
})

// Guards against someone re-inlining the old behaviour in app.ts (a serializer that reads req.ip, or the old warn-on-every-404 rule).
describe('app.ts wiring', () => {
  const app = readFileSync(join(__dirname, '../../../src/app.ts'), 'utf8')
  it('uses the tested serializers and level policy', () => {
    expect(app).toContain('serializers: { req: serializeReq, res: serializeRes }')
    expect(app).toContain('customLogLevel: requestLogLevel')
    expect(app).toContain('customProps: actorProps')
    expect(app).not.toMatch(/ip:\s*req\.ip/)
  })
})
