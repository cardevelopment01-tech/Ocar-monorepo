import { rateLimit } from 'express-rate-limit'
import { RedisStore, type RedisReply } from 'rate-limit-redis'
import type { Request } from 'express'
import { verifyAccessToken, verifyPendingTotpToken } from '@/lib/jwt'
import { client as redis, withTimeout } from '@/db/redis'
import { logger } from '@/lib/logger'
import { sha256 } from '@/lib/hash'

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

// ── Auth limits ───────────────────────────────────────────────────────────────
// Guess-resistance belongs on the endpoints where someone can GUESS a secret, not on the whole /auth router. Before this
// every /auth route (including the token-protected /me, /refresh and /logout) shared one 10-per-minute-per-IP bucket, so
// a few page loads from one office, or a deploy that made many phones behind one carrier NAT refresh at once, locked
// people out of login. /me and /logout need a valid token and are covered by the general per-principal limiter above.
//
// Failures-only counting (skipSuccessfulRequests) is the usual practice for credential endpoints: it throttles guessing
// without punishing the many legitimate sign-ins that share an IP. Per-account limits sit beside the per-IP ones so
// rotating IPs does not get an attacker past them.
function authLimiterFor(skip: () => boolean, prefix: string, opts: { windowMs: number; max: number; failuresOnly?: boolean; key?: (req: Request) => string }) {
  const options: Parameters<typeof rateLimit>[0] = {
    windowMs: opts.windowMs,
    max: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    passOnStoreError: true,
    skipSuccessfulRequests: opts.failuresOnly === true,
    message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
  }
  if (opts.key) { const key = opts.key; options.keyGenerator = (req) => `${prefix}:${key(req)}` }
  const store = skip === skipInTest ? redisStore(`rl:${prefix}:`) : undefined
  if (store !== undefined) options.store = store
  return rateLimit(options)
}
const bodyString = (req: Request, field: string): string | undefined => {
  const v = (req.body as Record<string, unknown> | undefined)?.[field]
  return typeof v === 'string' && v.length > 0 && v.length < 512 ? v : undefined
}

export function makeAuthLimiters(skip: () => boolean = skipInTest) {
  // OTP request / verify: 30 per minute per IP. The real guard is per phone (request cap in lib/otp.ts, verify lockout after
  // OTP_MAX_ATTEMPTS); the IP cap only stops one address sweeping many numbers, and is wide enough for a carrier-NAT'd stand.
  const otpLimiter = authLimiterFor(skip, 'otp', { windowMs: 60_000, max: 30 })

  // Admin password login: 10 FAILED attempts per minute per IP, and 10 FAILED per 15 minutes per email.
  const adminLoginIpLimiter = authLimiterFor(skip, 'adminlogin-ip', { windowMs: 60_000, max: 10, failuresOnly: true })
  const adminLoginAccountLimiter = authLimiterFor(skip, 'adminlogin-acct', {
    windowMs: 15 * 60_000, max: 10, failuresOnly: true,
    key: (req) => (bodyString(req, 'email')?.toLowerCase() ?? req.ip ?? 'unknown'),
  })

  // Admin TOTP step: a 6-digit code is only 1e6 guesses, so cap FAILED tries per admin (not per pending token, or a fresh
  // password login would reset the count): 5 per 15 minutes, plus the same per-IP cap as the password step.
  const adminTotpIpLimiter = authLimiterFor(skip, 'admintotp-ip', { windowMs: 60_000, max: 10, failuresOnly: true })
  const adminTotpAccountLimiter = authLimiterFor(skip, 'admintotp-acct', {
    windowMs: 15 * 60_000, max: 5, failuresOnly: true,
    key: (req) => {
      const t = bodyString(req, 'pendingToken')
      if (t) { try { return `admin:${verifyPendingTotpToken(t).adminId}` } catch { /* invalid token: fall back to IP */ } }
      return req.ip ?? 'unknown'
    },
  })

  // Risky actions on other admins (role change, removal, 2FA reset, sign-out) re-ask for the acting admin's password. Throttled per ADMIN, not
  // per address: a stolen session must not be able to guess the password at speed. Failed attempts only (a wrong password, or a refused action).
  const adminStepUpLimiter = authLimiterFor(skip, 'admin-stepup', {
    windowMs: 15 * 60_000, max: 10, failuresOnly: true,
    key: (req) => `admin:${req.admin?.id ?? req.ip ?? 'unknown'}`,
  })

  // Public admin-invite endpoints (no session exists yet): the link's token is 256 bits so guessing is impractical, but a public endpoint
  // that answers valid/invalid should still be throttled. Failed attempts only, per IP: a person opening their link a few times is never
  // slowed down, a script trying tokens or passwords is.
  const inviteVerifyLimiter = authLimiterFor(skip, 'invite-verify', { windowMs: 60_000, max: 20, failuresOnly: true })
  const inviteRedeemLimiter = authLimiterFor(skip, 'invite-redeem', { windowMs: 60_000, max: 10, failuresOnly: true })

  // Token refresh: 60 per minute per IP. The refresh token is a 256-bit secret, so this is not guess-resistance; it only
  // bounds a runaway client. Wide enough that every phone behind one NAT can refresh together after a deploy.
  const refreshLimiter = authLimiterFor(skip, 'refresh', { windowMs: 60_000, max: 60 })
  return { otpLimiter, adminLoginIpLimiter, adminLoginAccountLimiter, adminTotpIpLimiter, adminTotpAccountLimiter, adminStepUpLimiter, inviteVerifyLimiter, inviteRedeemLimiter, refreshLimiter }
}
export const { otpLimiter, adminLoginIpLimiter, adminLoginAccountLimiter, adminTotpIpLimiter, adminTotpAccountLimiter, adminStepUpLimiter, inviteVerifyLimiter, inviteRedeemLimiter, refreshLimiter } = makeAuthLimiters()

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

