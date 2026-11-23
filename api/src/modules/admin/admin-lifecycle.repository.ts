import type { PoolClient } from 'pg'
import { pool, withTransaction } from '@/db/client'
import { AppErrors } from '@/constants/errors'
import { PrincipalRole, type AdminRole } from '@/constants/enums'
import { createHttpError } from '@/lib/errors'
import type { AdminAccountListItem } from './admin.types'

// Every column the admin list and the audit log may show. Explicit on purpose: `SELECT *` would also pull password_hash and the encrypted
// 2FA secret into the audit log, which is append-only (it could never be cleaned up).
export const ACCOUNT_COLUMNS = `id, code, email, full_name, role, admin_status, totp_enabled, last_login_at, created_at`

export async function findAccount(id: bigint): Promise<AdminAccountListItem | null> {
  const res = await pool.query<AdminAccountListItem>(`SELECT ${ACCOUNT_COLUMNS} FROM admins WHERE id = $1 AND deleted_at IS NULL`, [id.toString()])
  return res.rows[0] ?? null
}

export async function getPasswordHash(id: bigint): Promise<string | null> {
  const res = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM admins WHERE id = $1 AND is_active = true AND deleted_at IS NULL`, [id.toString()])
  return res.rows[0]?.password_hash ?? null
}

/**
 * Locks every active super admin (in id order, so two requests can never deadlock) and returns their ids. Used before anything that could
 * remove the last one: two super admins removing each other at the same instant would otherwise both pass an "is anyone else left?" check.
 */
export async function lockActiveSuperAdmins(client: PoolClient): Promise<string[]> {
  const res = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM admins WHERE role = 'super_admin' AND is_active = true AND deleted_at IS NULL ORDER BY id FOR UPDATE`
  )
  return res.rows.map((r) => r.id)
}

/** There must always be at least one active super admin besides the one being demoted, removed or suspended. */
export function assertAnotherSuperRemains(activeSupers: string[], targetId: string): void {
  if (!activeSupers.some((id) => id !== targetId)) throw createHttpError(AppErrors.ADMIN_LAST_SUPER)
}

async function revokeRefreshTokens(client: PoolClient, id: string): Promise<void> {
  await client.query(
    `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE principal_role = $1 AND principal_id = $2 AND revoked_at IS NULL`,
    [PrincipalRole.ADMIN, id]
  )
}

export async function changeRole(targetId: bigint, role: AdminRole): Promise<{ before: AdminAccountListItem; after: AdminAccountListItem } | null> {
  return withTransaction(async (client) => {
    const supers = await lockActiveSuperAdmins(client)
    const before = (await client.query<AdminAccountListItem>(`SELECT ${ACCOUNT_COLUMNS} FROM admins WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [targetId.toString()])).rows[0]
    if (!before) return null
    if (before.role === 'super_admin' && role !== 'super_admin') assertAnotherSuperRemains(supers, before.id)
    const after = (await client.query<AdminAccountListItem>(`UPDATE admins SET role = $2, updated_at = now() WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`, [targetId.toString(), role])).rows[0]!
    return { before, after }
  })
}

/** Soft-deletes the account: signed out everywhere, cannot sign in, and the address is freed so the person can be invited again. */
export async function removeAccount(targetId: bigint): Promise<AdminAccountListItem | null> {
  return withTransaction(async (client) => {
    const supers = await lockActiveSuperAdmins(client)
    const before = (await client.query<AdminAccountListItem>(`SELECT ${ACCOUNT_COLUMNS} FROM admins WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [targetId.toString()])).rows[0]
    if (!before) return null
    if (before.role === 'super_admin') assertAnotherSuperRemains(supers, before.id)
    // "priya@ocar.com" becomes "priya+removed-12@ocar.com": still readable in the audit trail, and the original address is free again.
    await client.query(
      `UPDATE admins
          SET deleted_at = now(), is_active = false, admin_status = 'suspended', sessions_valid_from = now(), updated_at = now(),
              email = split_part(email::text, '@', 1) || '+removed-' || id || '@' || split_part(email::text, '@', 2)
        WHERE id = $1`,
      [targetId.toString()]
    )
    await revokeRefreshTokens(client, before.id)
    return before
  })
}

/** Switches 2FA off for the account (the person sets it up again at their next sign-in) and signs them out everywhere. */
export async function resetTotp(targetId: bigint): Promise<boolean> {
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE admins SET totp_enabled = false, totp_secret_enc = NULL, totp_last_timestep = NULL, sessions_valid_from = now(), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL`,
      [targetId.toString()]
    )
    if (res.rowCount === 0) return false
    await client.query('DELETE FROM admin_recovery_codes WHERE admin_id = $1', [targetId.toString()])
    await revokeRefreshTokens(client, targetId.toString())
    return true
  })
}

/** Every access token issued before now stops working (not only after it expires), and every refresh token is revoked. */
export async function signOutEverywhere(targetId: bigint): Promise<boolean> {
  return withTransaction(async (client) => {
    const res = await client.query(`UPDATE admins SET sessions_valid_from = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [targetId.toString()])
    if (res.rowCount === 0) return false
    await revokeRefreshTokens(client, targetId.toString())
    return true
  })
}
