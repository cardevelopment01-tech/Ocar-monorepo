import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { recordAuditLog } from '@/lib/audit-log'
import { getMaintenanceStatus, setMaintenanceStatus, type MaintenanceStatus } from '@/lib/maintenance'

const router: IRouter = Router()

router.use(authenticate(), requireAdmin('super_admin'))

router.get('/', async (_req, res, next) => {
  try {
    res.json({ maintenance: await getMaintenanceStatus() })
  } catch (err) { next(err) }
})

router.patch('/', async (req, res, next) => {
  try {
    const { enabled, message, retryAfterSeconds } = req.body ?? {}
    if (typeof enabled !== 'boolean') {
      throw httpError(422, 'enabled must be a boolean', AppErrors.VALIDATION_ERROR.code)
    }
    if (message !== undefined && typeof message !== 'string') {
      throw httpError(422, 'message must be a string', AppErrors.VALIDATION_ERROR.code)
    }
    if (retryAfterSeconds !== undefined && typeof retryAfterSeconds !== 'number') {
      throw httpError(422, 'retryAfterSeconds must be a number', AppErrors.VALIDATION_ERROR.code)
    }

    const status: MaintenanceStatus = { enabled }
    if (message !== undefined) status.message = message
    if (retryAfterSeconds !== undefined) status.retryAfterSeconds = retryAfterSeconds
    // Source of truth — must succeed independent of Postgres, this is the
    // exact toggle used during a DB migration cutover when Postgres may be down.
    await setMaintenanceStatus(status)

    // Best-effort record: recordAuditLog enqueues via BullMQ/Redis (not a
    // direct Postgres write), so it doesn't block on Postgres either — but
    // if it throws for any other reason, don't undo the toggle that already
    // succeeded above.
    await recordAuditLog({
      adminId: req.admin!.id,
      action: 'maintenance_mode.update',
      targetTable: 'maintenance_mode',
      targetId: 0n,
      afterState: { ...status },
      ipAddress: req.ip ?? null,
    }).catch(() => {})

    res.json({ maintenance: status })
  } catch (err) { next(err) }
})

export default router
