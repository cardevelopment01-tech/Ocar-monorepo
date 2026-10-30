// What the request-completed log line says about the request. Lives in its own file so a test can run it through the
// real pino-http (api/tests/unit/observability/http-log.test.ts).
//
// pino-http does NOT pass serializers the Express request. It passes a serialized copy (pino-std-serializers) that has
// no `ip`; the Express request, with its proxy-aware `ip`, is `req.raw`. Reading `req.ip` here silently logged nothing
// from 2026-08-08 on, so no log line could name the source address of an abuse case.
interface SerializedRequest {
  id?: unknown
  method?: string
  url?: string
  headers: Record<string, unknown>
  raw?: { ip?: string }
  remoteAddress?: string
}

export function serializeReq(req: SerializedRequest) {
  return {
    id: req.id,
    method: req.method,
    // No query string: admin-invites puts a real token there.
    url: req.url?.split('?')[0],
    // With `trust proxy` = 1 (app.ts) raw.ip is the client address from the ALB's X-Forwarded-For;
    // remoteAddress is the socket peer (the ALB) and is only a last resort.
    ip: req.raw?.ip ?? req.remoteAddress,
    userAgent: req.headers['user-agent'],
  }
}

// One request shape for the level policy and the actor props: pino-http infers a single request type for all its callbacks.
interface LoggedRequest {
  url?: string
  method?: string
  route?: unknown
  user?: { id: unknown }
  driver?: { id: unknown }
  admin?: { id: unknown }
}

export const serializeRes = (res: { statusCode: number }) => ({ statusCode: res.statusCode })

// Who made the request, so a log line can be tied to an account. authenticate() sets req.user / req.driver / req.admin
// after pino-http is mounted; pino-http evaluates customProps again when the response finishes, which is when this is read.
// Requests that never authenticated (scanners, failed logins) simply have no actor.
export function actorProps(req: LoggedRequest) {
  if (req.user) return { actor_role: 'user', actor_id: String(req.user.id) }
  if (req.driver) return { actor_role: 'driver', actor_id: String(req.driver.id) }
  if (req.admin) return { actor_role: 'admin', actor_id: String(req.admin.id) }
  return {}
}

// 404s that are not a problem. `warn` is for lines somebody should look at, and on prd 655 of 843 warnings in 12 hours were
// these two kinds:
//   - unmatched route: no handler claimed the path (internet scanners: /wp-login.php, /.env, /cms/ ...). Express leaves
//     req.route unset for them (observability/http-metrics.ts sets it when a route matches).
//   - answered on purpose: the driver app asks GET /rides/me/active and the API says 404 for "no active ride" (the app
//     relies on it, see apps/driver-mobile relaunchApi.ts). Rider /me/active-user answers 204 instead.
// They stay at `info`, so the S3 archive keeps them for investigations; Alloy keeps them out of Loki.
const EXPECTED_404 = new Set(['/api/v1/rides/me/active'])

// High-frequency polling that is real traffic but worthless at `info` (admin SOS count every 30 s, unread badges).
const isPolling = (method: string | undefined, path: string | undefined) =>
  Boolean(path?.includes('/unread-count')) || (path === '/api/v1/admin/safety/sos' && method === 'GET')

export function requestLogLevel(
  req: LoggedRequest,
  res: { statusCode: number },
  err?: unknown,
): 'error' | 'warn' | 'info' | 'debug' {
  if (res.statusCode >= 500 || err) return 'error'
  const path = req.url?.split('?')[0]
  if (res.statusCode === 404 && (req.route === undefined || (path !== undefined && EXPECTED_404.has(path)))) return 'info'
  if (res.statusCode >= 400) return 'warn'
  if (isPolling(req.method, path)) return 'debug'
  return 'info'
}
