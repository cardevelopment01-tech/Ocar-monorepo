import type { UserStatus, DriverStatus, AdminRole } from '@/constants/enums'

// ── DB row types ──────────────────────────────────────────────────────────────
// pg returns BIGINT columns as strings; id is typed as string here.

export interface UserRecord {
  id: string
  code: string
  phone: string
  name: string | null
  email: string | null
  status: UserStatus
  referral_code: string
  referred_by_id: string | null
  fcm_token: string | null
  created_at: Date
  updated_at: Date
}

export interface DriverRecord {
  id: string
  code: string
  phone: string
  name: string | null
  email: string | null
  status: DriverStatus
  fcm_token: string | null
  created_at: Date
  updated_at: Date
}

export interface AdminRecord {
  id: string
  code: string
  email: string
  role: AdminRole
  is_active: boolean
  created_at: Date
  updated_at: Date
}

export interface AdminDbRow extends AdminRecord {
  password_hash: string
}

export interface OtpRequestRecord {
  id: string
  principal_role: string
  phone: string
  purpose: string
  otp_hash: string
  attempts: number
  locked_until: Date | null
  expires_at: Date
  used_at: Date | null
  created_at: Date
}

export interface RefreshTokenRecord {
  id: string
  principal_role: string
  principal_id: string
  token_hash: string
  expires_at: Date
  revoked_at: Date | null
  created_at: Date
}

// ── Service response types ────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface OtpRequestResult {
  /** Returned in non-production environments so tests/dev can use it directly */
  otp: string
}

export interface VerifyOtpResult {
  tokens: AuthTokens
  principal: UserRecord | DriverRecord
  isNew: boolean
}

export interface AdminLoginResult {
  tokens: AuthTokens
  admin: AdminRecord
}
