import { Router, IRouter } from 'express'
import { validate } from '@/middleware/validate.middleware'
import { authenticate } from '@/middleware/auth.middleware'
import * as controller from './auth.controller'
import {
  requestOtpSchema,
  verifyOtpSchema,
  adminLoginSchema,
  adminTotpVerifySchema,
  refreshTokenSchema,
  logoutSchema,
} from './auth.validator'

const router: IRouter = Router()

router.post('/otp/request', validate(requestOtpSchema), controller.requestOtp)
router.post('/otp/verify', validate(verifyOtpSchema), controller.verifyOtp)
router.post('/admin/login', validate(adminLoginSchema), controller.adminLogin)
router.post('/admin/totp-verify', validate(adminTotpVerifySchema), controller.adminTotpVerify)
router.post('/refresh', validate(refreshTokenSchema), controller.refreshToken)
router.post('/logout', validate(logoutSchema), controller.logout)
router.get('/me', authenticate(), controller.me)

export default router
