import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { audienceSchema, broadcastSchema, createBroadcast, listBroadcasts, listQuerySchema, previewBroadcast } from './broadcast.service'
import { z } from 'zod'
import multer from 'multer'
import { BROADCAST_IMAGE_MAX_BYTES, saveBroadcastImage } from './broadcast-image.service'

const router: IRouter = Router()

router.use(authenticate(), requireAdmin('super_admin', 'ops_admin'))

const previewSchema = z.object({ category: broadcastSchema.shape.category, audience: audienceSchema }).strict()

// A picture for a broadcast: the admin page crops and compresses it to a 1024x512 JPEG first; this checks it again and stores it in the
// public pictures bucket. One small file in memory, JPEG or PNG only (judged by its bytes, not its name).
const pictureUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: BROADCAST_IMAGE_MAX_BYTES, files: 1 } })

router.post('/broadcast-image', (req, res, next) => {
  pictureUpload.single('image')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(httpError(422, 'The picture must be under 1 MB', 'FILE_TOO_LARGE'))
    if (err) return next(err)
    saveBroadcastImage(req.file).then((image) => res.status(201).json(image)).catch(next)
  })
})

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
