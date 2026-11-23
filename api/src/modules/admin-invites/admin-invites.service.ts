import crypto from 'crypto'
import { AppErrors } from '@/constants/errors'
import { createHttpError, httpError } from '@/lib/errors'
import { sha256, hashPassword } from '@/lib/hash'
import { recordAuditLog } from '@/lib/audit-log'
import { checkNewPassword } from '@/lib/password-policy'
import { notificationsQueue } from '@/jobs/queues'
import { logger } from '@/lib/logger'
import type { AdminRole } from '@/constants/enums'
import * as repo from './admin-invites.repository'
import { INVITE_TTL_HOURS, inviteLink, type AdminInviteEmailJob } from './admin-invite-email'
import type { AdminInviteListItem, CreatedAdminFromInvite } from './admin-invites.types'

const log = logger.child({ module: 'admin-invites' })

const INVITE_TTL_MS = INVITE_TTL_HOURS * 60 * 60 * 1000

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** A new invitation, or a resent one: the invite as stored, plus the activation link (the only time it can be shown: only its hash is kept). */
export interface IssuedInvite {
  invite: AdminInviteListItem
  link: string
}

const RESEND_COOLDOWN_SECONDS = 60

// The link is built BEFORE anything is stored: if the admin app's address is not set up properly (production, localhost), no invite is
// created with a link that cannot work.
function linkFor(rawToken: string): string {
  try {
    return inviteLink(rawToken)
  } catch (err) {
    throw httpError(503, err instanceof Error ? err.message : 'The invite link could not be built', 'INVITE_LINK_NOT_CONFIGURED')
  }
}

// Queues the email for a link that already exists. If the queue itself is down the invite is kept and marked "email failed" (with the reason),
// so the admin can still copy the link or resend it, instead of the whole invite failing. Returns false when it could not be queued.
async function queueEmail(job: AdminInviteEmailJob & { inviteId: string }): Promise<boolean> {
  try {
    await notificationsQueue.add('admin_invite_email', job, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: 50 })
    return true
  } catch (err) {
    log.error({ err, inviteId: job.inviteId }, 'admin invite email could not be queued')
    await repo
      .markInviteEmail({ id: BigInt(job.inviteId), tokenHash: sha256(job.rawToken), status: 'failed', error: 'The email could not be queued (the job queue is unavailable).' })
      .catch(() => undefined)
    return false
  }
}

const queueFailed = (invite: AdminInviteListItem): AdminInviteListItem => ({
  ...invite, email_status: 'failed', email_error: 'The email could not be queued (the job queue is unavailable).',
})

