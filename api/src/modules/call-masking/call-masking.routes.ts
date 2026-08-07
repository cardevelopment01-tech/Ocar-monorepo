import { Router, type IRouter } from 'express'
import { config } from '@/config'
import { authenticate } from '@/middleware/auth.middleware'
import { maskedCallLimiter } from '@/middleware/rateLimit.middleware'
import * as service from '@/modules/call-masking/call-masking.service'
import * as repo from '@/modules/call-masking/call-masking.repository'
import { CallMaskingError } from '@/modules/call-masking/call-masking.types'

// Routes span two logical prefixes (`/rides/:id/call` and
// `/webhooks/exotel/status`), so this router is mounted at the apiRouter
// root in app.ts rather than under a single existing prefix — same call as
// payments.routes.ts embedding `/webhook/razorpay` inside its own mount.
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
    const result = await service.triggerCall({ rideId, callerRole, callerId })
    res.json({ status: 'calling', sid: result.sid })
  } catch (err) {
    if (err instanceof CallMaskingError) {
      res.status(409).json({ error: err.message, code: err.code })
      return
    }
    next(err)
  }
})

// Exotel StatusCallback — async, arrives ~2 min after the call ends. Exotel
// has no HMAC signing like Razorpay's webhook, so a shared-secret query
// param (configured as the callback URL's ?token=) is the standard
// workaround; CustomField carries our ride_call_mask id so we can validate
// the event maps to a mask we actually created, and CallSid dedupes retries.
router.post('/webhooks/exotel/status', async (req, res, next) => {
  try {
    if (!config.EXOTEL_WEBHOOK_SECRET || req.query['token'] !== config.EXOTEL_WEBHOOK_SECRET) {
      res.status(401).json({ error: 'Invalid webhook token', code: 'WEBHOOK_UNAUTHORIZED' })
      return
    }
    const body = req.body as Record<string, string>
    const maskId = body['CustomField']
    const callSid = body['CallSid']
    if (!maskId || !callSid) { res.status(400).json({ error: 'Missing CallSid/CustomField' }); return }

    // exactOptionalPropertyTypes: build the object first, then conditionally
    // set optional fields, rather than passing `field: value | undefined`.
    const event: Parameters<typeof repo.recordCallEvent>[0] = {
      rideCallMaskId: BigInt(maskId),
      callSid,
      rawPayload: body,
    }
    if (body['Status'] !== undefined) event.callStatus = body['Status']
    if (body['Duration'] !== undefined) event.durationSec = Number(body['Duration'])
    if (body['Price'] !== undefined) event.priceInr = Math.abs(Number(body['Price']))

    await repo.recordCallEvent(event)
    res.json({ status: 'ok' })
  } catch (err) {
    next(err)
  }
})

export default router
