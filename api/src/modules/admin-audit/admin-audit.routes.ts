import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import * as controller from './admin-audit.controller'

const router: IRouter = Router()

router.use(authenticate(), requireAdmin('super_admin'))

router.get('/', controller.getAuditLog)

export default router
