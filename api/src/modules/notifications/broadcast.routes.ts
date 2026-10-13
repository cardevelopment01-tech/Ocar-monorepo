import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { audienceSchema, broadcastSchema, createBroadcast, previewBroadcast } from './broadcast.service'
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

router.post('/broadcast', async (req, res, next) => {
  try {
    const parsed = broadcastSchema.safeParse(req.body)
    if (!parsed.success) throw httpError(422, 'Invalid broadcast', AppErrors.VALIDATION_ERROR.code)
    res.status(202).json(await createBroadcast(parsed.data, req.admin!.id, req.ip ?? null))
  } catch (err) { next(err) }
})

export default router
