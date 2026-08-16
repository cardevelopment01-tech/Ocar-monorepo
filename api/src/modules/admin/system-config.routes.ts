import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { recordAuditLog } from '@/lib/audit-log'
import { listConfig, getConfigById, validateConfigValue, updateConfigValue } from '@/lib/system-config'

const router: IRouter = Router()

router.use(authenticate(), requireAdmin('super_admin'))

router.get('/', async (_req, res, next) => {
  try {
    res.json({ config: await listConfig() })
  } catch (err) { next(err) }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const value = req.body?.value
    if (typeof value !== 'string') {
      throw httpError(422, 'value is required', AppErrors.VALIDATION_ERROR.code)
    }

    const id = BigInt(req.params['id']!)
    const before = await getConfigById(id)
    if (!before) throw createHttpError(AppErrors.NOT_FOUND)

    const validationError = validateConfigValue(before.valueType, value)
    if (validationError) throw httpError(422, validationError, AppErrors.VALIDATION_ERROR.code)

    const updated = await updateConfigValue(id, value, req.admin!.id)
    if (!updated) throw createHttpError(AppErrors.NOT_FOUND)

    await recordAuditLog({
      adminId: req.admin!.id,
      action: 'system_config.update',
      targetTable: 'system_config',
      targetId: id,
      beforeState: { key: before.key, value: before.value },
      afterState: { key: updated.key, value: updated.value },
      ipAddress: req.ip ?? null,
    })

    res.json({ config: updated })
  } catch (err) { next(err) }
})

export default router
