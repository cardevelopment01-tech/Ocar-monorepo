import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import * as controller from './safety.controller'

const router: IRouter = Router()

router.get('/tags', authenticate(), controller.getTags)

router.post('/ratings',  authenticate(), controller.postRating)
router.post('/sos',      authenticate(), controller.postSos)
router.post('/disputes', authenticate(), controller.postDispute)

export default router
