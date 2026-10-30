import express, { Application, Router } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import pinoHttp from 'pino-http'
import { logger } from '@/lib/logger'
import { register } from '@/observability/metrics'
import { httpMetricsMiddleware } from '@/observability/http-metrics'
import { serializeReq, serializeRes, requestLogLevel, actorProps } from '@/observability/http-log'
import { config } from '@/config'
import { testConnection } from '@/db/client'
import { testConnection as testRedis } from '@/db/redis'
import { errorMiddleware } from '@/middleware/error.middleware'
import { maintenanceCheck } from '@/middleware/maintenance.middleware'
import { compressResponses } from '@/middleware/compression.middleware'
import { generalLimiter, authLimiter } from '@/middleware/rateLimit.middleware'
import authRouter from '@/modules/auth/auth.routes'
import driversRouter from '@/modules/drivers/drivers.routes'
import vehiclesRouter from '@/modules/vehicles/vehicles.routes'
import adminRouter from '@/modules/admin/admin.routes'
import geoRouter from '@/modules/geo/geo.routes'
import pricingRouter from '@/modules/pricing/pricing.routes'
import ridesRouter from '@/modules/rides/rides.routes'
import rideChatRouter from '@/modules/ride-chat/ride-chat.routes'
import paymentsRouter from '@/modules/payments/payments.routes'
import safetyRouter     from '@/modules/safety/safety.routes'
import usersRouter      from '@/modules/users/users.routes'
import savedPlacesRouter from '@/modules/saved-places/saved-places.routes'
import emergencyContactsRouter from '@/modules/emergency-contacts/emergency-contacts.routes'
import analyticsRouter  from '@/modules/analytics/analytics.routes'
import notificationsRouter from '@/modules/notifications/notifications.routes'
import templatesRouter from '@/modules/notifications/templates.routes'
import broadcastRouter from '@/modules/notifications/broadcast.routes'
import accountRouter from '@/modules/account/account.routes'
import systemConfigRouter from '@/modules/admin/system-config.routes'
import maintenanceRouter from '@/modules/admin/maintenance.routes'
import adminInvitesRouter from '@/modules/admin-invites/admin-invites.routes'
import adminAuditRouter from '@/modules/admin-audit/admin-audit.routes'
import adminTotpRouter from '@/modules/admin-totp/admin-totp.routes'
import settlementsRouter from '@/modules/payments/submodules/settlements/settlements.routes'
import settlementsAdminRouter from '@/modules/payments/submodules/settlements/settlements.admin.routes'
import callMaskingRouter from '@/modules/call-masking/call-masking.routes'