// Offers (review decision D16). Previewing is cheap but runs the fare engine, so it is capped per principal per
// minute. Guessing codes is the abuse case: 10 FAILED attempts per 10 minutes, counted per rider and per IP, so
// rotating accounts from one address (or one account over many addresses) both hit a wall. A request counts as
// failed only when the controller sets res.locals.codeGuessFailed (unknown code, not-assigned); successful previews
// and the re-preview after a 409 PRICE_CHANGED never count. skip is injectable so a test can switch the limiter on.
export function makeOffersPreviewLimiter(skip: () => boolean = skipInTest) {
  const options: Parameters<typeof rateLimit>[0] = {
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    passOnStoreError: true,
    keyGenerator: (req) => `offerspreview:${principalKey(req)}`,
    message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
  }
  const store = skip === skipInTest ? redisStore('rl:offerspreview:') : undefined
  if (store !== undefined) options.store = store
  return rateLimit(options)
}
export const offersPreviewLimiter = makeOffersPreviewLimiter()

// Public live-trip data endpoint (eng review D5). Anyone on the internet can call it, so the abuse that matters is guessing
// tokens: only WRONG lookups (the controller sets res.locals.tripMiss for unknown, expired and malformed tokens) use up the
// strict per-IP limit of 20 a minute, so relatives behind one office or carrier IP are never locked out by each other's
// 5-second polling. A valid link is capped per token (180/min = 15 viewers polling every 5 s). The token is hashed before it
// becomes a Redis key, so the raw token never sits in Redis either. skip is injectable so a test can switch the limiters on.
export function makePublicTripLimiters(skip: () => boolean = skipInTest) {
  const build = (prefix: string, max: number, key: (req: Request) => string, misses: boolean) => {
    const options: Parameters<typeof rateLimit>[0] = {
      windowMs: 60 * 1000,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      skip,
      passOnStoreError: true,
      keyGenerator: (req) => `${prefix}:${key(req)}`,
      message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
    }
    if (misses) {
      options.skipSuccessfulRequests = true
      options.requestWasSuccessful = (_req, res) => !res.locals['tripMiss']
    }
    const store = skip === skipInTest ? redisStore(`rl:${prefix}:`) : undefined
    if (store !== undefined) options.store = store
    return rateLimit(options)
  }
  return {
    misses: build('pubmiss', 20, (req) => req.ip ?? 'unknown', true),
    perToken: build('pubtok', 180, (req) => sha256(String(req.params['token'] ?? '')).slice(0, 16), false),
  }
}
export const publicTripLimiters = makePublicTripLimiters()

export function makeOffersCodeGuessLimiters(skip: () => boolean = skipInTest) {
  const build = (prefix: string, key: (req: Request) => string) => {
    const options: Parameters<typeof rateLimit>[0] = {
      windowMs: 10 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      skip,
      skipSuccessfulRequests: true,
      requestWasSuccessful: (_req, res) => !res.locals['codeGuessFailed'],
      passOnStoreError: true,
      keyGenerator: (req) => `${prefix}:${key(req)}`,
      message: { error: 'Too many wrong codes. Try again later.', code: 'RATE_LIMIT_EXCEEDED' },
    }
    const store = skip === skipInTest ? redisStore(`rl:${prefix}:`) : undefined
    if (store !== undefined) options.store = store
    return rateLimit(options)
  }
  return [
    build('offersguessuser', principalKey),
    build('offersguessip', (req) => req.ip ?? 'unknown'),
  ]
}
export const offersCodeGuessLimiters = makeOffersCodeGuessLimiters()

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
