import crypto from 'crypto'
import { client as redis } from '@/db/redis'
import { withTimeout } from '@/lib/with-timeout'
import {
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_LOCK_DURATION_MINUTES,
  OTP_RATE_LIMIT_WINDOW_MINUTES,
  OTP_RATE_LIMIT_MAX_REQUESTS,
  RIDE_OTP_MAX_ATTEMPTS,
  RIDE_OTP_LOCKOUT_SECONDS,
  RIDE_OTP_LENGTH,
} from '@/constants/limits'
import { config } from '@/config'
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

// Ride end PIN, recomputable from the ride id + a server secret so it can never be "lost" (Redis eviction,
// TTL, restart). Still only the SHA-256 hash is stored in rides.end_otp_hash; unpredictable without the secret.
export function deriveRideEndOtp(rideId: bigint, length: number = RIDE_OTP_LENGTH): string {
  const mac = crypto.createHmac('sha256', config.JWT_REFRESH_SECRET).update(`ride-end-otp:${rideId}`).digest()
  return String(mac.readUInt32BE(0) % 10 ** length).padStart(length, '0')
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

// Fixed-window counter in ONE round trip: INCR and TTL run in a single MULTI. A key with no TTL (just created by
// this INCR, or left behind by the old INCR-then-EXPIRE code after a crash) gets its expiry set right away, so a
// counter can never become permanent: if the process dies between the two steps, the very next hit repairs it.
async function incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
  const replies = await withTimeout(redis.multi().incr(key).ttl(key).exec())
  // These counters gate brute-force protection, so anything but a clean answer must THROW. exec() resolves with
  // null when the transaction was discarded and with [Error, null] tuples when a queued command failed; reading
  // those as "0 attempts" made every limiter fail open (the old direct INCR threw on error).
  if (!replies) throw new Error('redis counter transaction was discarded')
  for (const [err] of replies) if (err) throw err
  const count = Number(replies[0]?.[1])
  if (!Number.isFinite(count)) throw new Error('redis counter returned a non-numeric count')
  const ttl = Number(replies[1]?.[1] ?? -1)
  if (ttl < 0) await withTimeout(redis.expire(key, ttlSeconds))
  return count
}

const otpAttemptsKey = (phone: string, purpose: OtpPurpose, role: PrincipalRole) => `otp_attempts:${role}:${phone}:${purpose}`
const otpLockKey = (phone: string, purpose: OtpPurpose, role: PrincipalRole) => `otp_lock:${role}:${phone}:${purpose}`

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
  // The guess counter (otp_attempts:*) is deliberately NOT reset here. It used to live inside this value and
  // reset with every new code, so requesting a fresh OTP (10 per window) bought another 10 guesses each time.
  await withTimeout(redis.set(otpRedisKey(phone, purpose, role), JSON.stringify(state), 'EX', OTP_TTL_SECONDS))
}

// Guess accounting is a separate counter bumped with INCR, which Redis serialises: N parallel verify requests
// receive N distinct attempt numbers, so no more than OTP_MAX_ATTEMPTS guesses are ever evaluated per window.
// (Previously a GET -> compare -> SET sequence let parallel requests all read "0 attempts" and each get a free
// guess.) Consuming a correct code is claimed with DEL, so two parallel correct submissions cannot both succeed.
export async function consumeOtp(
  phone: string,
  purpose: OtpPurpose,
  role: PrincipalRole,
  otp: string
): Promise<{ success: boolean; expired?: boolean; locked?: boolean; attemptsLeft?: number }> {
  const key = otpRedisKey(phone, purpose, role)
  const attemptsKey = otpAttemptsKey(phone, purpose, role)
  const lockKey = otpLockKey(phone, purpose, role)

  if (await isVerifyLocked(phone, purpose, role)) return { success: false, locked: true }

  const raw = await withTimeout(redis.get(key))
  if (!raw) return { success: false, expired: true }

  const state = JSON.parse(raw) as OtpState
  if (new Date(state.expiresAt).getTime() <= Date.now()) {
    await withTimeout(redis.del(key))
    return { success: false, expired: true }
  }

  const attempts = await incrWithTtl(attemptsKey, OTP_LOCK_DURATION_MINUTES * 60)
  if (attempts > OTP_MAX_ATTEMPTS) {
    await withTimeout(redis.set(lockKey, '1', 'EX', OTP_LOCK_DURATION_MINUTES * 60))
    return { success: false, locked: true, attemptsLeft: 0 }
  }

  if (hashOtp(otp) !== state.hash) {
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await withTimeout(redis.set(lockKey, '1', 'EX', OTP_LOCK_DURATION_MINUTES * 60))
      return { success: false, locked: true, attemptsLeft: 0 }
    }
    return { success: false, attemptsLeft: OTP_MAX_ATTEMPTS - attempts }
  }

  if ((await withTimeout(redis.del(key))) !== 1) return { success: false, expired: true } // lost a parallel race
  await withTimeout(redis.del(attemptsKey))
  return { success: true }
}

export async function isVerifyLocked(
  phone: string,
  purpose: OtpPurpose,
  role: PrincipalRole
): Promise<boolean> {
  if ((await withTimeout(redis.exists(otpLockKey(phone, purpose, role)))) === 1) return true
  // Codes issued before this change carried their lock inside the stored value; honour those until they expire.
  const raw = await withTimeout(redis.get(otpRedisKey(phone, purpose, role)))
  if (!raw) return false
  const state = JSON.parse(raw) as OtpState
  return !!(state.lockedUntil && new Date(state.lockedUntil).getTime() > Date.now())
}

export async function checkRateLimit(
  phone: string,
  purpose: OtpPurpose,
  role: PrincipalRole
): Promise<{ allowed: boolean; remaining: number }> {
  const count = await incrWithTtl(rateLimitRedisKey(phone, purpose, role), OTP_RATE_LIMIT_WINDOW_MINUTES * 60)
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
  const attempts = await incrWithTtl(key, RIDE_OTP_LOCKOUT_SECONDS)
  if (attempts > RIDE_OTP_MAX_ATTEMPTS) {
    throw httpError(429, 'Too many incorrect attempts. Try again later.', 'RIDE_OTP_LOCKED')
  }
  return attempts
}

export async function clearRideOtpAttempts(
  rideId: bigint,
  otpType: 'start' | 'end'
): Promise<void> {
  await withTimeout(redis.del(`ride:otp:attempts:${rideId}:${otpType}`))
}
