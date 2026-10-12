import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import * as controller from './pricing.controller'

const router: IRouter = Router()

// Fare estimate: three DB reads per call and previously open to the internet. Every client calls it after sign-in.
router.post('/estimate', authenticate(), controller.estimateFare)

// Public: current rate cards
router.get('/rate-cards', controller.getRateCards)

// Public: rental packages for a category
router.get('/rental-packages/:categoryId', controller.getRentalPackages)

export default router
