import crypto from 'crypto'
import { AppErrors } from '@/constants/errors'
import { createHttpError } from '@/lib/errors'
import { sha256, hashPassword } from '@/lib/hash'
import { notificationsQueue } from '@/jobs/queues'
import type { AdminRole } from '@/constants/enums'
import * as repo from './admin-invites.repository'
import type { AdminInviteListItem, CreatedAdminFromInvite } from './admin-invites.types'

const INVITE_TTL_MS = 48 * 60 * 60 * 1000

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function createInvite(params: {
  email: string
  role: AdminRole
  invitedBy: bigint
}): Promise<AdminInviteListItem> {
  const existing = await repo.findPendingInviteByEmail(params.email)
  if (existing) throw createHttpError(AppErrors.ADMIN_INVITE_DUPLICATE)

  const rawToken = generateInviteToken()
  const tokenHash = sha256(rawToken)
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  const invite = await repo.createInvite({
    email: params.email,
    role: params.role,
    tokenHash,
    invitedBy: params.invitedBy,
    expiresAt,
  })

  // The email transport (SES) isn't wired yet — the notifications worker
  // no-ops on unrecognized job names until that lands, so this is safe to
  // enqueue now and pick up once the worker handler exists.
  await notificationsQueue.add('admin_invite_email', {
    email: params.email,
    rawToken,
    expiresAt: expiresAt.toISOString(),
  })

  return invite
}

export async function listInvites(): Promise<AdminInviteListItem[]> {
  return repo.listInvites()
}

export async function revokeInvite(id: bigint): Promise<AdminInviteListItem> {
  const revoked = await repo.revokePendingInvite(id)
  if (!revoked) throw createHttpError(AppErrors.NOT_FOUND)
  return revoked
}

export async function redeemInvite(token: string, password: string): Promise<CreatedAdminFromInvite> {
  const tokenHash = sha256(token)
  const passwordHash = await hashPassword(password)

  const admin = await repo.redeemInvite({ tokenHash, passwordHash })
  if (!admin) throw createHttpError(AppErrors.ADMIN_INVITE_INVALID)

  return admin
}
