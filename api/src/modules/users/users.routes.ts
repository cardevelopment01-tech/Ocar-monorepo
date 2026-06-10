import { IRouter, Router } from 'express'
import { validate } from '@/middleware/validate.middleware'
import { authenticate } from '@/middleware/auth.middleware'
import { requireUser } from '@/middleware/role.middleware'
import * as controller from './users.controller'
import { updateProfileSchema } from './users.validator'

const router: IRouter = Router()
const guard = [authenticate(), requireUser()]

router.get('/me', ...guard, controller.getMe)
router.patch('/me', ...guard, validate(updateProfileSchema), controller.updateMe)

export default router
