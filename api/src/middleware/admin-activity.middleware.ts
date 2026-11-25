import type { RequestHandler } from 'express'
import { auditContext, type AuditContext } from '@/lib/audit-context'
import { recordAuditLog } from '@/lib/audit-log'
import type { AuditOutcome } from '@/lib/audit-log'

// Every non-GET request under /api/v1/admin is an admin action. Handlers that know the before/after state write
// their own detailed row (recordAuditLog); this middleware guarantees nobody has to remember to:
//  - a successful request whose handler wrote no row of its own gets one generic row (who, what route, request body)
//  - a refused (403) or failed request always gets a row, even when the handler wrote one, so denied attempts show up
// It also opens the AsyncLocalStorage context recordAuditLog() reads request id, IP and user agent from.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const ACTION_WORDS = new Set([
  'approve', 'reject', 'cancel', 'assign', 'resolve', 'acknowledge', 'blacklist', 'unblacklist',
  'force-resolve', 'reset-2fa', 'sign-out', 'status', 'role', 'balance', 'boundary',
])
const VERB: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27})$/i
// Reads that happen to be POSTs, and the audit log's own routes, are not admin actions.
const SKIP = /\/preview$|^\/audit-log(\/|$)|^\/notifications\/read/

export interface DerivedAction { action: string; targetTable: string; targetId: bigint | null; path: string }

export function deriveAdminAction(method: string, adminPath: string): DerivedAction {
  const clean = adminPath.split('?')[0]!.replace(/\/+$/, '')
  const segs = clean.split('/').filter(Boolean)
  const words: string[] = []
  let targetId: bigint | null = null
  for (const s of segs) {
    if (ID_SEGMENT.test(s)) {
      if (targetId === null && /^\d+$/.test(s) && s.length < 19) targetId = BigInt(s)
      continue
    }
    words.push(s)
  }
  const last = words[words.length - 1] ?? ''
  const verb = VERB[method] ?? method.toLowerCase()
  const base = words.join('.') || 'admin'
  // "approve", "assign" … already say what happened; "create"/"update" is only added to bare resource paths.
  const action = ACTION_WORDS.has(last) && !(method === 'DELETE') ? base : `${base}.${verb}`
  return { action, targetTable: words[0] ?? 'admin', targetId, path: clean }
}

export const adminActivity: RequestHandler = (req, res, next) => {
  const ctx: AuditContext = { req, recorded: 0 }
  if (!MUTATING.has(req.method)) { auditContext.run(ctx, next); return }

  res.on('finish', () => {
    const admin = req.admin
    if (!admin) return // unauthenticated: nothing to attribute, and the auth layer already logs the attempt
    const adminPath = req.originalUrl.split('?')[0]!.replace(/^\/api\/v1\/admin/, '') || '/'
    if (SKIP.test(adminPath)) return
    const status = res.statusCode
    // Form validation errors (400/404/422) are noise, not events; refusals, conflicts and server errors are kept.
    if (status >= 400 && status !== 403 && status !== 409 && status < 500) return
    const outcome: AuditOutcome = status === 403 ? 'denied' : status >= 400 ? 'failure' : 'success'
    if (outcome === 'success' && ctx.recorded > 0) return
    const d = deriveAdminAction(req.method, adminPath)
    void auditContext.run(ctx, () => recordAuditLog({
      adminId: admin.id,
      action: d.action,
      targetTable: d.targetTable,
      targetId: d.targetId,
      afterState: { request: (req.body ?? null) as Record<string, unknown> | null },
      outcome,
      source: 'http',
      http: { method: req.method, path: d.path, status },
    })).catch(() => { /* recordAuditLog already handles its own failures */ })
  })

  auditContext.run(ctx, next)
}
