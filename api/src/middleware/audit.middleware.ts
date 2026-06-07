import { RequestHandler } from 'express'
import { query } from '@/db/client'

export function auditLog(action: string, entityType: string): RequestHandler {
  return (req, _res, next) => {
    const principalId = req.user?.id ?? req.driver?.id ?? req.admin?.id ?? null
    const table = req.user ? 'user_audit_logs' : req.driver ? 'driver_audit_logs' : null

    if (table && principalId !== null) {
      // Fire-and-forget — never block the request
      query(
        `INSERT INTO ${table}
           (${req.user ? 'user_id' : 'driver_id'}, action, entity_type, ip_address, user_agent, request_id, created_at)
         VALUES ($1, $2, $3, $4::inet, $5, $6, now())`,
        [
          principalId.toString(),
          action,
          entityType,
          req.ip ?? null,
          req.headers['user-agent'] ?? null,
          req.requestId ?? null,
        ]
      ).catch(() => {
        // Audit failures must never surface to the caller
      })
    }

    next()
  }
}
