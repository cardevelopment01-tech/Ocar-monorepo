import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import * as controller from './admin.controller'

const router: IRouter = Router()

// All admin routes require a valid admin JWT
router.use(authenticate())

// Drivers
router.get('/drivers',          controller.getDrivers)
router.get('/drivers/:id',      controller.getDriver)
router.patch('/drivers/:id/status', controller.updateDriverStatus)

export default router
