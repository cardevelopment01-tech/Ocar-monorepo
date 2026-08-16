import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { config } from '@/config'
import type { PrincipalRole, AdminRole } from '@/constants/enums'

export interface AccessTokenPayload {
  sub: string
  code: string
  role: PrincipalRole
  adminRole?: AdminRole
  status?: string
}

export interface DecodedAccessToken extends AccessTokenPayload {
  iat: number
  exp: number
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const { sub, ...rest } = payload
  const options: jwt.SignOptions = {
    subject: sub,
    expiresIn: config.JWT_ACCESS_EXPIRY as NonNullable<jwt.SignOptions['expiresIn']>,
  }
  return jwt.sign(rest, config.JWT_ACCESS_SECRET, options)
}

export function verifyAccessToken(token: string): DecodedAccessToken {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as DecodedAccessToken & { sub: string }
  return decoded
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// Short-lived, single-purpose token issued after password succeeds for an
// admin with TOTP enabled — deliberately shaped nothing like AccessTokenPayload
// (no `role`) so it can never pass authenticate()'s role check even if
// someone tried to use it as a real access token.
const PENDING_TOTP_PURPOSE = 'totp_verify'

export function signPendingTotpToken(adminId: string): string {
  return jwt.sign({ purpose: PENDING_TOTP_PURPOSE }, config.JWT_ACCESS_SECRET, {
    subject: adminId,
    expiresIn: '10m',
  })
}

export function verifyPendingTotpToken(token: string): { adminId: string } {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, { algorithms: ['HS256'] }) as { sub?: string; purpose?: string }
  if (decoded.purpose !== PENDING_TOTP_PURPOSE || !decoded.sub) {
    throw new Error('Not a valid pending TOTP token')
  }
  return { adminId: decoded.sub }
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
