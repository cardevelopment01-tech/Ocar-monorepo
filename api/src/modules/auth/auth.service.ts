import { AppErrors } from '@/constants/errors'
import crypto from 'crypto'
import { createHttpError } from '@/lib/errors'
import { PrincipalRole, OtpPurpose } from '@/constants/enums'
import { config } from '@/config'
import { OTP_TTL_SECONDS } from '@/constants/limits'
import * as otpLib from '@/lib/otp'
import { signAccessToken, generateRefreshToken, hashRefreshToken, signPendingTotpToken, verifyPendingTotpToken } from '@/lib/jwt'
import { comparePassword } from '@/lib/hash'
import type { AccessTokenPayload } from '@/lib/jwt'
import * as repo from './auth.repository'
import { notificationsQueue } from '@/jobs/queues'
import { verifyLoginCode } from '@/modules/admin-totp/admin-totp.service'
import type {
  AuthTokens,
  UserRecord,
  DriverRecord,
  AdminRecord,
  OtpRequestResult,
  VerifyOtpResult,
  AdminLoginResult,
  AdminLoginPendingTotpResult,
  AdminTotpVerifyResult,
} from './auth.types'

export { createHttpError }

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
  adminRole?: string,
  familyId = crypto.randomUUID()
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
  const accessExpiresIn = expiryToSeconds(config.JWT_ACCESS_EXPIRY)
  const refreshExpiresIn = expiryToSeconds(refreshExpiry)
  const expiresAt = new Date(Date.now() + refreshExpiresIn * 1000)

  await repo.storeRefreshToken({
    principalRole: role,
    principalId: BigInt(principal.id),
    tokenHash,
    familyId,
    expiresAt,
  })

  return { accessToken, refreshToken, expiresIn: accessExpiresIn, refreshExpiresIn }
}

// ── Public service functions ──────────────────────────────────────────────────

export async function requestOtp(
  phone: string,
  role: 'user' | 'driver',
  purpose: 'login'
): Promise<OtpRequestResult> {
  const principalRole = role === 'user' ? PrincipalRole.USER : PrincipalRole.DRIVER
  const otpPurpose = OtpPurpose.LOGIN

  const { allowed } = await otpLib.checkRateLimit(phone, otpPurpose, principalRole)
  if (!allowed) throw createHttpError(AppErrors.AUTH_OTP_RATE_LIMITED)

  if (await otpLib.isVerifyLocked(phone, otpPurpose, principalRole)) {
    throw createHttpError(AppErrors.AUTH_OTP_LOCKED)
  }

  const otp = otpLib.generateOtp()
  const otpHash = otpLib.hashOtp(otp)
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000)

  await Promise.all([
    otpLib.storeOtp(phone, otpPurpose, principalRole, otp),
    repo.createOtpRequest({ principalRole, phone, purpose: otpPurpose, otpHash, expiresAt }),
  ])

  await notificationsQueue.add(
    'otp_sms',
    { phone, otp, type: 'auth' },
    { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
  )

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

  const tokens = await issueTokenPair(principalRole, principal, config.JWT_REFRESH_EXPIRY_USER)
  return { tokens, principal, isNew }
}

export async function adminLogin(
  email: string,
  password: string,
  ip: string | null
): Promise<AdminLoginResult | AdminLoginPendingTotpResult> {
  const adminRow = await repo.findAdminByEmail(email)
  if (!adminRow) throw createHttpError(AppErrors.AUTH_OTP_INVALID)

  const valid = await comparePassword(password, adminRow.password_hash)
  if (!valid) throw createHttpError(AppErrors.AUTH_OTP_INVALID)

  // Password alone is not a session when 2FA is on — no tokens issued yet,
  // and last_login_at is only touched once the code is actually verified.
  if (adminRow.totp_enabled) {
    return { pending: true, pendingToken: signPendingTotpToken(adminRow.id) }
  }

  await repo.touchAdminLogin(BigInt(adminRow.id), ip)

  const { password_hash: _ph, ...admin } = adminRow
  const tokens = await issueTokenPair(PrincipalRole.ADMIN, admin, config.JWT_REFRESH_EXPIRY_ADMIN, admin.role)
  return { tokens, admin }
}

export async function verifyAdminTotp(
  pendingToken: string,
  code: string,
  ip: string | null
): Promise<AdminTotpVerifyResult> {
  let adminId: string
  try {
    adminId = verifyPendingTotpToken(pendingToken).adminId
  } catch {
    throw createHttpError(AppErrors.TOTP_INVALID_PENDING_TOKEN)
  }

  const admin = await repo.findAdminById(BigInt(adminId))
  if (!admin) throw createHttpError(AppErrors.TOTP_INVALID_PENDING_TOKEN)

  const codeValid = await verifyLoginCode(BigInt(adminId), code)
  if (!codeValid) throw createHttpError(AppErrors.TOTP_INVALID_CODE)

  await repo.touchAdminLogin(BigInt(adminId), ip)

  const tokens = await issueTokenPair(PrincipalRole.ADMIN, admin, config.JWT_REFRESH_EXPIRY_ADMIN, admin.role)
  return { tokens, admin }
}

export async function refreshTokens(refreshToken: string): Promise<{ tokens: AuthTokens }> {
  const tokenHash = hashRefreshToken(refreshToken)
  const stored = await repo.findRefreshToken(tokenHash)
  if (!stored) throw createHttpError(AppErrors.AUTH_TOKEN_INVALID)
  if (stored.used_at || stored.revoked_at) {
    await repo.revokeRefreshTokenFamily(tokenHash)
    throw createHttpError(AppErrors.AUTH_TOKEN_INVALID)
  }
  if (stored.expires_at <= new Date()) {
    await repo.revokeRefreshTokenFamily(tokenHash)
    throw createHttpError(AppErrors.AUTH_TOKEN_INVALID)
  }

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

  const expiry = role === PrincipalRole.ADMIN ? config.JWT_REFRESH_EXPIRY_ADMIN : config.JWT_REFRESH_EXPIRY_USER
  const adminRole = role === PrincipalRole.ADMIN ? (principal as AdminRecord).role : undefined
  const payload: AccessTokenPayload = {
    sub: principal.id,
    code: principal.code,
    role,
    status: (principal as UserRecord | DriverRecord).status ?? 'active',
  }
  if (adminRole) payload.adminRole = adminRole as import('@/constants/enums').AdminRole

  const newRefreshToken = generateRefreshToken()
  const newTokenHash = hashRefreshToken(newRefreshToken)
  const refreshExpiresIn = expiryToSeconds(expiry)
  const rotated = await repo.rotateRefreshToken({
    oldTokenHash: tokenHash,
    newTokenHash,
    expiresAt: new Date(Date.now() + refreshExpiresIn * 1000),
  })
  if (!rotated) throw createHttpError(AppErrors.AUTH_TOKEN_INVALID)

  const tokens: AuthTokens = {
    accessToken: signAccessToken(payload),
    refreshToken: newRefreshToken,
    expiresIn: expiryToSeconds(config.JWT_ACCESS_EXPIRY),
    refreshExpiresIn,
  }
  return { tokens }
}

export async function logout(refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken)
  await repo.revokeRefreshTokenFamily(tokenHash)
}
