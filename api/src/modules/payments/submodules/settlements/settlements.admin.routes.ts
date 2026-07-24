import { type IRouter, Router } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as service from './settlements.service'
import * as bankAccounts from './bank-accounts.service'

const router: IRouter = Router()

router.use(authenticate(), requireAdmin('super_admin', 'finance_admin'))

router.get('/batches', async (_req, res, next) => {
  try {
    res.json({ batches: await service.listSettlementBatches() })
  } catch (err) { next(err) }
})

router.get('/batches/:periodFrom/:periodTo', async (req, res, next) => {
  try {
    const { periodFrom, periodTo } = req.params
    res.json({ settlements: await service.getSettlementBatchDetail(periodFrom!, periodTo!) })
  } catch (err) { next(err) }
})

router.post('/batches/:periodFrom/:periodTo/approve', async (req, res, next) => {
  try {
    const { periodFrom, periodTo } = req.params
    const count = await service.approveSettlementPeriod(periodFrom!, periodTo!, req.admin!.id)
    res.json({ approvedCount: count })
  } catch (err) { next(err) }
})

router.post('/holds', async (req, res, next) => {
  try {
    const { driverId, reason } = req.body as { driverId?: string; reason?: string }
    if (!driverId || !reason || reason.trim().length === 0) {
      throw httpError(422, 'driverId and reason are required', AppErrors.VALIDATION_ERROR.code)
    }
    const placed = await service.placeDriverPayoutHold(BigInt(driverId), reason, req.admin!.id)
    if (!placed) throw createHttpError(AppErrors.DUPLICATE_ENTRY)
    res.status(201).json({ success: true })
  } catch (err) { next(err) }
})

router.delete('/holds/:driverId', async (req, res, next) => {
  try {
    const released = await service.releaseDriverPayoutHold(BigInt(req.params['driverId']!))
    if (!released) throw createHttpError(AppErrors.NOT_FOUND)
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/adjustments', async (req, res, next) => {
  try {
    const { driverId, amount, reason } = req.body as { driverId?: string; amount?: number; reason?: string }
    if (!driverId || typeof amount !== 'number' || amount === 0 || !reason || reason.trim().length === 0) {
      throw httpError(422, 'driverId, non-zero amount, and reason are required', AppErrors.VALIDATION_ERROR.code)
    }
    await service.createManualAdjustment(BigInt(driverId), amount, reason, req.admin!.id)
    res.status(201).json({ success: true })
  } catch (err) { next(err) }
})

router.get('/reconciliation/stuck', async (_req, res, next) => {
  try {
    res.json({ settlements: await service.listStuckSettlements() })
  } catch (err) { next(err) }
})

router.get('/bank-accounts/unverified', async (_req, res, next) => {
  try {
    res.json({ accounts: await bankAccounts.listUnverifiedBankAccounts() })
  } catch (err) { next(err) }
})

router.patch('/bank-accounts/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body as { status?: string }
    if (status !== 'verified' && status !== 'invalid' && status !== 'pending_verification') {
      throw httpError(422, 'invalid status', AppErrors.VALIDATION_ERROR.code)
    }
    await bankAccounts.setBankAccountStatus(BigInt(req.params['id']!), status)
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.get('/tax-statement/:driverId/:fy', async (req, res, next) => {
  try {
    const statement = await service.getDriverTaxStatement(BigInt(req.params['driverId']!), req.params['fy']!)
    res.json(statement)
  } catch (err) { next(err) }
})

// Placed after all more specific literal-prefixed routes above (reconciliation/*,
// bank-accounts/*, tax-statement/*) even though none of them structurally collide
// with this one (different segment counts and/or HTTP verbs) — kept last for
// readability so a generic single-segment :id pattern never reads as shadowing
// a more specific route.
router.post('/:id/retry', async (req, res, next) => {
  try {
    const ok = await service.retryFailedSettlement(BigInt(req.params['id']!))
    if (!ok) throw httpError(400, 'Settlement is not in a retryable state', AppErrors.VALIDATION_ERROR.code)
    res.json({ success: true })
  } catch (err) { next(err) }
})

// For 'never_submitted' stuck rows (status='processing', razorpay_payout_id
// still NULL) — distinct from /:id/retry above, which only resets rows that
// are status='failed'. A never-submitted row has no status to reset; this
// attempts submission for it immediately instead of waiting for the next
// submit_processing_settlements cron tick.
router.post('/:id/retry-submit', async (req, res, next) => {
  try {
    const ok = await service.retryNeverSubmittedSettlement(BigInt(req.params['id']!))
    if (!ok) throw httpError(400, 'Settlement is not in a never-submitted state', AppErrors.VALIDATION_ERROR.code)
    res.json({ success: true })
  } catch (err) { next(err) }
})

export default router
