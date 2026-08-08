import express, { Application, Router } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import pinoHttp from 'pino-http'
import { logger } from '@/lib/logger'
import { register, httpRequestDuration } from '@/observability/metrics'
import { config } from '@/config'
import { testConnection } from '@/db/client'
import { testConnection as testRedis } from '@/db/redis'
import { errorMiddleware } from '@/middleware/error.middleware'
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
import analyticsRouter  from '@/modules/analytics/analytics.routes'
import notificationsRouter from '@/modules/notifications/notifications.routes'
import templatesRouter from '@/modules/notifications/templates.routes'
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
    customLogLevel: (req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error'
      if (res.statusCode >= 400) return 'warn'
      // High-frequency polling (unread-count badges, admin SOS-count every
      // 30s from apps/admin's layout.tsx) is real traffic, not noise to
      // drop — but zero-value at 'info' on success. Demote so it's silent
      // at the prod default and reappears if LOG_LEVEL=debug is set to
      // chase it. Path-exact match on the SOS list route only — leaves
      // .../sos/:id/acknowledge and .../resolve (real admin actions, not
      // polling) at 'info'.
      const path = req.url?.split('?')[0]
      if (path?.includes('/unread-count')) return 'debug'
      if (path === '/api/v1/admin/safety/sos' && req.method === 'GET') return 'debug'
      return 'info'
    },
    // pino-http's default req/res serializers dump every header (helmet's
    // static CSP/HSTS block, repeated on every line) — pure log-volume waste
    // once shipped off-box. Worse: req.url includes the query string, and
    // admin-invites.controller.ts's GET verify route puts a real secret
    // there (`req.query['token']`) — logging it verbatim would ship that
    // token to Grafana Cloud. ip/userAgent are kept deliberately (useful for
    // OTP-brute-force/fraud investigation), bounded by Loki's 14-day
    // retention — not a byproduct of the header dump.
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url?.split('?')[0],
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }))

  // Request-duration metric — route (not req.url) keeps Mimir series count
  // bounded the same way Loki labels are (see MUST-DO #2's reasoning).
  // req.route.path alone is only the innermost router's local fragment (this
  // app nests routers under /api/v1/<module>/...), so '/:id' from rides and
  // '/:id' from drivers would otherwise collapse into the same label —
  // prepend req.baseUrl for the full mounted path.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9
      httpRequestDuration.observe(
        {
          method: req.method,
          route: req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched',
          status_code: String(res.statusCode),
        },
        durationSeconds
      )
    })
    next()
  })

  // 2. Security headers
  app.use(helmet())

  // 3. CORS
  app.use(
    cors({
      origin: config.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
    })
  )

  // 4. Body parsing
  // `verify` stashes the exact raw bytes alongside the normal parse — the
  // Razorpay webhook signature is computed over these, not a re-serialized
  // req.body, which isn't guaranteed to byte-match what Razorpay signed.
  app.use(express.json({
    limit: '100kb',
    verify: (req, _res, buf) => { (req as import('express').Request).rawBody = buf },
  }))
  app.use(express.urlencoded({ extended: true, limit: '100kb' }))

  // 5. Health check
  app.get('/health', async (_req, res) => {
    const [dbOk, redisOk] = await Promise.all([testConnection(), testRedis()])
    res.status(200).json({
      status: 'ok',
      db: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
    })
  })

  // 5b. Metrics
  app.get('/metrics', async (_req, res) => {
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
  apiRouter.use('/admin/analytics', analyticsRouter)
  apiRouter.use('/admin/notification-templates', templatesRouter)
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
