import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { chatMessageLimiter } from '@/middleware/rateLimit.middleware'
import * as controller from './ride-chat.controller'

const router: IRouter = Router()

router.post('/:id/messages', authenticate(), chatMessageLimiter, controller.postMessage)
router.get('/:id/messages', authenticate(), controller.getMessages)
router.get('/:id/messages/unread-count', authenticate(), controller.getUnreadCount)
router.patch('/:id/messages/read', authenticate(), controller.markRead)

export default router
