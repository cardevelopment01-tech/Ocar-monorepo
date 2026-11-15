import { Router, IRouter } from 'express'
import { validate } from '@/middleware/validate.middleware'
import { authenticate } from '@/middleware/auth.middleware'
import {
  otpLimiter, adminLoginIpLimiter, adminLoginAccountLimiter, adminTotpIpLimiter, adminTotpAccountLimiter, refreshLimiter,
} from '@/middleware/rateLimit.middleware'
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

router.post('/otp/request', otpLimiter, validate(requestOtpSchema), controller.requestOtp)
router.post('/otp/verify', otpLimiter, validate(verifyOtpSchema), controller.verifyOtp)
router.post('/admin/login', adminLoginIpLimiter, adminLoginAccountLimiter, validate(adminLoginSchema), controller.adminLogin)
router.post('/admin/totp-verify', adminTotpIpLimiter, adminTotpAccountLimiter, validate(adminTotpVerifySchema), controller.adminTotpVerify)
router.post('/refresh', refreshLimiter, validate(refreshTokenSchema), controller.refreshToken)
router.post('/logout', validate(logoutSchema), controller.logout)
router.get('/me', authenticate(), controller.me)

export default router
