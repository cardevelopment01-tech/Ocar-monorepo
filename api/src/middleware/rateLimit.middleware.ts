import { rateLimit } from 'express-rate-limit'
import type { Request } from 'express'
import { verifyAccessToken } from '@/lib/jwt'

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
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: principalKey,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
})

// Auth/OTP: 10 requests per minute per IP to limit brute-force
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
})

// Per (principal, ride) chat-send throttle. express-rate-limit is a fixed-window
// counter, so this caps ~5 sends/second/ride rather than a true "burst 5 then
// 1/sec" token bucket — close enough, and it reuses the existing middleware
// stack. ponytail: fixed-window approximation; swap for a Redis token-bucket
// (see the OTP rate limiter pattern in lib/otp.ts) only if abuse proves this too coarse.
export const chatMessageLimiter = rateLimit({
  windowMs: 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req) => `chat:${principalKey(req)}:${req.params['id'] ?? ''}`,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
})
