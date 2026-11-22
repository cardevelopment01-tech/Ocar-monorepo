import crypto from 'crypto'
import { AppErrors } from '@/constants/errors'
import { createHttpError, httpError } from '@/lib/errors'
import { sha256, hashPassword } from '@/lib/hash'
import { recordAuditLog } from '@/lib/audit-log'
import { checkNewPassword } from '@/lib/password-policy'
import { notificationsQueue } from '@/jobs/queues'
import type { AdminRole } from '@/constants/enums'
import * as repo from './admin-invites.repository'
import { INVITE_TTL_HOURS, type AdminInviteEmailJob } from './admin-invite-email'
import type { AdminInviteListItem, CreatedAdminFromInvite } from './admin-invites.types'

const INVITE_TTL_MS = INVITE_TTL_HOURS * 60 * 60 * 1000

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function createInvite(params: {
  email: string
  role: AdminRole
  invitedBy: bigint
  ipAddress: string | null
}): Promise<AdminInviteListItem> {
  // The shared validate() middleware checks the body but does not replace it with the cleaned-up copy, so the address is normalised here:
  // "  Name@Ocar.com " must be the same person as "name@ocar.com" for the duplicate checks below.
  const email = params.email.trim().toLowerCase()

  // Without this the email goes out and the invitee only finds out at activation (a bare "Already exists").
  if (await repo.adminEmailExists(email)) throw createHttpError(AppErrors.ADMIN_ALREADY_EXISTS)

  // Only a live invite blocks a new one: after 48 hours an unanswered invite is expired, and the person can be invited again.
  const existing = await repo.findPendingInviteByEmail(email)
  if (existing) throw createHttpError(AppErrors.ADMIN_INVITE_DUPLICATE)

  const rawToken = generateInviteToken()
  const tokenHash = sha256(rawToken)
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  const invite = await repo.createInvite({
    email,
    role: params.role,
    tokenHash,
    invitedBy: params.invitedBy,
    expiresAt,
  })

  // The email names who invited them and as what: without that an invitation looks like phishing. Their own address is the one reply goes to.
  const inviterEmail = await repo.findAdminEmailById(params.invitedBy)
  const job: AdminInviteEmailJob = {
    email,
    rawToken,
    expiresAt: expiresAt.toISOString(),
    role: params.role,
    ...(inviterEmail ? { inviterEmail } : {}),
  }
  await notificationsQueue.add(
    'admin_invite_email',
    job,
    { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: 50 }
  )

  await recordAuditLog({
    adminId: params.invitedBy,
    action: 'admins.invite_create',
    targetTable: 'admin_invites',
    targetId: BigInt(invite.id),
    afterState: { email: invite.email, role: invite.role, expiresAt: expiresAt.toISOString() },
    ipAddress: params.ipAddress,
  })

  return invite
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
