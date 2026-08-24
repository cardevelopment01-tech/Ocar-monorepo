import crypto from 'crypto'
import { client as redis } from '@/db/redis'
import {
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_LOCK_DURATION_MINUTES,
  OTP_RATE_LIMIT_WINDOW_MINUTES,
  OTP_RATE_LIMIT_MAX_REQUESTS,
  RIDE_OTP_MAX_ATTEMPTS,
  RIDE_OTP_LOCKOUT_SECONDS,
} from '@/constants/limits'
import { sha256 } from '@/lib/hash'
import { httpError } from '@/lib/errors'
import type { OtpPurpose, PrincipalRole } from '@/constants/enums'

interface OtpState {
  hash: string
  attempts: number
  lockedUntil: string | null
  expiresAt: string
}

export function generateOtp(length: number = OTP_LENGTH): string {
  return String(crypto.randomInt(0, 10 ** length)).padStart(length, '0')
}

export function hashOtp(otp: string): string {
  return sha256(otp)
}

export function otpRedisKey(phone: string, purpose: OtpPurpose, role: PrincipalRole): string {
  return `otp:${role}:${phone}:${purpose}`
}

export function rateLimitRedisKey(phone: string, purpose: OtpPurpose, role: PrincipalRole): string {
  return `otp_rate:${role}:${phone}:${purpose}`
}

export async function storeOtp(
  phone: string,
  purpose: OtpPurpose,
  role: PrincipalRole,
  otp: string
): Promise<void> {
  const state: OtpState = {
    hash: hashOtp(otp),
    attempts: 0,
    lockedUntil: null,
    expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
  }
  await redis.set(otpRedisKey(phone, purpose, role), JSON.stringify(state), 'EX', OTP_TTL_SECONDS)
}

export async function consumeOtp(
  phone: string,
  purpose: OtpPurpose,
  role: PrincipalRole,
  otp: string
): Promise<{ success: boolean; expired?: boolean; locked?: boolean; attemptsLeft?: number }> {
  const key = otpRedisKey(phone, purpose, role)
  const raw = await redis.get(key)

  if (!raw) return { success: false, expired: true }

  const state = JSON.parse(raw) as OtpState
  const now = Date.now()

  if (state.lockedUntil && new Date(state.lockedUntil).getTime() > now) {
    return { success: false, locked: true }
  }

  if (new Date(state.expiresAt).getTime() <= now) {
    await redis.del(key)
    return { success: false, expired: true }
  }

  if (hashOtp(otp) !== state.hash) {
    const newAttempts = state.attempts + 1
    if (newAttempts >= OTP_MAX_ATTEMPTS) {
      const lockUntil = new Date(now + OTP_LOCK_DURATION_MINUTES * 60 * 1000).toISOString()
      const locked: OtpState = { ...state, attempts: newAttempts, lockedUntil: lockUntil }
      await redis.set(key, JSON.stringify(locked), 'EX', OTP_LOCK_DURATION_MINUTES * 60)
      return { success: false, locked: true, attemptsLeft: 0 }
    }
    const remaining = Math.max(1, Math.ceil((new Date(state.expiresAt).getTime() - now) / 1000))
    await redis.set(key, JSON.stringify({ ...state, attempts: newAttempts }), 'EX', remaining)
    return { success: false, attemptsLeft: OTP_MAX_ATTEMPTS - newAttempts }
  }

  await redis.del(key)
  return { success: true }
}

export async function isVerifyLocked(
  phone: string,
  purpose: OtpPurpose,
  role: PrincipalRole
): Promise<boolean> {
  const key = otpRedisKey(phone, purpose, role)
  const raw = await redis.get(key)
  if (!raw) return false
  const state = JSON.parse(raw) as OtpState
  return !!(state.lockedUntil && new Date(state.lockedUntil).getTime() > Date.now())
}

export async function checkRateLimit(
  phone: string,
  purpose: OtpPurpose,
  role: PrincipalRole
): Promise<{ allowed: boolean; remaining: number }> {
  const key = rateLimitRedisKey(phone, purpose, role)
  const count = await redis.incr(key)
  if (count === 1) {
    await redis.expire(key, OTP_RATE_LIMIT_WINDOW_MINUTES * 60)
  }
  return {
    allowed: count <= OTP_RATE_LIMIT_MAX_REQUESTS,
    remaining: Math.max(0, OTP_RATE_LIMIT_MAX_REQUESTS - count),
  }
}

// Ride OTP brute-force limiter. Same fixed-window-counter shape as
// checkRateLimit above (INCR, EXPIRE only on the first increment) — one mental
// model for "OTP attempt limiting" in this codebase. Unlike consumeOtp this
// only tracks the COUNTER; the OTP hash stays in the rides row. Returns the
// current attempt number so callers can record a truthful attempt_number in
// ride_otp_events instead of a hardcoded 1.
export async function checkRideOtpAttempts(
  rideId: bigint,
  otpType: 'start' | 'end'
): Promise<number> {
  const key = `ride:otp:attempts:${rideId}:${otpType}`
  const attempts = await redis.incr(key)
  if (attempts === 1) await redis.expire(key, RIDE_OTP_LOCKOUT_SECONDS)
  if (attempts > RIDE_OTP_MAX_ATTEMPTS) {
    throw httpError(429, 'Too many incorrect attempts. Try again later.', 'RIDE_OTP_LOCKED')
  }
  return attempts
}

export async function clearRideOtpAttempts(
  rideId: bigint,
  otpType: 'start' | 'end'
): Promise<void> {
  await redis.del(`ride:otp:attempts:${rideId}:${otpType}`)
}
