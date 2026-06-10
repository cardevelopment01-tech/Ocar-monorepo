import express, { Application, Router } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { config } from '@/config'
import { testConnection } from '@/db/client'
import { testConnection as testRedis } from '@/db/redis'
import { errorMiddleware } from '@/middleware/error.middleware'
import authRouter from '@/modules/auth/auth.routes'
import driversRouter from '@/modules/drivers/drivers.routes'
import vehiclesRouter from '@/modules/vehicles/vehicles.routes'
import adminRouter from '@/modules/admin/admin.routes'
import geoRouter from '@/modules/geo/geo.routes'
import pricingRouter from '@/modules/pricing/pricing.routes'
import ridesRouter from '@/modules/rides/rides.routes'
import paymentsRouter from '@/modules/payments/payments.routes'
import safetyRouter  from '@/modules/safety/safety.routes'
import usersRouter from '@/modules/users/users.routes'

export function createApp(): Application {
  const app = express()

  // 1. Attach requestId to every request
  app.use((req, _res, next) => {
    req.requestId = crypto.randomUUID()
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
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

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
  apiRouter.use('/auth', authRouter)
  apiRouter.use('/drivers', driversRouter)
  apiRouter.use('/vehicles', vehiclesRouter)
  apiRouter.use('/admin', adminRouter)
  apiRouter.use('/geo', geoRouter)
  apiRouter.use('/pricing', pricingRouter)
  apiRouter.use('/rides', ridesRouter)
  apiRouter.use('/payments', paymentsRouter)
  apiRouter.use('/safety',  safetyRouter)
  apiRouter.use('/users', usersRouter)
  app.use('/api/v1', apiRouter)

  // 7. 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found', code: 'NOT_FOUND' })
  })

  // 8. Global error handler (must be last)
  app.use(errorMiddleware)

  return app
}
