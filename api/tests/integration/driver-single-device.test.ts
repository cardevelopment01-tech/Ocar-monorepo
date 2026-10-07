import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import http from 'http'
import path from 'path'
import { createRequire } from 'module'
import type { AddressInfo } from 'net'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { initSocketServer } from '@/websocket/socket.server'

// socket.io-client isn't an api dependency; borrow the driver web app's copy.
const { io } = createRequire(path.resolve(__dirname, '../../../apps/driver/package.json'))('socket.io-client') as typeof import('socket.io-client')

const app = createApp()
const PHONE = '+919900000771'

async function loginDriver() {
  await redis.del(`otp_rate:driver:${PHONE}:login`, `otp:driver:${PHONE}:login`)
  const otpRes = await request(app).post('/api/v1/auth/otp/request').send({ phone: PHONE, role: 'driver' })
  const verify = await request(app).post('/api/v1/auth/otp/verify').send({ phone: PHONE, otp: otpRes.body.otp, role: 'driver' })
  expect(verify.status).toBeLessThan(300)
  return { tokens: verify.body.tokens as { accessToken: string; refreshToken: string }, id: verify.body.principal.id as string }
}
const me = (t: string) => request(app).get('/api/v1/drivers/me').set('Authorization', `Bearer ${t}`)

afterAll(async () => {
  await pool.query(`DELETE FROM refresh_tokens WHERE principal_role='driver' AND principal_id IN (SELECT id FROM drivers WHERE phone=$1)`, [PHONE])
  await pool.query(`DELETE FROM drivers WHERE phone=$1`, [PHONE])
  await pool.end()
  redis.disconnect()
})

describe('driver single-device login', () => {
  it('second login kills the first device (REST, refresh, push tokens, socket)', async () => {
    const server = http.createServer(app)
    initSocketServer(server)
    await new Promise<void>((r) => server.listen(0, r))
    const url = `http://localhost:${(server.address() as AddressInfo).port}`

    const a = await loginDriver()
    expect((await me(a.tokens.accessToken)).status).toBe(200)
    await pool.query(
      `INSERT INTO device_tokens (owner_type, owner_id, token, platform, last_seen_at) VALUES ('driver',$1,'fcm-old','android',now())`, [a.id])

    const sockA = io(url, { auth: { token: a.tokens.accessToken }, transports: ['websocket'] })
    await new Promise<void>((r, j) => { sockA.on('connect', () => r()); sockA.on('connect_error', j) })
    const replaced = new Promise<void>((r) => sockA.on('session:replaced', () => r()))
    const disconnected = new Promise<void>((r) => sockA.on('disconnect', () => r()))

    const b = await loginDriver()

    await Promise.all([replaced, disconnected])
    const oldMe = await me(a.tokens.accessToken)
    expect(oldMe.status).toBe(401)
    expect(oldMe.body.code).toBe('AUTH_SESSION_REPLACED')
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: a.tokens.refreshToken })).status).toBe(401)
    expect((await pool.query(`SELECT 1 FROM device_tokens WHERE owner_type='driver' AND owner_id=$1`, [a.id])).rowCount).toBe(0)

    // old token can't reconnect a socket either
    const sockOld = io(url, { auth: { token: a.tokens.accessToken }, transports: ['websocket'], reconnection: false })
    const err = await new Promise<Error>((r) => sockOld.on('connect_error', r))
    expect(err.message).toBe('AUTH_SESSION_REPLACED')
    sockOld.close()

    // new device keeps working, including after a token refresh
    expect((await me(b.tokens.accessToken)).status).toBe(200)
    const ref = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: b.tokens.refreshToken })
    expect(ref.status).toBe(200)
    expect((await me(ref.body.tokens.accessToken)).status).toBe(200)

    sockA.close()
    await new Promise((r) => server.close(r))
  })
})
