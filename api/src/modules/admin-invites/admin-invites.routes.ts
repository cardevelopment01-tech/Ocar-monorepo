import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { validate } from '@/middleware/validate.middleware'
import { inviteRedeemLimiter, inviteVerifyLimiter } from '@/middleware/rateLimit.middleware'
import * as controller from './admin-invites.controller'
import { createInviteSchema, redeemInviteSchema } from './admin-invites.validator'

const router: IRouter = Router()

// Public — invitee has no admin session at redemption time.
// Failed attempts only are counted (see makeAuthLimiters), so people opening their own link are never slowed down.
router.get('/verify', inviteVerifyLimiter, controller.verifyInvite)
router.post('/redeem', inviteRedeemLimiter, validate(redeemInviteSchema), controller.redeemInvite)

// super_admin only, matching admins.invite/admins.manage in the seeded
// permission matrix and every other admin route's requireAdmin() gating.
router.post('/', authenticate(), requireAdmin('super_admin'), validate(createInviteSchema), controller.createInvite)
router.get('/', authenticate(), requireAdmin('super_admin'), controller.listInvites)
router.post('/:id/resend', authenticate(), requireAdmin('super_admin'), controller.resendInvite)
router.patch('/:id/revoke', authenticate(), requireAdmin('super_admin'), controller.revokeInvite)

export default router
