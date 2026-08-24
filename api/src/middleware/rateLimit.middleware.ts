import { rateLimit } from 'express-rate-limit'
import { RedisStore, type RedisReply } from 'rate-limit-redis'
import type { Request } from 'express'
import { verifyAccessToken } from '@/lib/jwt'
import { client as redis, withTimeout } from '@/db/redis'
import { logger } from '@/lib/logger'

// Redis-backed store so limits are shared across all ASG instances instead
// of each instance counting independently -- an in-memory MemoryStore (the
// express-rate-limit default) would let the effective limit multiply by
// instance count, since the ALB has no session affinity. Separate prefix per
// limiter so they don't share counters despite different windows.
//
// Skipped entirely in tests: RedisStore loads Lua scripts into Redis at
// construction time, which would require a live Redis connection just to
// import this module -- unnecessary since skip: skipInTest already disables
// rate limiting per-request in tests, and a single test process has no
// multi-instance concern for the fallback MemoryStore to get wrong.
//
// sendCommand is bounded with withTimeout so a Redis outage rejects quickly
// instead of hanging the request indefinitely (the same class of bug fixed
// in the reference-data cache layer, but this runs on every request ahead
// of any route handler, so an unbounded hang here is worse). Paired with
// passOnStoreError below, a bounded rejection here becomes "allow the
// request through, skip rate limiting for this one" rather than either a
// hang or a hard failure -- rate limiting is an abuse-mitigation control,
// not a correctness-critical path, so failing open is the right tradeoff.
function redisStore(prefix: string): RedisStore | undefined {
  if (skipInTest()) return undefined
  return new RedisStore({
    prefix,
    sendCommand: async (...args: string[]) => {
      try {
        return (await withTimeout(
          redis.call(...(args as [string, ...string[]]))
        )) as RedisReply
      } catch (err) {
        logger.warn({ err, prefix }, 'rate-limit: redis command failed, allowing request through')
        throw err
      }
    },
  })
}

// Bypass IP-based limiters in test environment — tests use a shared localhost
// IP which would exhaust the window in a single suite. The OTP service's own
// Redis-based per-phone rate limiter still runs and is reset per test case.
const skipInTest = () => process.env['NODE_ENV'] === 'test'

// Key by the authenticated principal (driver/user/admin id) when the request
// carries a valid access token, falling back to IP for unauthenticated
// requests. This runs ahead of authenticate() in the pipeline, so it verifies
// the token itself rather than relying on req.user/driver/admin being set.
// Per-IP keying alone throttled two devices testing concurrently on the same
// Wi-Fi (rider + driver phones share one public IP) as if they were one
// client — a rider's booking traffic could exhaust the bucket a driver's
// location pings needed, and vice versa.
function principalKey(req: Request): string {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    try {
      const { sub, role } = verifyAccessToken(header.slice(7))
      return `${role}:${sub}`
    } catch {
      // fall through to IP keying below
    }
  }
  return req.ip ?? 'unknown'
}

// General API: 600 requests per minute per principal (or per IP if unauthenticated)
const generalLimiterOptions: Parameters<typeof rateLimit>[0] = {
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  passOnStoreError: true,
  keyGenerator: principalKey,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
}
const generalStore = redisStore('rl:general:')
if (generalStore !== undefined) generalLimiterOptions.store = generalStore
export const generalLimiter = rateLimit(generalLimiterOptions)

// Auth/OTP: 10 requests per minute per IP to limit brute-force
const authLimiterOptions: Parameters<typeof rateLimit>[0] = {
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  passOnStoreError: true,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
}
const authStore = redisStore('rl:auth:')
if (authStore !== undefined) authLimiterOptions.store = authStore
export const authLimiter = rateLimit(authLimiterOptions)

// Per (principal, ride) chat-send throttle. express-rate-limit is a fixed-window
// counter, so this caps ~5 sends/second/ride rather than a true "burst 5 then
// 1/sec" token bucket — close enough, and it reuses the existing middleware
// stack. ponytail: fixed-window approximation; swap for a Redis token-bucket
// (see the OTP rate limiter pattern in lib/otp.ts) only if abuse proves this too coarse.
const chatMessageLimiterOptions: Parameters<typeof rateLimit>[0] = {
  windowMs: 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  passOnStoreError: true,
  keyGenerator: (req) => `chat:${principalKey(req)}:${req.params['id'] ?? ''}`,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
}
const chatStore = redisStore('rl:chat:')
if (chatStore !== undefined) chatMessageLimiterOptions.store = chatStore
export const chatMessageLimiter = rateLimit(chatMessageLimiterOptions)

// Per (principal, ride) masked-call throttle — real phone calls cost real
// money per minute, so this is intentionally tighter than chat.
const maskedCallLimiterOptions: Parameters<typeof rateLimit>[0] = {
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  passOnStoreError: true,
  keyGenerator: (req) => `call:${principalKey(req)}:${req.params['id'] ?? ''}`,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
}
const callStore = redisStore('rl:call:')
if (callStore !== undefined) maskedCallLimiterOptions.store = callStore
export const maskedCallLimiter = rateLimit(maskedCallLimiterOptions)
