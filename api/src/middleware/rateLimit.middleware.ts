import rateLimit from 'express-rate-limit'

// General API: 200 requests per minute per IP
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
})

// Auth/OTP: 10 requests per minute per IP to limit brute-force
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
})
