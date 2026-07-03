import rateLimit from 'express-rate-limit'

// Bypass IP-based limiters in test environment — tests use a shared localhost
// IP which would exhaust the window in a single suite. The OTP service's own
// Redis-based per-phone rate limiter still runs and is reset per test case.
const skipInTest = () => process.env['NODE_ENV'] === 'test'

// General API: 200 requests per minute per IP
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
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
