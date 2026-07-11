import { query, withTransaction } from '@/db/client'
import type { AdminInviteRecord, AdminInviteListItem, CreatedAdminFromInvite } from './admin-invites.types'

// Column list used for anything that leaves this module — token_hash is never
// selected outside the redemption lookup below.
const LIST_COLUMNS = `
  id, email, role, invited_by, status, expires_at,
  accepted_at, accepted_admin_id, created_at, updated_at
`

export async function createInvite(params: {
  email: string
  role: string
  tokenHash: string
  invitedBy: bigint
  expiresAt: Date
}): Promise<AdminInviteListItem> {
  const rows = await query<AdminInviteListItem>(
    `INSERT INTO admin_invites (email, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${LIST_COLUMNS}`,
    [params.email, params.role, params.tokenHash, params.invitedBy.toString(), params.expiresAt]
  )
  return rows[0]!
}

export async function findPendingInviteByEmail(email: string): Promise<AdminInviteListItem | null> {
  const rows = await query<AdminInviteListItem>(
    `SELECT ${LIST_COLUMNS} FROM admin_invites WHERE email = $1 AND status = 'pending' LIMIT 1`,
    [email]
  )
  return rows[0] ?? null
}

export async function listInvites(): Promise<AdminInviteListItem[]> {
  return query<AdminInviteListItem>(
    `SELECT ${LIST_COLUMNS} FROM admin_invites ORDER BY created_at DESC LIMIT 200`
  )
}

export async function findInviteById(id: bigint): Promise<AdminInviteListItem | null> {
  const rows = await query<AdminInviteListItem>(
    `SELECT ${LIST_COLUMNS} FROM admin_invites WHERE id = $1 LIMIT 1`,
    [id.toString()]
  )
  return rows[0] ?? null
}

export async function revokePendingInvite(id: bigint): Promise<AdminInviteListItem | null> {
  const rows = await query<AdminInviteListItem>(
    `UPDATE admin_invites SET status = 'revoked'
     WHERE id = $1 AND status = 'pending'
     RETURNING ${LIST_COLUMNS}`,
    [id.toString()]
  )
  return rows[0] ?? null
}

// Redeems a token: validates it, creates the admins row, and marks the invite
// accepted — all inside one transaction so a half-redeemed invite can't exist.
// Returns null for any invalid/expired/already-used token (caller maps to a
// single generic "invalid invite" error — no information leak about *why*).
export async function redeemInvite(params: {
  tokenHash: string
  passwordHash: string
}): Promise<CreatedAdminFromInvite | null> {
  return withTransaction(async client => {
    const existing = await client.query<AdminInviteRecord>(
      `SELECT * FROM admin_invites WHERE token_hash = $1 LIMIT 1 FOR UPDATE`,
      [params.tokenHash]
    )
    const invite = existing.rows[0]
    if (!invite) return null
    if (invite.status !== 'pending') return null

    if (new Date(invite.expires_at) <= new Date()) {
      await client.query(`UPDATE admin_invites SET status = 'expired' WHERE id = $1`, [invite.id])
      return null
    }

    const inserted = await client.query<CreatedAdminFromInvite>(
      `INSERT INTO admins (email, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, code, email, role`,
      [invite.email, params.passwordHash, invite.role]
    )
    const admin = inserted.rows[0]!

    await client.query(
      `UPDATE admin_invites
       SET status = 'accepted', accepted_at = now(), accepted_admin_id = $2
       WHERE id = $1`,
      [invite.id, admin.id]
    )

    return admin
  })
}
