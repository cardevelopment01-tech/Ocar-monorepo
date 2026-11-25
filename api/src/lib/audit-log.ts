import type { Pool, PoolClient } from 'pg'
import type { Request } from 'express'
import { pool } from '@/db/client'
import { auditQueue } from '@/jobs/queues'
import { logger } from '@/lib/logger'
import { auditContext } from '@/lib/audit-context'
import { redactAudit, changedFields } from '@/lib/audit-redact'
import { auditWriteFailuresTotal } from '@/observability/metrics'

export type AuditOutcome = 'success' | 'failure' | 'denied'
export type AuditSource = 'service' | 'http' | 'auth' | 'system'

// What gets stored, and what travels through the fallback queue. Field names for the first eight match the old
// queue payload, so jobs already waiting in Redis during a deploy still work.
export interface AuditLogJobData {
  adminId: string | null
  action: string
  targetTable: string
  targetId: string | null
  beforeState: Record<string, unknown> | null
  afterState: Record<string, unknown> | null
  ipAddress: string | null
  reason: string | null
  outcome?: AuditOutcome
  source?: AuditSource
  requestId?: string | null
  userAgent?: string | null
  changedFields?: string[] | null
  summary?: string | null
  httpMethod?: string | null
  httpPath?: string | null
  httpStatus?: number | null
  occurredAt?: string | null
}

export interface AuditEntry {
  adminId?: bigint | null
  action: string
  targetTable: string
  targetId?: bigint | null
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  ipAddress?: string | null
  reason?: string | null
  outcome?: AuditOutcome
  source?: AuditSource
  summary?: string | null
  http?: { method: string; path: string; status: number }
  requestId?: string | null
  userAgent?: string | null
  // Pass the open transaction's client to write the audit row in the SAME transaction as the change: if either
  // fails, both roll back, so a change can never exist without its record. Errors then propagate to the caller.
  client?: Pick<Pool | PoolClient, 'query'>
}

const log = logger.child({ module: 'audit' })

// Actions worth a push to every super admin the moment they happen.
const RISKY = /^(drivers\.delete|admins\.|admin_totp\.disabled|system_config\.|maintenance_mode\.|audit_log\.export|analytics_export$)|balance|force-resolve|rate-cards\.create|reset-2fa|sign-out|\.role\./
export function isRiskyAction(action: string, outcome: AuditOutcome = 'success'): boolean {
  return outcome === 'success' && RISKY.test(action)
}

