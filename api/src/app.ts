import express, { Application, Router } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import pinoHttp from 'pino-http'
import { logger } from '@/lib/logger'
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
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
  }))

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
