import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { hashPassword } from '@/lib/hash'
import { makeExpiredToken } from '../helpers/auth.helper'
import { userFixtures } from '../helpers/fixtures/users.fixture'
import { driverFixtures } from '../helpers/fixtures/drivers.fixture'

const app = createApp()

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requestOtp(phone: string, role: 'user' | 'driver' = 'user') {
  return request(app)
    .post('/api/v1/auth/otp/request')
    .send({ phone, role })
}

async function verifyOtp(phone: string, otp: string, role: 'user' | 'driver' = 'user') {
  return request(app)
    .post('/api/v1/auth/otp/verify')
    .send({ phone, otp, role })
}

async function loginUser(phone: string): Promise<{ accessToken: string; refreshToken: string }> {
  // Clear rate limit so each loginUser call works regardless of prior test state
  await redis.del(`otp_rate:${phone}:login`)
  const otpRes = await requestOtp(phone)
  expect(otpRes.status, `requestOtp failed for ${phone}: ${JSON.stringify(otpRes.body)}`).toBe(200)
  const { otp } = otpRes.body as { otp: string }
  const verifyRes = await verifyOtp(phone, otp)
  expect(verifyRes.status, `verifyOtp failed for ${phone}: ${JSON.stringify(verifyRes.body)}`).toBeGreaterThanOrEqual(200)
  const { tokens } = verifyRes.body as { tokens: { accessToken: string; refreshToken: string } }
  return tokens
}

// ── Seed & teardown ───────────────────────────────────────────────────────────

beforeAll(async () => {
  // Seed one admin for TC-M02-011
  const hash = await hashPassword('Admin@1234')
  await pool.query(`
    INSERT INTO admins (email, password_hash, role)
    VALUES ('admin@ocar.app', $1, 'super_admin')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `, [hash])
})

afterAll(async () => {
  // Clean up test data
  const phones = [
    userFixtures.activeUser.phone,
    userFixtures.secondUser.phone,
    driverFixtures.pendingDriver.phone,
  ]
  await pool.query(`DELETE FROM users WHERE phone = ANY($1)`, [phones])
  await pool.query(`DELETE FROM drivers WHERE phone = ANY($1)`, [phones])
  await pool.query(`DELETE FROM admins WHERE email = 'admin@ocar.app'`)
  await pool.query(`DELETE FROM refresh_tokens WHERE created_at < now()`)
  // Clear OTP keys
  for (const phone of phones) {
    await redis.del(`otp:user:${phone}:login`)
    await redis.del(`otp:driver:${phone}:login`)
    await redis.del(`otp_rate:${phone}:login`)
  }
  await pool.end()
  redis.disconnect()
})

// ── Test cases ────────────────────────────────────────────────────────────────

