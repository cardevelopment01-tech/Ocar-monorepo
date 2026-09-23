import { Router, type IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { maskedCallLimiter } from '@/middleware/rateLimit.middleware'
import * as service from '@/modules/call-masking/call-masking.service'
import { CallMaskingError } from '@/modules/call-masking/call-masking.types'

// Mounted at the apiRouter root in app.ts (same call as ride-chat.routes.ts
// being mounted under /rides) rather than its own prefix.
const router: IRouter = Router()

router.post('/rides/:id/call', authenticate(), maskedCallLimiter, async (req, res, next) => {
  try {
    if (!req.user && !req.driver) {
      res.status(403).json({ error: 'Only riders or drivers can trigger a masked call', code: 'AUTH_FORBIDDEN' })
      return
    }
    const rideId = BigInt(req.params['id']!)
    const callerRole = req.user ? ('user' as const) : ('driver' as const)
    const callerId = req.user ? req.user.id : req.driver!.id
    await service.triggerCall({ rideId, callerRole, callerId })
    res.json({ status: 'calling' })
  } catch (err) {
    if (err instanceof CallMaskingError) {
      res.status(409).json({ error: err.message, code: err.code })
      return
    }
    next(err)
  }
})

export default router
