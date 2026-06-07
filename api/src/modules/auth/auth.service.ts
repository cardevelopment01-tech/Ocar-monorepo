import { AppErrors } from '@/constants/errors'
import { PrincipalRole, OtpPurpose } from '@/constants/enums'
import { OTP_TTL_SECONDS, JWT_REFRESH_EXPIRY_USER, JWT_REFRESH_EXPIRY_ADMIN } from '@/constants/limits'
import * as otpLib from '@/lib/otp'
import { signAccessToken, generateRefreshToken, hashRefreshToken } from '@/lib/jwt'
import { comparePassword } from '@/lib/hash'
import type { AccessTokenPayload } from '@/lib/jwt'
import * as repo from './auth.repository'
import type {
  AuthTokens,
  UserRecord,
  DriverRecord,
  AdminRecord,
  OtpRequestResult,
  VerifyOtpResult,
  AdminLoginResult,
} from './auth.types'

// ── Error factory ─────────────────────────────────────────────────────────────

type AppErrorEntry = (typeof AppErrors)[keyof typeof AppErrors]

export function createHttpError(entry: AppErrorEntry): Error & { httpStatus: number; appCode: string } {
  const err = new Error(entry.message) as Error & { httpStatus: number; appCode: string }
  err.httpStatus = entry.httpStatus
  err.appCode = entry.code
  return err
}

// ── Expiry helpers ────────────────────────────────────────────────────────────

function expiryToSeconds(expiry: string): number {
  const match = /^(\d+)([smhd])$/.exec(expiry)
  if (!match) return 900
  const n = parseInt(match[1]!, 10)
  const unit = match[2]!
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return n * (multipliers[unit] ?? 1)
}

// ── Token pair issuance ───────────────────────────────────────────────────────

async function issueTokenPair(
  role: PrincipalRole,
  principal: UserRecord | DriverRecord | AdminRecord,
  refreshExpiry: string,
  adminRole?: string
): Promise<AuthTokens> {
  const payload: AccessTokenPayload = {
    sub: principal.id,
    code: principal.code,
    role,
    status: (principal as UserRecord | DriverRecord).status ?? 'active',
  }
  if (adminRole) payload.adminRole = adminRole as import('@/constants/enums').AdminRole

  const accessToken = signAccessToken(payload)
  const refreshToken = generateRefreshToken()
  const tokenHash = hashRefreshToken(refreshToken)
  const expiresAt = new Date(Date.now() + expiryToSeconds(refreshExpiry) * 1000)

  await repo.storeRefreshToken({
    principalRole: role,
    principalId: BigInt(principal.id),
    tokenHash,
    expiresAt,
  })

  return { accessToken, refreshToken, expiresIn: expiryToSeconds(refreshExpiry) }
}

// ── Public service functions ──────────────────────────────────────────────────

export async function requestOtp(
  phone: string,
  role: 'user' | 'driver',
  purpose: 'login'
): Promise<OtpRequestResult> {
  const principalRole = role === 'user' ? PrincipalRole.USER : PrincipalRole.DRIVER
  const otpPurpose = OtpPurpose.LOGIN

  const { allowed } = await otpLib.checkRateLimit(phone, otpPurpose)
  if (!allowed) throw createHttpError(AppErrors.AUTH_OTP_RATE_LIMITED)

  const otp = otpLib.generateOtp()
  const otpHash = otpLib.hashOtp(otp)
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000)

  await Promise.all([
    otpLib.storeOtp(phone, otpPurpose, principalRole, otp),
    repo.createOtpRequest({ principalRole, phone, purpose: otpPurpose, otpHash, expiresAt }),
  ])

  // Production: send via SMS provider — not yet implemented (M10)
  return { otp }
}

export async function verifyOtp(
  phone: string,
  otp: string,
  role: 'user' | 'driver',
  purpose: 'login'
): Promise<VerifyOtpResult> {
  const principalRole = role === 'user' ? PrincipalRole.USER : PrincipalRole.DRIVER
  const otpPurpose = OtpPurpose.LOGIN

  const result = await otpLib.consumeOtp(phone, otpPurpose, principalRole, otp)

  if (result.expired === true) throw createHttpError(AppErrors.AUTH_OTP_EXPIRED)
  if (result.locked === true) throw createHttpError(AppErrors.AUTH_OTP_LOCKED)
  if (!result.success) throw createHttpError(AppErrors.AUTH_OTP_INVALID)

  let principal: UserRecord | DriverRecord
  let isNew: boolean

  if (role === 'user') {
    const existing = await repo.findUserByPhone(phone)
    isNew = !existing
    principal = await repo.upsertUser(phone)
    if ((principal as UserRecord).status === 'suspended') {
      throw createHttpError(AppErrors.AUTH_FORBIDDEN)
    }
  } else {
    const existing = await repo.findDriverByPhone(phone)
    isNew = !existing
    principal = await repo.upsertDriver(phone)
    const { status } = principal as DriverRecord
    if (status === 'suspended' || status === 'banned') {
      throw createHttpError(AppErrors.DRIVER_SUSPENDED)
    }
  }

  const tokens = await issueTokenPair(principalRole, principal, JWT_REFRESH_EXPIRY_USER)
  return { tokens, principal, isNew }
}

export async function adminLogin(email: string, password: string): Promise<AdminLoginResult> {
  const adminRow = await repo.findAdminByEmail(email)
  if (!adminRow) throw createHttpError(AppErrors.AUTH_OTP_INVALID)

  const valid = await comparePassword(password, adminRow.password_hash)
  if (!valid) throw createHttpError(AppErrors.AUTH_OTP_INVALID)

  const { password_hash: _ph, ...admin } = adminRow
  const tokens = await issueTokenPair(PrincipalRole.ADMIN, admin, JWT_REFRESH_EXPIRY_ADMIN, admin.role)
  return { tokens, admin }
}

export async function refreshTokens(refreshToken: string): Promise<{ tokens: AuthTokens }> {
  const tokenHash = hashRefreshToken(refreshToken)
  const stored = await repo.findValidRefreshToken(tokenHash)
  if (!stored) throw createHttpError(AppErrors.AUTH_TOKEN_INVALID)

  // Revoke the used token immediately (rotation — single-use)
  await repo.revokeRefreshToken(tokenHash)

  const role = stored.principal_role as PrincipalRole
  const principalId = BigInt(stored.principal_id)

  let principal: UserRecord | DriverRecord | AdminRecord | null = null

  if (role === PrincipalRole.USER) {
    principal = await repo.findUserById(principalId)
  } else if (role === PrincipalRole.DRIVER) {
    principal = await repo.findDriverById(principalId)
  } else {
    principal = await repo.findAdminById(principalId)
  }

  if (!principal) throw createHttpError(AppErrors.AUTH_TOKEN_INVALID)

  const expiry = role === PrincipalRole.ADMIN ? JWT_REFRESH_EXPIRY_ADMIN : JWT_REFRESH_EXPIRY_USER
  const adminRole = role === PrincipalRole.ADMIN ? (principal as AdminRecord).role : undefined
  const tokens = await issueTokenPair(role, principal, expiry, adminRole)
  return { tokens }
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken)
  await repo.revokeRefreshToken(tokenHash)
}
