import { pool } from '@/db/client'
import type { AuditLogRow } from './admin-audit.types'

export async function listAuditLog(params: {
  limit: number
  offset: number
}): Promise<{ rows: AuditLogRow[]; total: number }> {
  const countRes = await pool.query('SELECT COUNT(*) FROM admin_audit_log')
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query<AuditLogRow>(
    `SELECT
       l.id, l.admin_id, a.email AS admin_email, a.role AS admin_role,
       l.action, l.target_table, l.target_id,
       l.before_state, l.after_state, l.ip_address, l.reason, l.created_at
     FROM admin_audit_log l
     LEFT JOIN admins a ON a.id = l.admin_id
     ORDER BY l.created_at DESC
     LIMIT $1 OFFSET $2`,
    [params.limit, params.offset]
  )

  return { rows: dataRes.rows, total }
}

// Scoped to one target (e.g. one driver) — narrower than listAuditLog so it's
// safe to expose to ops_admin, unlike the all-entities /admin/audit-log view
// which stays super_admin-only.
export async function listAuditLogForTarget(params: {
  targetTable: string
  targetId: bigint
  limit: number
  offset: number
}): Promise<{ rows: AuditLogRow[]; total: number }> {
  const countRes = await pool.query(
    'SELECT COUNT(*) FROM admin_audit_log WHERE target_table = $1 AND target_id = $2',
    [params.targetTable, params.targetId]
  )
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query<AuditLogRow>(
    `SELECT
       l.id, l.admin_id, a.email AS admin_email, a.role AS admin_role,
       l.action, l.target_table, l.target_id,
       l.before_state, l.after_state, l.ip_address, l.reason, l.created_at
     FROM admin_audit_log l
     LEFT JOIN admins a ON a.id = l.admin_id
     WHERE l.target_table = $1 AND l.target_id = $2
     ORDER BY l.created_at DESC
     LIMIT $3 OFFSET $4`,
    [params.targetTable, params.targetId, params.limit, params.offset]
  )

  return { rows: dataRes.rows, total }
}
