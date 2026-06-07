import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { config } from '@/config'
import { JWT_ACCESS_EXPIRY } from '@/constants/limits'
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
  return jwt.sign(rest, config.JWT_ACCESS_SECRET, {
    subject: sub,
    expiresIn: JWT_ACCESS_EXPIRY,
  })
}

export function verifyAccessToken(token: string): DecodedAccessToken {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET) as DecodedAccessToken & { sub: string }
  return decoded
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
