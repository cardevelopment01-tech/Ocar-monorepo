import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { validate } from '@/middleware/validate.middleware'
import * as controller from './admin-invites.controller'
import { createInviteSchema, redeemInviteSchema } from './admin-invites.validator'

const router: IRouter = Router()

// Public — invitee has no admin session at redemption time.
router.get('/verify', controller.verifyInvite)
router.post('/redeem', validate(redeemInviteSchema), controller.redeemInvite)

// super_admin only, matching admins.invite/admins.manage in the seeded
// permission matrix and every other admin route's requireAdmin() gating.
router.post('/', authenticate(), requireAdmin('super_admin'), validate(createInviteSchema), controller.createInvite)
router.get('/', authenticate(), requireAdmin('super_admin'), controller.listInvites)
router.patch('/:id/revoke', authenticate(), requireAdmin('super_admin'), controller.revokeInvite)

export default router