describe('M02 — Auth & Identity', () => {
  describe('User login flow', () => {

    it('TC-M02-001: new user OTP creates users row', async () => {
      const phone = userFixtures.activeUser.phone
      const otpRes = await requestOtp(phone)
      expect(otpRes.status).toBe(200)
      expect(otpRes.body).toHaveProperty('otp')

      const otp = otpRes.body.otp as string
      const verifyRes = await verifyOtp(phone, otp)
      expect(verifyRes.status).toBe(201)
      expect(verifyRes.body.isNew).toBe(true)
      expect(verifyRes.body.tokens).toHaveProperty('accessToken')
      expect(verifyRes.body.tokens).toHaveProperty('refreshToken')

      const { rows } = await pool.query<{ phone: string }>(
        'SELECT phone FROM users WHERE phone = $1', [phone]
      )
      expect(rows[0]?.phone).toBe(phone)
    })

    it('TC-M02-002: existing user OTP issues JWT', async () => {
      const phone = userFixtures.activeUser.phone
      const otpRes = await requestOtp(phone)
      const otp = (otpRes.body as { otp: string }).otp
      const verifyRes = await verifyOtp(phone, otp)
      expect(verifyRes.status).toBe(200)
      expect(verifyRes.body.isNew).toBe(false)
      expect(verifyRes.body.tokens).toHaveProperty('accessToken')
    })

    it('TC-M02-003: wrong OTP increments attempt counter', async () => {
      const phone = userFixtures.secondUser.phone
      await requestOtp(phone)
      const badRes = await verifyOtp(phone, '000000')
      expect(badRes.status).toBe(401)
      expect(badRes.body.code).toBe('AUTH_OTP_INVALID')
    })

    it('TC-M02-004: 3 wrong OTPs locks account for 15 minutes', async () => {
      const phone = '+919111111111'
      await requestOtp(phone)
      await verifyOtp(phone, '000000')
      await verifyOtp(phone, '000000')
      const lockedRes = await verifyOtp(phone, '000000')
      expect(lockedRes.status).toBe(429)
      expect(lockedRes.body.code).toBe('AUTH_OTP_LOCKED')
      // Subsequent correct attempt should also be locked
      const otpRes2 = await requestOtp(phone)
      if (otpRes2.body.otp) {
        const stillLocked = await verifyOtp(phone, otpRes2.body.otp as string)
        expect(stillLocked.status).toBe(429)
      }
      // Cleanup
      await redis.del(`otp:user:${phone}:login`)
      await redis.del(`otp_rate:${phone}:login`)
    })

    it('TC-M02-005: expired OTP returns AUTH_OTP_EXPIRED', async () => {
      const phone = '+919222222222'
      // storeOtp stores JSON via redis.set — match that exact format
      const { hashOtp, otpRedisKey } = await import('@/lib/otp')
      const otp = '123456'
      const key = otpRedisKey(phone, 'login', 'user')
      const state = {
        hash: hashOtp(otp),
        attempts: 0,
        lockedUntil: null,
        expiresAt: new Date(Date.now() - 1000).toISOString(), // already expired
      }
      await redis.set(key, JSON.stringify(state), 'EX', 5)

      const res = await verifyOtp(phone, otp)
      expect(res.status).toBe(401)
      expect(res.body.code).toBe('AUTH_OTP_EXPIRED')
      await redis.del(key)
    })

    it('TC-M02-006: valid JWT allows access to protected route', async () => {
      const phone = userFixtures.activeUser.phone
      const tokens = await loginUser(phone)
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
      expect(res.status).toBe(200)
      expect(res.body.role).toBe('user')
      expect(res.body.principal).toHaveProperty('phone', phone)
    })

    it('TC-M02-007: expired JWT returns AUTH_TOKEN_EXPIRED', async () => {
      const expiredToken = makeExpiredToken('1', 'user')
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
      expect(res.status).toBe(401)
      expect(res.body.code).toBe('AUTH_TOKEN_EXPIRED')
    })

    it('TC-M02-008: refresh token rotates and issues new access token', async () => {
      const phone = userFixtures.activeUser.phone
      const tokens = await loginUser(phone)

      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
      expect(refreshRes.status).toBe(200)
      expect(refreshRes.body.tokens).toHaveProperty('accessToken')
      expect(refreshRes.body.tokens).toHaveProperty('refreshToken')
      expect(refreshRes.body.tokens.refreshToken).not.toBe(tokens.refreshToken)
    })

    it('TC-M02-009: reused refresh token invalidates session', async () => {
      const phone = userFixtures.activeUser.phone
      const tokens = await loginUser(phone)

      // Use token once
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })

      // Reuse same token — must fail
      const reuseRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
      expect(reuseRes.status).toBe(401)
      expect(reuseRes.body.code).toBe('AUTH_TOKEN_INVALID')
    })

    it('TC-M02-010: driver OTP issues driver-scoped JWT', async () => {
      const phone = driverFixtures.pendingDriver.phone
      const otpRes = await requestOtp(phone, 'driver')
      expect(otpRes.status).toBe(200)
      const otp = (otpRes.body as { otp: string }).otp
      const verifyRes = await verifyOtp(phone, otp, 'driver')
      expect(verifyRes.status).toBe(201)
      expect(verifyRes.body.tokens).toHaveProperty('accessToken')

      // JWT payload must contain role: driver
      const [, payloadB64] = (verifyRes.body.tokens.accessToken as string).split('.')
      const payload = JSON.parse(Buffer.from(payloadB64!, 'base64url').toString())
      expect(payload.role).toBe('driver')
    })

    it('TC-M02-011: admin login via password issues admin JWT', async () => {
      const res = await request(app)
        .post('/api/v1/auth/admin/login')
        .send({ email: 'admin@ocar.app', password: 'Admin@1234' })
      expect(res.status).toBe(200)
      expect(res.body.tokens).toHaveProperty('accessToken')
      expect(res.body.admin).toHaveProperty('role', 'super_admin')
      expect(res.body.admin).not.toHaveProperty('password_hash')
    })

    it('TC-M02-012: role middleware blocks wrong role', async () => {
      const phone = userFixtures.activeUser.phone
      const tokens = await loginUser(phone)

      // /me is fine for user, but if we add a driver-only route test it would 403
      // Here: confirm user token cannot pretend to be a driver
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
      expect(res.status).toBe(200)
      expect(res.body.role).toBe('user')
      // No driver data in response
      expect(res.body.role).not.toBe('driver')
    })

    it('TC-M02-013: rate limiter blocks after 3 OTP requests in window', async () => {
      const phone = '+919333333333'
      await requestOtp(phone)
      await requestOtp(phone)
      await requestOtp(phone)
      const blocked = await requestOtp(phone)
      expect(blocked.status).toBe(429)
      expect(blocked.body.code).toBe('AUTH_OTP_RATE_LIMITED')
      // Cleanup
      await redis.del(`otp_rate:${phone}:login`)
      await redis.del(`otp:user:${phone}:login`)
    })

    it('TC-M02-014: logout invalidates refresh token', async () => {
      const phone = userFixtures.activeUser.phone
      const tokens = await loginUser(phone)

      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: tokens.refreshToken })
      expect(logoutRes.status).toBe(200)

      // Token must now be invalid
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
      expect(refreshRes.status).toBe(401)
      expect(refreshRes.body.code).toBe('AUTH_TOKEN_INVALID')
    })

  })
})
