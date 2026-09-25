import { describe, it, expect } from 'vitest'
import express from 'express'
import zlib from 'node:zlib'
import request from 'supertest'
import { compressResponses } from '@/middleware/compression.middleware'

// Big, repetitive JSON — the shape of admin list / analytics payloads.
const big = { rows: Array.from({ length: 200 }, (_, i) => ({ id: i, status: 'completed', city: 'Bhubaneswar' })) }
const bigJson = JSON.stringify(big)

const app = express()
app.use(compressResponses)
app.get('/api/v1/rides', (_req, res) => { res.json(big) })
app.get('/api/v1/auth/session', (_req, res) => { res.json(big) })
app.get('/health', (_req, res) => { res.json(big) })
app.get('/api/v1/tiny', (_req, res) => { res.json({ ok: true }) })

// Collect the raw wire bytes so we assert on what the client actually receives.
function raw(path: string, acceptEncoding: string) {
  return request(app).get(path).set('Accept-Encoding', acceptEncoding)
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
}

describe('compressResponses', () => {
  it('serves Brotli when the client accepts it, and it round-trips', async () => {
    const res = await raw('/api/v1/rides', 'gzip, deflate, br')
    expect(res.headers['content-encoding']).toBe('br')
    expect(res.headers['vary']).toMatch(/Accept-Encoding/i)
    const body = res.body as Buffer
    expect(body.length).toBeLessThan(bigJson.length / 5)
    expect(zlib.brotliDecompressSync(body).toString()).toBe(bigJson)
  })

  it('falls back to gzip for clients without br (Android OkHttp)', async () => {
    const res = await raw('/api/v1/rides', 'gzip')
    expect(res.headers['content-encoding']).toBe('gzip')
    // superagent transparently gunzips before our parser runs (it doesn't for br)
    expect((res.body as Buffer).toString()).toBe(bigJson)
  })

  it.each(['/api/v1/auth/session', '/health'])('never compresses %s', async (path) => {
    const res = await raw(path, 'gzip, br')
    expect(res.headers['content-encoding']).toBeUndefined()
  })

  it('leaves responses under the 1 KB threshold raw', async () => {
    const res = await raw('/api/v1/tiny', 'gzip, br')
    expect(res.headers['content-encoding']).toBeUndefined()
  })
})
