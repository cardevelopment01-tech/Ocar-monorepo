import { z } from 'zod'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { getPresignedUrl } from '@/lib/storage'
import { getConfigValue } from '@/lib/system-config'
import { recordAuditLog } from '@/lib/audit-log'
import * as repo from './verification-review.repository'

const LIST_LIMIT = 200 // the queue is sized for 20-30 cases a day; this is a ceiling, not a page size

export async function list(state: 'queued' | 'resolved_today') {
  const items = state === 'queued' ? await repo.listQueued(LIST_LIMIT) : await repo.listResolvedToday(LIST_LIMIT)
  const budget = Number(await getConfigValue('verification_review_daily_budget', '30')) || 30
  return { items, budget }
}

// Photos are private in prod; links are short-lived and the page re-requests the case if one expires.
export async function getCase(id: bigint) {
  const c = await repo.getCase(id)
  if (!c) throw createHttpError(AppErrors.NOT_FOUND)
  const [imageUrl, referenceUrls] = await Promise.all([
    getPresignedUrl(c.imageUrl, 3600),
    Promise.all(c.referenceUrls.map((u) => getPresignedUrl(u, 3600))),
  ])
  return { case: { ...c, imageUrl, referenceUrls } }
}

const resolveSchema = z.object({
  outcome: z.enum(['ok', 'mismatch']),
  note: z.string().trim().max(500).optional(),
  add_reference: z.boolean().optional(),
}).refine((b) => b.outcome !== 'mismatch' || (b.note ?? '').length > 0, { message: 'A note is required for a mismatch', path: ['note'] })

export async function resolve(adminId: bigint, id: bigint, body: unknown, ip: string | null) {
  const b = resolveSchema.parse(body)
  const result = await repo.resolve({
    id, adminId, outcome: b.outcome, note: b.note ?? null, addReference: b.add_reference === true,
  })
  if (result.kind === 'not_found') throw createHttpError(AppErrors.NOT_FOUND)
  if (result.kind === 'already_resolved') {
    throw httpError(409, 'Another admin already resolved this case.', 'ALREADY_RESOLVED')
  }
  await recordAuditLog({
    adminId,
    action: b.outcome === 'ok' ? 'verification.confirm_ok' : 'verification.confirm_mismatch',
    targetTable: 'driver_verifications',
    targetId: id,
    beforeState: { review_state: 'queued', status: result.before.status },
    afterState: { ...result.after, add_reference: b.add_reference === true },
    ipAddress: ip,
    reason: b.note ?? null,
  })
  return { ok: true }
}

export async function stats() {
  const [s, budget] = await Promise.all([
    repo.getStats(),
    getConfigValue('verification_review_daily_budget', '30'),
  ])
  return { ...s, budget: Number(budget) || 30 }
}
