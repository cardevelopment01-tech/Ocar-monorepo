import { IRouter, Router } from 'express'
import { validate } from '@/middleware/validate.middleware'
import { authenticate } from '@/middleware/auth.middleware'
import { requireUser } from '@/middleware/role.middleware'
import * as controller from './saved-places.controller'
import { createSchema, updateSchema } from './saved-places.validator'

const router: IRouter = Router()
const guard = [authenticate(), requireUser()]

router.get('/', ...guard, controller.list)
router.post('/', ...guard, validate(createSchema), controller.create)
router.patch('/:id', ...guard, validate(updateSchema), controller.update)
router.delete('/:id', ...guard, controller.remove)

export default router
