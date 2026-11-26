import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import * as service from './admin-audit.service'
import { recordAuditLog } from '@/lib/audit-log'
import type { AuditFilters } from './admin-audit.types'

const isoDate = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'invalid date')
const filterSchema = z.object({
  admin_id: z.string().regex(/^\d{1,18}$/).optional(),
  action: z.string().max(1000).optional(),         // comma-separated; a trailing * means "starts with"
  target_table: z.string().max(60).optional(),
  target_id: z.string().regex(/^\d{1,18}$/).optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  source: z.enum(['service', 'http', 'auth', 'system']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(200).optional(),
})

const listSchema = filterSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().regex(/^\d{1,18}$/).optional(),
})

function toFilters(q: z.infer<typeof filterSchema>): AuditFilters {
  const f: AuditFilters = {}
  if (q.admin_id) f.adminId = q.admin_id
  if (q.action) f.actions = q.action.split(',').map(s => s.trim()).filter(Boolean).slice(0, 30)
  if (q.target_table) f.targetTable = q.target_table
  if (q.target_id) f.targetId = q.target_id
  if (q.outcome) f.outcome = q.outcome
  if (q.source) f.source = q.source
  if (q.from) f.from = new Date(q.from).toISOString()
  if (q.to) f.to = new Date(q.to).toISOString()
  if (q.q) f.q = q.q
  return f
}

export async function getAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid filters', code: 'VALIDATION_ERROR' }); return }
    const { limit, before, ...rest } = parsed.data
    const query: { filters: AuditFilters; limit?: number; before?: string } = { filters: toFilters(rest) }
    if (limit !== undefined) query.limit = limit
    if (before) query.before = before
    res.json(await service.listAuditLog(query))
  } catch (err) {
    next(err)
  }
}

export async function getFacets(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.getFacets())
  } catch (err) {
    next(err)
  }
}

export async function getVerify(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.verifyChain())
  } catch (err) {
    next(err)
  }
}

export async function getExport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = filterSchema.safeParse(req.query)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid filters', code: 'VALIDATION_ERROR' }); return }
    const filters = toFilters(parsed.data)
    const { csv, rows, truncated } = await service.exportCsv(filters)
    // Exporting the audit log is itself something to audit: who took a copy, and with which filters.
    await recordAuditLog({
      adminId: req.admin!.id, action: 'audit_log.export', targetTable: 'admin_audit_log',
      afterState: { filters, rows, truncated },
    })
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="ocar-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.setHeader('X-Export-Truncated', truncated ? '1' : '0')
    res.send(csv)
  } catch (err) {
    next(err)
  }
}
