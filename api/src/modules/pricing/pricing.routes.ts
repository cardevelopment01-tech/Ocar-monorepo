import { Router, IRouter } from 'express'
import * as controller from './pricing.controller'

const router: IRouter = Router()

// Public: fare estimate
router.post('/estimate', controller.estimateFare)

// Public: current rate cards
router.get('/rate-cards', controller.getRateCards)

// Public: rental packages for a category
router.get('/rental-packages/:categoryId', controller.getRentalPackages)

export default router
