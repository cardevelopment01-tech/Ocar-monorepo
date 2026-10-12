import { IRouter, Router } from 'express'
import { validate } from '@/middleware/validate.middleware'
import { authenticate } from '@/middleware/auth.middleware'
import { requireUser } from '@/middleware/role.middleware'
import * as controller from './emergency-contacts.controller'
import { createSchema } from './emergency-contacts.validator'

const router: IRouter = Router()
const guard = [authenticate(), requireUser()]

router.get('/', ...guard, controller.list)
router.post('/', ...guard, validate(createSchema), controller.create)
router.delete('/:id', ...guard, controller.remove)

export default router
