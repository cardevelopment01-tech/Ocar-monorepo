import { AppErrors } from '@/constants/errors'
import type { AdminRole } from '@/constants/enums'
import { client as redis } from '@/db/redis'
import { adminPrincipalKey } from '@/constants/redis-keys'
import { createHttpError, httpError } from '@/lib/errors'
import { comparePassword } from '@/lib/hash'
import { recordAuditLog } from '@/lib/audit-log'
import { logger } from '@/lib/logger'
import * as repo from './admin-lifecycle.repository'
import type { AdminAccountListItem } from './admin.types'

const log = logger.child({ module: 'admin-lifecycle' })

/**
 * Drops the cached copy of an admin that every request is checked against (it lives 20 seconds), so a role change, removal or sign-out takes
 * effect on the very next request instead of up to 20 seconds later. A failure here is harmless: the copy expires by itself.
 */
export async function forgetAdminPrincipal(id: string | bigint): Promise<void> {
  try {
    await redis.del(adminPrincipalKey(id))
  } catch (err) {
    log.warn({ err }, 'could not drop the cached admin; it will expire on its own')
  }
}

/** Re-asks for the acting admin's own password before a risky action (OWASP: re-authenticate before sensitive account changes). */
async function verifyStepUp(actingAdminId: bigint, password: string): Promise<void> {
  const hash = await repo.getPasswordHash(actingAdminId)
  // 403, never 401: the admin app treats a 401 as "your session expired" and would sign the person out for a typo.
  if (!hash || !(await comparePassword(password, hash))) throw createHttpError(AppErrors.ADMIN_STEP_UP_INVALID)
}

async function loadTarget(targetId: bigint, actingAdminId: bigint, what: string): Promise<AdminAccountListItem> {
  const target = await repo.findAccount(targetId)
  if (!target) throw createHttpError(AppErrors.NOT_FOUND)
  if (targetId === actingAdminId) throw httpError(422, `You cannot ${what} your own account`, AppErrors.VALIDATION_ERROR.code)
  return target
}

interface Acting { actingAdminId: bigint; ipAddress: string | null }

export async function changeRole(p: Acting & { targetId: bigint; role: AdminRole; password: string }): Promise<AdminAccountListItem> {
  const target = await loadTarget(p.targetId, p.actingAdminId, 'change the role of')
  if (target.role === p.role) throw httpError(422, 'That admin already has this role', AppErrors.VALIDATION_ERROR.code)
  await verifyStepUp(p.actingAdminId, p.password)

  const changed = await repo.changeRole(p.targetId, p.role)
  if (!changed) throw createHttpError(AppErrors.NOT_FOUND)
  await forgetAdminPrincipal(p.targetId) // the new role applies from their next request, not 20 seconds later

  await recordAuditLog({
    adminId: p.actingAdminId, action: 'admins.role_change', targetTable: 'admins', targetId: p.targetId,
    beforeState: { email: changed.before.email, role: changed.before.role }, afterState: { email: changed.after.email, role: changed.after.role },
    ipAddress: p.ipAddress,
  })
  return changed.after
}

export async function removeAdmin(p: Acting & { targetId: bigint; password: string; confirmEmail: string }): Promise<void> {
  const target = await loadTarget(p.targetId, p.actingAdminId, 'remove')
  // The same "type the email to confirm" the page asks for, enforced here too so a script cannot skip it.
  if (p.confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
    throw httpError(422, "Type the admin's email address exactly to confirm", AppErrors.VALIDATION_ERROR.code)
  }
  await verifyStepUp(p.actingAdminId, p.password)

  const removed = await repo.removeAccount(p.targetId)
  if (!removed) throw createHttpError(AppErrors.NOT_FOUND)
  await forgetAdminPrincipal(p.targetId)

  await recordAuditLog({
    adminId: p.actingAdminId, action: 'admins.remove', targetTable: 'admins', targetId: p.targetId,
    beforeState: { email: removed.email, role: removed.role, code: removed.code }, afterState: { removed: true },
    ipAddress: p.ipAddress,
  })
}

export async function resetTwoFactor(p: Acting & { targetId: bigint; password: string }): Promise<AdminAccountListItem> {
  const target = await loadTarget(p.targetId, p.actingAdminId, 'reset 2FA for')
  if (!target.totp_enabled) throw createHttpError(AppErrors.ADMIN_NO_2FA)
  await verifyStepUp(p.actingAdminId, p.password)

  if (!(await repo.resetTotp(p.targetId))) throw createHttpError(AppErrors.NOT_FOUND)
  await forgetAdminPrincipal(p.targetId)

  await recordAuditLog({
    adminId: p.actingAdminId, action: 'admins.reset_2fa', targetTable: 'admins', targetId: p.targetId,
    beforeState: { email: target.email, totp_enabled: true }, afterState: { totp_enabled: false, signed_out: true },
    ipAddress: p.ipAddress,
  })
  return { ...target, totp_enabled: false }
}

export async function signOutAdmin(p: Acting & { targetId: bigint; password: string }): Promise<void> {
  const target = await loadTarget(p.targetId, p.actingAdminId, 'sign out')
  await verifyStepUp(p.actingAdminId, p.password)

  if (!(await repo.signOutEverywhere(p.targetId))) throw createHttpError(AppErrors.NOT_FOUND)
  await forgetAdminPrincipal(p.targetId)

  await recordAuditLog({
    adminId: p.actingAdminId, action: 'admins.sign_out', targetTable: 'admins', targetId: p.targetId,
    beforeState: { email: target.email }, afterState: { signed_out: true },
    ipAddress: p.ipAddress,
  })
}
