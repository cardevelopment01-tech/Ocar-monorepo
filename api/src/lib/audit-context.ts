import { AsyncLocalStorage } from 'node:async_hooks'
import type { Request } from 'express'

// Carries the current request to recordAuditLog() so call sites don't have to pass request id, IP and user agent
// by hand, and so the admin-activity middleware can tell whether a handler already wrote its own audit row.
export interface AuditContext {
  req: Request
  recorded: number
}

export const auditContext = new AsyncLocalStorage<AuditContext>()