/** One line, single spaces, no control characters (they would break email headers and the page). Blank means no name. */
export function cleanFullName(raw: string | undefined): string | null {
  const name = (raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return name || null
}

export async function createInvite(params: {
  email: string
  fullName?: string
  role: AdminRole
  invitedBy: bigint
  ipAddress: string | null
}): Promise<IssuedInvite> {
  // The shared validate() middleware checks the body but does not replace it with the cleaned-up copy, so the address is normalised here:
  // "  Name@Ocar.com " must be the same person as "name@ocar.com" for the duplicate checks below.
  const email = params.email.trim().toLowerCase()

  // Without this the email goes out and the invitee only finds out at activation (a bare "Already exists").
  if (await repo.adminEmailExists(email)) throw createHttpError(AppErrors.ADMIN_ALREADY_EXISTS)

  // Only a live invite blocks a new one: after 48 hours an unanswered invite is expired, and the person can be invited again.
  const existing = await repo.findPendingInviteByEmail(email)
  if (existing) throw createHttpError(AppErrors.ADMIN_INVITE_DUPLICATE)

  const rawToken = generateInviteToken()
  const link = linkFor(rawToken)
  const tokenHash = sha256(rawToken)
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  const invite = await repo.createInvite({
    email,
    role: params.role,
    tokenHash,
    invitedBy: params.invitedBy,
    expiresAt,
    fullName: cleanFullName(params.fullName),
  })

  // The email names who invited them and as what: without that an invitation looks like phishing. Their own address is the one reply goes to.
  const inviterEmail = await repo.findAdminEmailById(params.invitedBy)
  const queued = await queueEmail({
    email,
    rawToken,
    expiresAt: expiresAt.toISOString(),
    role: params.role,
    inviteId: invite.id,
    ...(invite.full_name ? { fullName: invite.full_name } : {}),
    ...(inviterEmail ? { inviterEmail } : {}),
  })

  await recordAuditLog({
    adminId: params.invitedBy,
    action: 'admins.invite_create',
    targetTable: 'admin_invites',
    targetId: BigInt(invite.id),
    afterState: { email: invite.email, role: invite.role, expiresAt: expiresAt.toISOString() },
    ipAddress: params.ipAddress,
  })

  return { invite: queued ? invite : queueFailed(invite), link }
}

/**
 * Sends an invite again with a NEW link: the old one stops working at once (only the new one's hash is kept) and the 48 hours start over.
 * Works on a live invite (the email never came, or the link was lost) and on one that has lapsed. Not on an accepted or revoked one, and
 * not within a minute of the last send.
 */
export async function resendInvite(id: bigint, actingAdminId: bigint, ipAddress: string | null): Promise<IssuedInvite> {
  const existing = await repo.findInviteById(id)
  if (!existing) throw createHttpError(AppErrors.NOT_FOUND)
  // They may have joined by another route since: a new link would only lead to "already exists" at activation.
  if (await repo.adminEmailExists(existing.email)) throw createHttpError(AppErrors.ADMIN_ALREADY_EXISTS)

  const rawToken = generateInviteToken()
  const link = linkFor(rawToken)
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  const invite = await repo.reissueInvite({ id, tokenHash: sha256(rawToken), expiresAt, cooldownSeconds: RESEND_COOLDOWN_SECONDS })
  if (!invite) {
    const why = await repo.resendBlocker(id, RESEND_COOLDOWN_SECONDS)
    if (!why) throw createHttpError(AppErrors.NOT_FOUND)
    if (!why.resendable) throw createHttpError(AppErrors.ADMIN_INVITE_NOT_RESENDABLE)
    throw httpError(429, `Wait ${Math.max(1, why.waitSeconds)} seconds before resending`, 'ADMIN_INVITE_RESEND_TOO_SOON')
  }

  // The person resending is the one issuing this link now, so the email names them and replies go to them.
  const inviterEmail = await repo.findAdminEmailById(actingAdminId)
  const queued = await queueEmail({
    email: invite.email,
    rawToken,
    expiresAt: expiresAt.toISOString(),
    role: invite.role,
    inviteId: invite.id,
    ...(invite.full_name ? { fullName: invite.full_name } : {}),
    ...(inviterEmail ? { inviterEmail } : {}),
  })

  await recordAuditLog({
    adminId: actingAdminId,
    action: 'admins.invite_resend',
    targetTable: 'admin_invites',
    targetId: id,
    beforeState: { status: existing.status, expiresAt: new Date(existing.expires_at).toISOString() },
    afterState: { status: 'pending', email: invite.email, role: invite.role, expiresAt: expiresAt.toISOString() },
    ipAddress,
  })

  return { invite: queued ? invite : queueFailed(invite), link }
}

export async function listInvites(): Promise<AdminInviteListItem[]> {
  return repo.listInvites()
}

export async function revokeInvite(id: bigint, actingAdminId: bigint, ipAddress: string | null): Promise<AdminInviteListItem> {
  const revoked = await repo.revokePendingInvite(id)
  if (!revoked) throw createHttpError(AppErrors.NOT_FOUND)

  await recordAuditLog({
    adminId: actingAdminId,
    action: 'admins.invite_revoke',
    targetTable: 'admin_invites',
    targetId: id,
    beforeState: { status: 'pending', email: revoked.email, role: revoked.role },
    afterState: { status: 'revoked' },
    ipAddress,
  })
  return revoked
}

// Read-only pre-flight check for the accept-invite page load — lets the
// frontend show an invalid/expired state before the user fills in a password,
// instead of only discovering it on submit. Never mutates invite status.
export async function verifyInviteToken(token: string): Promise<{ email: string; role: AdminRole }> {
  const tokenHash = sha256(token)
  const invite = await repo.findByTokenHash(tokenHash)
  const expired = invite ? new Date(invite.expires_at) <= new Date() : false

  if (!invite || invite.status !== 'pending' || expired) {
    throw createHttpError(AppErrors.ADMIN_INVITE_INVALID)
  }

  return { email: invite.email, role: invite.role }
}

export async function redeemInvite(token: string, password: string, ipAddress: string | null): Promise<CreatedAdminFromInvite> {
  const tokenHash = sha256(token)

  // The token is checked FIRST: a password is only screened for someone who holds a live invite, so this public endpoint can never be used
  // to test passwords against the breach list.
  const invite = await repo.findByTokenHash(tokenHash)
  if (!invite || invite.status !== 'pending' || new Date(invite.expires_at) <= new Date()) {
    throw createHttpError(AppErrors.ADMIN_INVITE_INVALID)
  }
  const problem = await checkNewPassword(password, { email: invite.email })
  if (problem) throw httpError(422, problem, 'WEAK_PASSWORD')

  const passwordHash = await hashPassword(password)
  const redeemed = await repo.redeemInvite({ tokenHash, passwordHash })
  if (!redeemed) throw createHttpError(AppErrors.ADMIN_INVITE_INVALID)

  await recordAuditLog({
    adminId: BigInt(redeemed.admin.id), // the new admin is the one acting here
    action: 'admins.invite_accept',
    targetTable: 'admins',
    targetId: BigInt(redeemed.admin.id),
    afterState: { email: redeemed.admin.email, role: redeemed.admin.role, inviteId: redeemed.inviteId, invitedBy: redeemed.invitedBy },
    ipAddress,
  })

  return redeemed.admin
}
