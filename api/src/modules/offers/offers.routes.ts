import { Router, type IRouter, type RequestHandler } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireUser } from '@/middleware/role.middleware'
import { offersCodeGuessLimiters, offersPreviewLimiter } from '@/middleware/rateLimit.middleware'
import * as controller from './offers.controller'

const router: IRouter = Router()

router.use(authenticate(), requireUser())

// Run the code-guess limiters only when a code was sent, so ordinary previews never touch them.
const guessLimiters: RequestHandler[] = offersCodeGuessLimiters.map((limiter): RequestHandler => (req, res, next) => {
  if (typeof req.body?.code === 'string' && req.body.code.trim()) { limiter(req, res, next); return }
  next()
})

router.post('/preview', offersPreviewLimiter, ...guessLimiters, controller.preview)
router.get('/', controller.list)

export default router
