import { query, withTransaction } from '@/db/client'
import type { AdminInviteRecord, AdminInviteListItem, CreatedAdminFromInvite } from './admin-invites.types'

// Column list used for anything that leaves this module — token_hash is never
// selected outside the redemption lookup below.
// status: a pending invite past its expiry is reported as 'expired' (the row itself is only rewritten if someone tries to use it), so the list,
// the duplicate check and the accept page all agree.
const LIST_COLUMNS = `
  id, email, full_name, role, invited_by,
  CASE WHEN status = 'pending' AND expires_at <= now() THEN 'expired' ELSE status END AS status,
  expires_at, accepted_at, accepted_admin_id, email_status, email_error, created_at, updated_at
`

export async function createInvite(params: {
  email: string
  role: string
  tokenHash: string
  invitedBy: bigint
  expiresAt: Date
  fullName?: string | null
}): Promise<AdminInviteListItem> {
  const rows = await query<AdminInviteListItem>(
    `INSERT INTO admin_invites (email, role, token_hash, invited_by, expires_at, email_status, full_name)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6)
     RETURNING ${LIST_COLUMNS}`,
    [params.email, params.role, params.tokenHash, params.invitedBy.toString(), params.expiresAt, params.fullName ?? null]
  )
  return rows[0]!
}

// Any admin row, including a removed one: admins.email is unique across all of them, so activating would fail either way.
export async function adminEmailExists(email: string): Promise<boolean> {
  const rows = await query<{ one: number }>(`SELECT 1 AS one FROM admins WHERE email = $1 LIMIT 1`, [email])
  return rows.length > 0
}

export async function findAdminEmailById(id: bigint): Promise<string | null> {
  const rows = await query<{ email: string }>(`SELECT email FROM admins WHERE id = $1`, [id.toString()])
  return rows[0]?.email ?? null
}

/** How to name an admin to someone else: their name when they have one, otherwise their address. */
export async function findAdminLabelById(id: bigint): Promise<string | null> {
  const rows = await query<{ label: string }>(`SELECT COALESCE(NULLIF(full_name, ''), email) AS label FROM admins WHERE id = $1`, [id.toString()])
  return rows[0]?.label ?? null
}

export async function findPendingInviteByEmail(email: string): Promise<AdminInviteListItem | null> {
  const rows = await query<AdminInviteListItem>(
    `SELECT ${LIST_COLUMNS} FROM admin_invites WHERE email = $1 AND status = 'pending' AND expires_at > now() LIMIT 1`,
    [email]
  )
  return rows[0] ?? null
}

// Read-only lookup for pre-flight validation (accept-invite page load) —
// unlike redeemInvite, this never mutates status, even for an expired row.
export async function findByTokenHash(tokenHash: string): Promise<AdminInviteListItem | null> {
  const rows = await query<AdminInviteListItem>(
    `SELECT ${LIST_COLUMNS} FROM admin_invites WHERE token_hash = $1 LIMIT 1`,
    [tokenHash]
  )
  return rows[0] ?? null
}

export async function listInvites(): Promise<AdminInviteListItem[]> {
  return query<AdminInviteListItem>(
    `SELECT ${LIST_COLUMNS} FROM admin_invites ORDER BY created_at DESC LIMIT 200`
  )
}

// Replaces the link of a live or lapsed invite with a new one (the old link stops working: its hash is gone) and restarts the 48 hours.
// One statement, so two resends at once cannot both pass the cooldown: the second finds the new link_issued_at.
export async function reissueInvite(params: { id: bigint; tokenHash: string; expiresAt: Date; cooldownSeconds: number }): Promise<AdminInviteListItem | null> {
  const rows = await query<AdminInviteListItem>(
    `UPDATE admin_invites
        SET token_hash = $2, expires_at = $3, status = 'pending', email_status = 'queued', email_error = NULL,
            email_updated_at = now(), link_issued_at = now()
      WHERE id = $1 AND status IN ('pending', 'expired') AND link_issued_at <= now() - make_interval(secs => $4::int)
      RETURNING ${LIST_COLUMNS}`,
    [params.id.toString(), params.tokenHash, params.expiresAt, params.cooldownSeconds]
  )
  return rows[0] ?? null
}

// Why a resend was refused, read after the fact: whether the invite can be resent at all, and how many seconds are left on the cooldown.
export async function resendBlocker(id: bigint, cooldownSeconds: number): Promise<{ resendable: boolean; waitSeconds: number } | null> {
  const rows = await query<{ resendable: boolean; wait: number }>(
    `SELECT status IN ('pending', 'expired') AS resendable,
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM (link_issued_at + make_interval(secs => $2::int) - now()))))::int AS wait
       FROM admin_invites WHERE id = $1`,
    [id.toString(), cooldownSeconds]
  )
  return rows[0] ? { resendable: rows[0].resendable, waitSeconds: rows[0].wait } : null
}

// Records what happened to the email for ONE link. Matched on that link's own hash, so a job for a link that has since been replaced by a
// resend cannot overwrite the status of the new one.
export async function markInviteEmail(params: { id: bigint; tokenHash: string; status: 'sent' | 'failed'; error?: string }): Promise<void> {
  await query(
    `UPDATE admin_invites SET email_status = $3, email_error = $4, email_updated_at = now() WHERE id = $1 AND token_hash = $2`,
    [params.id.toString(), params.tokenHash, params.status, params.error ? params.error.slice(0, 300) : null]
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
}): Promise<{ admin: CreatedAdminFromInvite; inviteId: string; invitedBy: string } | null> {
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
      `INSERT INTO admins (email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, email, role`,
      [invite.email, params.passwordHash, invite.role, invite.full_name]
    )
    const admin = inserted.rows[0]!

    await client.query(
      `UPDATE admin_invites
       SET status = 'accepted', accepted_at = now(), accepted_admin_id = $2
       WHERE id = $1`,
      [invite.id, admin.id]
    )

    return { admin, inviteId: invite.id, invitedBy: invite.invited_by }
  })
}
