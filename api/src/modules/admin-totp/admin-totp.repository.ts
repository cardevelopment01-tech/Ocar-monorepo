import { pool, withTransaction } from '@/db/client'
import type { AdminTotpState, RecoveryCodeRow } from './admin-totp.types'

export async function getAdminTotpState(adminId: bigint): Promise<AdminTotpState | null> {
  const rows = await pool.query<AdminTotpState>(
    `SELECT id, email, role, totp_enabled, totp_secret_enc, totp_last_timestep, password_hash
     FROM admins WHERE id = $1`,
    [adminId]
  )
  return rows.rows[0] ?? null
}

// Stores a not-yet-confirmed secret. totp_enabled stays false until confirmSetup succeeds.
// Also clears any prior replay-guard timestep — a fresh secret means old ones are moot.
export async function setPendingSecret(adminId: bigint, encryptedSecret: string): Promise<void> {
  await pool.query(
    'UPDATE admins SET totp_secret_enc = $1, totp_last_timestep = NULL WHERE id = $2',
    [encryptedSecret, adminId]
  )
}

export async function enableTotp(adminId: bigint): Promise<void> {
  await pool.query('UPDATE admins SET totp_enabled = true WHERE id = $1', [adminId])
}

// RFC 6238 replay guard — records the time step a code was just accepted at,
// so the same (or an earlier) step can never be accepted again.
export async function recordUsedTimeStep(adminId: bigint, timeStep: number): Promise<void> {
  await pool.query('UPDATE admins SET totp_last_timestep = $1 WHERE id = $2', [timeStep, adminId])
}

export async function disableTotp(adminId: bigint): Promise<void> {
  await withTransaction(async client => {
    await client.query(
      'UPDATE admins SET totp_enabled = false, totp_secret_enc = NULL, totp_last_timestep = NULL WHERE id = $1',
      [adminId]
    )
    await client.query('DELETE FROM admin_recovery_codes WHERE admin_id = $1', [adminId])
  })
}

// All-or-nothing: old codes are invalidated the moment new ones are issued.
export async function replaceRecoveryCodes(adminId: bigint, hashedCodes: string[]): Promise<void> {
  await withTransaction(async client => {
    await client.query('DELETE FROM admin_recovery_codes WHERE admin_id = $1', [adminId])
    for (const hash of hashedCodes) {
      await client.query('INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES ($1, $2)', [adminId, hash])
    }
  })
}

export async function findUnusedRecoveryCodes(adminId: bigint): Promise<RecoveryCodeRow[]> {
  const rows = await pool.query<RecoveryCodeRow>(
    'SELECT id, code_hash FROM admin_recovery_codes WHERE admin_id = $1 AND used_at IS NULL',
    [adminId]
  )
  return rows.rows
}

export async function markRecoveryCodeUsed(id: string): Promise<void> {
  await pool.query('UPDATE admin_recovery_codes SET used_at = now() WHERE id = $1', [id])
}
