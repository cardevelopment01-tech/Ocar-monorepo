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
       l.before_state, l.after_state, l.ip_address, l.created_at
     FROM admin_audit_log l
     LEFT JOIN admins a ON a.id = l.admin_id
     ORDER BY l.created_at DESC
     LIMIT $1 OFFSET $2`,
    [params.limit, params.offset]
  )

  return { rows: dataRes.rows, total }
}
