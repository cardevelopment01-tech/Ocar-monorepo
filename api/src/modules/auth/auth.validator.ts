import { z } from 'zod'

const indianPhone = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile number (+91XXXXXXXXXX)')

export const requestOtpSchema = z.object({
  phone: indianPhone,
  role: z.enum(['user', 'driver']),
  purpose: z.enum(['login']).default('login'),
})

export const verifyOtpSchema = z.object({
  phone: indianPhone,
  otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
  role: z.enum(['user', 'driver']),
  purpose: z.enum(['login']).default('login'),
})

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const adminTotpVerifySchema = z.object({
  pendingToken: z.string().min(1),
  // Either a 6-digit TOTP code or an XXXX-XXXX recovery code.
  code: z.string().min(6).max(9),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
})

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
})
