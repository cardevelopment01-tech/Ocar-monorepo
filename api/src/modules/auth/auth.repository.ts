import { query } from '@/db/client'
import type { PrincipalRole, OtpPurpose } from '@/constants/enums'
import type {
  UserRecord,
  DriverRecord,
  AdminRecord,
  AdminDbRow,
  OtpRequestRecord,
  RefreshTokenRecord,
} from './auth.types'

// ── Users ─────────────────────────────────────────────────────────────────────

export async function findUserByPhone(phone: string): Promise<UserRecord | null> {
  const rows = await query<UserRecord>(
    'SELECT * FROM users WHERE phone = $1 LIMIT 1',
    [phone]
  )
  return rows[0] ?? null
}

export async function findUserById(id: bigint): Promise<UserRecord | null> {
  const rows = await query<UserRecord>(
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
    [id.toString()]
  )
  return rows[0] ?? null
}

export async function upsertUser(phone: string): Promise<UserRecord> {
  const rows = await query<UserRecord>(
    `INSERT INTO users (phone)
     VALUES ($1)
     ON CONFLICT (phone) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [phone]
  )
  return rows[0]!
}

// ── Drivers ───────────────────────────────────────────────────────────────────

export async function findDriverByPhone(phone: string): Promise<DriverRecord | null> {
  const rows = await query<DriverRecord>(
    'SELECT * FROM drivers WHERE phone = $1 LIMIT 1',
    [phone]
  )
  return rows[0] ?? null
}

export async function findDriverById(id: bigint): Promise<DriverRecord | null> {
  const rows = await query<DriverRecord>(
    'SELECT * FROM drivers WHERE id = $1 LIMIT 1',
    [id.toString()]
  )
  return rows[0] ?? null
}

export async function upsertDriver(phone: string): Promise<DriverRecord> {
  const rows = await query<DriverRecord>(
    `INSERT INTO drivers (phone)
     VALUES ($1)
     ON CONFLICT (phone) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [phone]
  )
  return rows[0]!
}

// ── Admins ────────────────────────────────────────────────────────────────────

export async function findAdminByEmail(email: string): Promise<AdminDbRow | null> {
  const rows = await query<AdminDbRow>(
    'SELECT * FROM admins WHERE email = $1 AND is_active = true LIMIT 1',
    [email]
  )
  return rows[0] ?? null
}

export async function findAdminById(id: bigint): Promise<AdminRecord | null> {
  const rows = await query<AdminRecord>(
    `SELECT id, code, email, role, is_active, created_at, updated_at
     FROM admins WHERE id = $1 LIMIT 1`,
    [id.toString()]
  )
  return rows[0] ?? null
}

// ── OTP requests ──────────────────────────────────────────────────────────────

export async function createOtpRequest(params: {
  principalRole: PrincipalRole
  phone: string
  purpose: OtpPurpose
  otpHash: string
  expiresAt: Date
}): Promise<OtpRequestRecord> {
  const rows = await query<OtpRequestRecord>(
    `INSERT INTO otp_requests (principal_role, phone, purpose, otp_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.principalRole, params.phone, params.purpose, params.otpHash, params.expiresAt]
  )
  return rows[0]!
}

// ── Refresh tokens ────────────────────────────────────────────────────────────

export async function storeRefreshToken(params: {
  principalRole: PrincipalRole
  principalId: bigint
  tokenHash: string
  expiresAt: Date
}): Promise<RefreshTokenRecord> {
  const rows = await query<RefreshTokenRecord>(
    `INSERT INTO refresh_tokens (principal_role, principal_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [params.principalRole, params.principalId.toString(), params.tokenHash, params.expiresAt]
  )
  return rows[0]!
}

export async function findValidRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
  const rows = await query<RefreshTokenRecord>(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > now()
     LIMIT 1`,
    [tokenHash]
  )
  return rows[0] ?? null
}

export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1',
    [tokenHash]
  )
}
