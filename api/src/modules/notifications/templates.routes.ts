import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as templatesService from './templates.service'

const router: IRouter = Router()

router.use(authenticate(), requireAdmin('super_admin'))

router.get('/', async (_req, res, next) => {
  try {
    const templates = await templatesService.listTemplates()
    res.json({ templates })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const body = req.body?.body
    if (typeof body !== 'string' || body.trim().length === 0) {
      throw httpError(422, 'body is required', AppErrors.VALIDATION_ERROR.code)
    }
    const subjectInput = req.body?.subject
    if (subjectInput !== undefined && subjectInput !== null && typeof subjectInput !== 'string') {
      throw httpError(422, 'subject must be a string or null', AppErrors.VALIDATION_ERROR.code)
    }
    const subject = typeof subjectInput === 'string' ? subjectInput : null

    const updated = await templatesService.updateTemplateContent(BigInt(req.params['id']!), {
      subject, body, updatedBy: req.admin!.id,
    })
    if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
    res.json({ template: updated })
  } catch (err) { next(err) }
})

router.patch('/:id/active', async (req, res, next) => {
  try {
    const isActive = req.body?.isActive
    if (typeof isActive !== 'boolean') {
      throw httpError(422, 'isActive must be a boolean', AppErrors.VALIDATION_ERROR.code)
    }
    const updated = await templatesService.setTemplateActive(BigInt(req.params['id']!), isActive, req.admin!.id)
    if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
    res.json({ template: updated })
  } catch (err) { next(err) }
})

export default router
