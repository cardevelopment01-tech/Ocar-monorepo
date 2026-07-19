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
  full_name: string | null
  email: string | null
  gender: string | null
  date_of_birth: string | null
  residential_address: string | null
  state: string | null
  city: string | null
  pincode: string | null
  experience_years: number | null
  emergency_contact: string | null
  languages_known: string[]
  aadhaar_number: string | null
  license_number: string | null
  status: DriverStatus
  onboarding_step: string
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
  totp_enabled: boolean
  created_at: Date
  updated_at: Date
}

export interface AdminDbRow extends AdminRecord {
  password_hash: string
  totp_enabled: boolean
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
  family_id: string
  expires_at: Date
  used_at: Date | null
  replaced_by_token_hash: string | null
  reuse_detected_at: Date | null
  revoked_at: Date | null
  created_at: Date
}

// ── Service response types ────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshExpiresIn: number
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

// Returned instead of AdminLoginResult when the admin has TOTP enabled —
// password was correct, but no session exists yet until the code is verified.
export interface AdminLoginPendingTotpResult {
  pending: true
  pendingToken: string
}

export interface AdminTotpVerifyResult {
  tokens: AuthTokens
  admin: AdminRecord
}
