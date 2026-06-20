import { query, withTransaction } from '@/db/client'
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

export async function touchAdminLogin(id: bigint, ip: string | null): Promise<void> {
  await query(
    `UPDATE admins SET last_login_at = now(), last_login_ip = $2, updated_at = now() WHERE id = $1`,
    [id.toString(), ip]
  )
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
  familyId: string
  expiresAt: Date
}): Promise<RefreshTokenRecord> {
  const rows = await query<RefreshTokenRecord>(
    `INSERT INTO refresh_tokens (principal_role, principal_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.principalRole, params.principalId.toString(), params.tokenHash, params.familyId, params.expiresAt]
  )
  return rows[0]!
}

export async function findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
  const rows = await query<RefreshTokenRecord>(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash]
  )
  return rows[0] ?? null
}

export async function rotateRefreshToken(params: {
  oldTokenHash: string
  newTokenHash: string
  expiresAt: Date
}): Promise<RefreshTokenRecord | null> {
  return withTransaction(async (client) => {
    const existing = await client.query<RefreshTokenRecord>(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 LIMIT 1 FOR UPDATE`,
      [params.oldTokenHash]
    )
    const token = existing.rows[0]
    if (!token) return null

    if (token.used_at || token.revoked_at) {
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = COALESCE(revoked_at, now()),
             reuse_detected_at = CASE
               WHEN token_hash = $1 THEN COALESCE(reuse_detected_at, now())
               ELSE reuse_detected_at
             END
         WHERE family_id = $2`,
        [params.oldTokenHash, token.family_id]
      )
      return null
    }

    if (token.expires_at <= new Date()) {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE token_hash = $1`,
        [params.oldTokenHash]
      )
      return null
    }

    await client.query(
      `UPDATE refresh_tokens
       SET used_at = now(),
           revoked_at = now(),
           replaced_by_token_hash = $2
       WHERE token_hash = $1`,
      [params.oldTokenHash, params.newTokenHash]
    )

    const inserted = await client.query<RefreshTokenRecord>(
      `INSERT INTO refresh_tokens
         (principal_role, principal_id, token_hash, family_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        token.principal_role,
        token.principal_id,
        params.newTokenHash,
        token.family_id,
        params.expiresAt,
      ]
    )
    return inserted.rows[0]!
  })
}

export async function revokeRefreshTokenFamily(tokenHash: string): Promise<void> {
  const token = await findRefreshToken(tokenHash)
  if (!token) return
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = COALESCE(revoked_at, now()),
         reuse_detected_at = CASE
           WHEN token_hash = $2 AND (used_at IS NOT NULL OR revoked_at IS NOT NULL)
           THEN COALESCE(reuse_detected_at, now())
           ELSE reuse_detected_at
         END
     WHERE family_id = $1`,
    [token.family_id, tokenHash]
  )
}
