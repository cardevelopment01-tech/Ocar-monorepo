import { type IRouter, Router } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as service from './settlements.service'

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

export default router
