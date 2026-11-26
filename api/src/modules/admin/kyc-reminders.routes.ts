import { Router, type IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { listKycReminderReport, type DriverState, type SendResult } from '@/modules/drivers/kyc-reminders.report'

const router: IRouter = Router()

// Who the onboarding reminders reached and who they did not: an ops view, like the verification queue.
router.use(authenticate(), requireAdmin('super_admin', 'ops_admin'))

const STATES: readonly DriverState[] = ['not_due', 'reminded', 'paused', 'came_back']
const RESULTS: readonly SendResult[] = ['reached', 'no_device', 'blocked', 'problem']
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined)

router.get('/reminders', async (req, res, next) => {
  try {
    const filter: Parameters<typeof listKycReminderReport>[0] = {}
    const state = pick(req.query['state'], STATES); if (state) filter.state = state
    const result = pick(req.query['result'], RESULTS); if (result) filter.result = result
    if (typeof req.query['step'] === 'string' && /^[a-z_]{1,20}$/.test(req.query['step'])) filter.step = req.query['step']
    res.json(await listKycReminderReport(filter))
  } catch (err) { next(err) }
})

export default router
