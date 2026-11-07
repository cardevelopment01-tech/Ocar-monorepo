import { IRouter, RequestHandler, Router } from 'express'
import { validate } from '@/middleware/validate.middleware'
import { authenticate } from '@/middleware/auth.middleware'
import { requireUser } from '@/middleware/role.middleware'
import { publicTripLimiters } from '@/middleware/rateLimit.middleware'
import * as controller from './ride-shares.controller'
import { createSchema } from './ride-shares.validator'

// Rider side, mounted under /api/v1/rides: POST/GET /:id/shares, DELETE /:id/shares[/:shareId].
const router: IRouter = Router()
const guard = [authenticate(), requireUser()]

router.post('/:id/shares', ...guard, validate(createSchema), controller.create)
router.get('/:id/shares', ...guard, controller.list)
router.delete('/:id/shares/:shareId', ...guard, controller.stopOne)
router.delete('/:id/shares', ...guard, controller.stopAll)

export default router

// Public side, mounted under /api/v1/public: GET /trips/:token (no auth). Both limiters run first; see rateLimit.middleware.ts.
export const publicRouter: IRouter = Router()
// Before the limiters, so a 429 is never cached by a proxy or CDN and kept showing after the limit has cleared.
const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  next()
}
publicRouter.get('/trips/:token', noStore, publicTripLimiters.perToken, publicTripLimiters.misses, controller.publicTrip)
