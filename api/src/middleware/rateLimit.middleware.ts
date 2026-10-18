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
//
// rate-limit-redis issues two SCRIPT LOADs per store the moment the store is constructed, i.e. when this module is
// imported -- before the Redis (TLS) connection exists. ioredis would queue them and run them once connected, but on a
// cold-booted instance that takes ~2.5 s, so the 1 s bound above rejected all of them (7 stores x 2 scripts = 14 errors
// in the first second of some cold servers, logged as "unhandled promise rejection"). Nothing was lost -- the library
// reloads a script on the first real request -- but it is noise and a pointless extra round trip. SCRIPT LOAD runs
// once at startup and never on a request path, so it gets a longer bound; request-time commands keep the 1 s fail-open.
const SCRIPT_LOAD_TIMEOUT_MS = 15_000

export function makeStoreSendCommand(call: (...args: string[]) => Promise<unknown>, prefix: string) {
  return async (...args: string[]): Promise<RedisReply> => {
    const isScriptLoad = args[0]?.toUpperCase() === 'SCRIPT'
    try {
      return (await withTimeout(call(...args), isScriptLoad ? SCRIPT_LOAD_TIMEOUT_MS : undefined)) as RedisReply
    } catch (err) {
      logger.warn(
        { err, prefix },
        isScriptLoad
          ? 'rate-limit: script preload failed, it is reloaded on first use'
          : 'rate-limit: redis command failed, allowing request through',
      )
      throw err
    }
  }
}

function redisStore(prefix: string): RedisStore | undefined {
  if (skipInTest()) return undefined
  const store = new RedisStore({
    prefix,
    sendCommand: makeStoreSendCommand((...args) => redis.call(...(args as [string, ...string[]])), prefix),
  })
  // The library keeps these preload promises and awaits them on the first request, where a failure reloads the
  // script. Mark them handled so a failed preload is not also reported as an unhandled rejection.
  store.incrementScriptSha.catch(() => undefined)
  store.getScriptSha.catch(() => undefined)
  return store
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

// Google-backed geo endpoints (autocomplete, place, reverse, route): each call can cost real money, so they are
// throttled per principal well below the general 600/min. Autocomplete fires per keystroke, hence not tiny.
const geoLimiterOptions: Parameters<typeof rateLimit>[0] = {
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  passOnStoreError: true,
  keyGenerator: (req) => `geo:${principalKey(req)}`,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
}
const geoStore = redisStore('rl:geo:')
if (geoStore !== undefined) geoLimiterOptions.store = geoStore
export const geoLimiter = rateLimit(geoLimiterOptions)

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

// PayU SDK endpoints (hash signing / confirm): per principal, per minute.
function payuSdkLimiter(prefix: string, max: number) {
  const options: Parameters<typeof rateLimit>[0] = {
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInTest,
    passOnStoreError: true,
    keyGenerator: (req) => `${prefix}:${principalKey(req)}`,
    message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
  }
  const store = redisStore(`rl:${prefix}:`)
  if (store !== undefined) options.store = store
  return rateLimit(options)
}
export const payuHashLimiter = payuSdkLimiter('payuhash', 60)
export const payuConfirmLimiter = payuSdkLimiter('payuconfirm', 20)

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