export function humanizeAction(action: string): string {
  const s = action.replace(/[._-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function makeSummary(p: AuditEntry, fields: string[] | null): string {
  const target = p.targetId != null ? ` · ${p.targetTable} #${p.targetId}` : p.targetTable ? ` · ${p.targetTable}` : ''
  const changed = fields && fields.length > 0 ? ` · ${fields.slice(0, 5).join(', ')}${fields.length > 5 ? '…' : ''}` : ''
  const failed = p.outcome && p.outcome !== 'success' ? ` (${p.outcome})` : ''
  return `${humanizeAction(p.action)}${failed}${target}${changed}`.slice(0, 300)
}

function clip(v: string | null | undefined, n: number): string | null {
  return v ? v.slice(0, n) : null
}

export function buildAuditRow(p: AuditEntry, req?: Request): AuditLogJobData {
  const adminId = p.adminId !== undefined ? p.adminId : (req?.admin?.id ?? null)
  const fields = changedFields(p.beforeState, p.afterState)
  const ua = p.userAgent !== undefined ? p.userAgent : (req?.headers['user-agent'] as string | undefined)
  return {
    adminId: adminId?.toString() ?? null,
    action: p.action,
    targetTable: p.targetTable,
    targetId: p.targetId != null ? p.targetId.toString() : null,
    beforeState: redactAudit(p.beforeState),
    afterState: redactAudit(p.afterState),
    ipAddress: clip(p.ipAddress !== undefined ? p.ipAddress : (req?.ip ?? null), 45),
    reason: p.reason ?? null,
    outcome: p.outcome ?? 'success',
    source: p.source ?? 'service',
    requestId: clip(p.requestId !== undefined ? p.requestId : req?.requestId, 100),
    userAgent: clip(ua, 300),
    changedFields: fields,
    summary: p.summary ?? makeSummary(p, fields),
    httpMethod: p.http?.method ?? null,
    httpPath: clip(p.http?.path, 300),
    httpStatus: p.http?.status ?? null,
    occurredAt: null,
  }
}

// One INSERT, shared by the direct path, the transactional path and the fallback queue worker. The actor's email
// and role are copied in at write time so the row stays readable after that admin is renamed or removed.
export async function insertAuditRow(db: Pick<Pool | PoolClient, 'query'>, d: AuditLogJobData): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_log
       (admin_id, action, target_table, target_id, before_state, after_state, ip_address, reason,
        outcome, source, request_id, user_agent, actor_email, actor_role, changed_fields, summary,
        http_method, http_path, http_status, occurred_at)
     SELECT $1::bigint, $2, $3, $4::bigint, $5::jsonb, $6::jsonb, $7, $8,
            $9, $10, $11, $12, a.email, a.role, $13::text[], $14,
            $15, $16, $17::int, $18::timestamptz
     FROM (SELECT 1) one LEFT JOIN admins a ON a.id = $1::bigint`,
    [
      d.adminId, d.action, d.targetTable, d.targetId,
      d.beforeState ? JSON.stringify(d.beforeState) : null,
      d.afterState ? JSON.stringify(d.afterState) : null,
      d.ipAddress, d.reason,
      d.outcome ?? 'success', d.source ?? 'service', d.requestId ?? null, d.userAgent ?? null,
      d.changedFields ?? null, d.summary ?? null,
      d.httpMethod ?? null, d.httpPath ?? null, d.httpStatus ?? null, d.occurredAt ?? null,
    ],
  )
}

function alertRisky(d: AuditLogJobData): void {
  if (!isRiskyAction(d.action, d.outcome)) return
  void import('@/modules/notifications/notifications.service')
    .then(m => m.notifyAllAdmins({
      type: 'audit_risky_action',
      title: 'Sensitive admin action',
      body: d.summary ?? humanizeAction(d.action),
      payload: { action: d.action, targetTable: d.targetTable, targetId: d.targetId, adminId: d.adminId },
      roles: ['super_admin'],
    }))
    .catch(err => log.error({ err }, 'risky audit alert failed'))
}

// Writes one audit row. Without `client` it never throws: the change it describes has already happened, so a failed
// insert falls back to the retrying queue, and only if that also fails is it counted (audit_write_failures_total) and
// logged. With `client` the row joins the caller's transaction and any error propagates so both roll back.
async function write(params: AuditEntry, countsAsOwnRow: boolean): Promise<void> {
  const ctx = auditContext.getStore()
  const row = buildAuditRow(params, ctx?.req)

  if (params.client) {
    await insertAuditRow(params.client, row)
    if (ctx && countsAsOwnRow) ctx.recorded += 1
    alertRisky(row)
    return
  }

  try {
    await insertAuditRow(pool, row)
  } catch (err) {
    auditWriteFailuresTotal.inc({ stage: 'direct' })
    log.error({ err, action: row.action }, 'audit insert failed, queueing for retry')
    try {
      await auditQueue.add('record', row, { attempts: 5, backoff: { type: 'exponential', delay: 2000 } })
    } catch (qerr) {
      auditWriteFailuresTotal.inc({ stage: 'queue' })
      log.error({ err: qerr, row }, 'AUDIT ROW LOST: direct insert and queue both failed')
    }
  }
  if (ctx && countsAsOwnRow) ctx.recorded += 1
  alertRisky(row)
}

/** A handler's own audit row (with before/after and reason). Tells the admin-activity middleware not to add a generic one. */
export function recordAuditLog(params: AuditEntry): Promise<void> {
  return write(params, true)
}

/** The middleware's catch-all row. Same storage, but does not count as the handler having audited itself. */
export function recordAdminActivity(params: AuditEntry): Promise<void> {
  return write(params, false)
}
