// "The database is unreachable or restarting" is a dependency outage, not a client mistake. It must surface as
// 503 + Retry-After (retryable, credentials untouched), never as 401/500: clients treat 401 as "session dead" and
// refresh or log out, which is the wrong reaction to a failover.

// SQLSTATE: class 08 connection exceptions, 57P01-03 shutdown/crash/cannot connect now, 53300 too many
// connections, 25006 read-only transaction (writing to a node that just became a standby).
const PG_CODES = new Set(['57P01', '57P02', '57P03', '53300', '25006'])
const NET_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'])
// node-postgres raises these without a code
const MESSAGES = [
  'Connection terminated',
  'timeout exceeded when trying to connect',
  'Client has encountered a connection error',
  'the database system is starting up',
  'the database system is shutting down',
]

export function isDbUnavailable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; message?: unknown; errors?: unknown }
  if (typeof e.code === 'string' && (PG_CODES.has(e.code) || e.code.startsWith('08') || NET_CODES.has(e.code))) return true
  if (typeof e.message === 'string' && MESSAGES.some((m) => (e.message as string).includes(m))) return true
  // Node's happy-eyeballs connect failures arrive as an AggregateError of the individual socket errors
  return Array.isArray(e.errors) && e.errors.some(isDbUnavailable)
}

export const DB_RETRY_AFTER_SEC = 2

// "canceling statement due to statement timeout" (SQLSTATE 57014): the database is up, but a query ran past its time budget,
// which in practice means it is overloaded (saturated disk, a runaway query). Retryable like an outage, yet kept apart from
// isDbUnavailable so logs and callers can tell "restarting" from "too busy". A user-requested cancel is also 57014 and is
// NOT a timeout, hence the message check.
export function isDbStatementTimeout(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; message?: unknown }
  return e.code === '57014' && typeof e.message === 'string' && e.message.includes('statement timeout')
}

export const DB_BUSY_RETRY_AFTER_SEC = 5
