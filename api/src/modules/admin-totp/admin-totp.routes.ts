import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { validate } from '@/middleware/validate.middleware'
import * as controller from './admin-totp.controller'
import { confirmSetupSchema, disableTotpSchema } from './admin-totp.validator'

const router: IRouter = Router()

// Any authenticated admin manages their own 2FA — no role restriction.
// Deliberately exempted from the mandatory-TOTP enrollment gate in
// auth.middleware.ts (an admin who hasn't enrolled yet must still be able to
// reach these routes to actually enroll).
router.use(authenticate())

router.get('/status', controller.getStatus)
router.post('/setup', controller.startSetup)
router.post('/confirm', validate(confirmSetupSchema), controller.confirmSetup)
router.post('/disable', validate(disableTotpSchema), controller.disableTotp)

export default router