export function createApp(): Application {
  const app = express()
  app.set('trust proxy', 1)

  // 1. Attach requestId to every request
  app.use((req, _res, next) => {
    req.requestId = crypto.randomUUID()
    next()
  })

  // 1b. Structured request/response logging — reuses requestId (not a second
  // genReqId) so error responses and log lines correlate on the same field.
  app.use(pinoHttp({
    logger,
    genReqId: (req) => (req as import('express').Request).requestId,
    // Docker's internal healthcheck (Wget) hits this container directly,
    // bypassing nginx.prod.conf's `access_log off` for /health — so pino
    // was the only thing still logging it, once a minute forever. OPTIONS
    // preflights carry no diagnostic value either; they just double the
    // line count for every real request.
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/metrics' || req.method === 'OPTIONS',
    },
    // Level policy (tested in observability/http-log.ts): 5xx error, real 4xx warn, scanner/expected 404 and polling quiet.
    customLogLevel: requestLogLevel,
    // Who made the request (actor_role / actor_id): set by authenticate() later in the pipeline, read when the response ends.
    customProps: actorProps,
    // pino-http's default req/res serializers dump every header (helmet's
    // static CSP/HSTS block, repeated on every line) — pure log-volume waste
    // once shipped off-box. Worse: req.url includes the query string, and
    // admin-invites.controller.ts's GET verify route puts a real secret
    // there (`req.query['token']`) — logging it verbatim would ship that
    // token to Grafana Cloud. ip/userAgent are kept deliberately (useful for
    // OTP-brute-force/fraud investigation), bounded by Loki's 14-day
    // retention — not a byproduct of the header dump. The serializers live in
    // observability/http-log.ts (tested there): pino-http gives them a copy of
    // the request, so the client address is req.raw.ip, not req.ip.
    serializers: { req: serializeReq, res: serializeRes },
  }))

  // Request-duration metric, labelled with the full mounted route pattern (see observability/http-metrics.ts).
  app.use(httpMetricsMiddleware)

  // 1c. Maintenance short-circuit — after logging/metrics (so blocked
  // requests still show up there) but before rate-limiting/auth and every
  // route below, both of which are Redis/DB-touching. /health and /metrics
  // bypass it internally (see maintenance.middleware.ts).
  app.use(maintenanceCheck)

  // 2. Security headers
  app.use(helmet())

  // 2b. Response compression (Brotli/gzip) — must sit before every route
  app.use(compressResponses)

  // 3. CORS
  app.use(
    cors({
      origin: config.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
      // Reports CSV export reads the filename from Content-Disposition in the browser. `Date` is not a
      // CORS-safelisted response header; the web driver and rider apps read it to correct a skewed
      // phone clock for the booked-time clock (native apps already can).
      exposedHeaders: ['Content-Disposition', 'Date'],
    })
  )

  // 4. Body parsing
  // City boundary editor: a pasted OSM-import polygon (see
  // 083_backfill_city_boundaries.sql) can exceed the platform-wide 100kb limit
  // below. Mounted first, on this path prefix only — body-parser skips a body
  // that's already been parsed, so every other route still gets the 100kb
  // parser right after. See docs/superpowers/specs/2026-09-25-admin-city-
  // boundary-editor-plan.md, decision R1 (D2).
  app.use('/api/v1/admin/geo/cities', express.json({ limit: '1mb' }))

  // `verify` stashes the exact raw bytes alongside the normal parse — the
  // Razorpay webhook signature is computed over these, not a re-serialized
  // req.body, which isn't guaranteed to byte-match what Razorpay signed.
  app.use(express.json({
    limit: '100kb',
    verify: (req, _res, buf) => { (req as import('express').Request).rawBody = buf },
  }))
  app.use(express.urlencoded({ extended: true, limit: '100kb' }))

  // 5. Health check
  // Requests that came in through the load balancer carry X-Forwarded-For; the container's own healthcheck and
  // the local Alloy scrape do not. /metrics is therefore unreachable from the internet. /health stays as it was
  // for the deploy smoke test (it asserts db + redis through the ALB) but no longer names the environment.
  const viaLoadBalancer = (req: import('express').Request) => Boolean(req.headers['x-forwarded-for'])

  app.get('/health', async (req, res) => {
    const [dbOk, redisOk] = await Promise.all([testConnection(), testRedis()])
    const body: Record<string, unknown> = {
      status: 'ok',
      db: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
    }
    if (!viaLoadBalancer(req)) body['environment'] = config.NODE_ENV
    res.status(200).json(body)
  })

  // 5b. Metrics
  app.get('/metrics', async (req, res) => {
    if (viaLoadBalancer(req)) { res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' }); return }
    res.set('Content-Type', register.contentType)
    res.send(await register.metrics())
  })

  // 6. API router
  const apiRouter = Router()
  apiRouter.use(generalLimiter)
  apiRouter.use('/auth', authLimiter, authRouter)
  apiRouter.use('/drivers', driversRouter)
  apiRouter.use('/vehicles', vehiclesRouter)
  // Registered before '/admin' — admin.routes.ts applies authenticate() to
  // every request under '/admin' via router.use(), which would otherwise
  // 401 the public POST /admin/invites/redeem route before it's ever reached.
  apiRouter.use('/admin/invites', adminInvitesRouter)
  apiRouter.use('/admin/totp', adminTotpRouter)
  apiRouter.use('/admin', adminRouter)
  apiRouter.use('/geo', geoRouter)
  apiRouter.use('/pricing', pricingRouter)
  apiRouter.use('/rides', ridesRouter)
  apiRouter.use('/rides', rideChatRouter)   // ride-chat: POST/GET/PATCH /rides/:id/messages
  apiRouter.use('/payments', paymentsRouter)
apiRouter.use('/payments/settlements', settlementsRouter)
  apiRouter.use('/safety',    safetyRouter)
  apiRouter.use('/users',     usersRouter)
  apiRouter.use('/saved-places', savedPlacesRouter)
  apiRouter.use('/emergency-contacts', emergencyContactsRouter)
  apiRouter.use('/admin/analytics', analyticsRouter)
  apiRouter.use('/admin/notification-templates', templatesRouter)
  apiRouter.use('/admin/notifications', broadcastRouter)
  apiRouter.use('/account', accountRouter)
  apiRouter.use('/admin/system-config', systemConfigRouter)
  apiRouter.use('/admin/maintenance', maintenanceRouter)
  apiRouter.use('/admin/payouts', settlementsAdminRouter)
  apiRouter.use('/admin/audit-log', adminAuditRouter)
  apiRouter.use('/notifications', notificationsRouter)
  // Defines its own two prefixes internally (/rides/:id/call, /webhooks/exotel/status)
  apiRouter.use(callMaskingRouter)
  app.use('/api/v1', apiRouter)

  // 7. 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' })
  })

  // 8. Global error handler (must be last)
  app.use(errorMiddleware)

  return app
}
