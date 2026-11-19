import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { audienceSchema, broadcastSchema, createBroadcast, listBroadcasts, listQuerySchema, previewBroadcast } from './broadcast.service'
import { z } from 'zod'

const router: IRouter = Router()

router.use(authenticate(), requireAdmin('super_admin', 'ops_admin'))

const previewSchema = z.object({ category: broadcastSchema.shape.category, audience: audienceSchema }).strict()

router.post('/preview', async (req, res, next) => {
  try {
    const parsed = previewSchema.safeParse(req.body)
    if (!parsed.success) throw httpError(422, 'Invalid audience', AppErrors.VALIDATION_ERROR.code)
    res.json(await previewBroadcast(parsed.data.audience, parsed.data.category))
  } catch (err) { next(err) }
})

// History: newest first, with what happened to each (notified, push accepted, in-app only, failed, opened). `before` = the last id of the previous page.
router.get('/broadcasts', async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) throw httpError(422, 'Invalid query', AppErrors.VALIDATION_ERROR.code)
    res.json(await listBroadcasts(parsed.data))
  } catch (err) { next(err) }
})

router.post('/broadcast', async (req, res, next) => {
  try {
    const parsed = broadcastSchema.safeParse(req.body)
    if (!parsed.success) {
      // Say which field, so the admin knows what to fix (these messages are written for admins; nothing from the request is echoed).
      const issue = parsed.error.issues[0]
      const field = issue?.path[0]
      const why = field === 'imageUrl' ? `Picture: ${issue!.message === 'Invalid url' ? 'that is not a valid link' : issue!.message}` : field === 'link' ? 'That screen is not valid' : null
      throw httpError(422, why ? `Invalid broadcast. ${why}` : 'Invalid broadcast', AppErrors.VALIDATION_ERROR.code)
    }
    res.status(202).json(await createBroadcast(parsed.data, req.admin!.id, req.ip ?? null))
  } catch (err) { next(err) }
})

export default router
