import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import * as service from './analytics.service'

const router: IRouter = Router()

const VALID_PERIODS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }

router.get(
  '/summary',
  authenticate(),
  requireAdmin('super_admin', 'ops_admin', 'finance_admin'),
  async (req, res, next) => {
    try {
      const periodKey = (req.query['period'] as string) ?? '30d'
      const days = VALID_PERIODS[periodKey]
      if (days === undefined) {
        res.status(400).json({ error: 'period must be 7d, 30d, or 90d' })
        return
      }
      const summary = await service.getAnalyticsSummary(days)
      res.json(summary)
    } catch (err) {
      next(err)
    }
  }
)

router.get(
  '/eta-accuracy',
  authenticate(),
  requireAdmin('super_admin', 'ops_admin', 'finance_admin'),
  async (req, res, next) => {
    try {
      const periodKey = (req.query['period'] as string) ?? '30d'
      const days = VALID_PERIODS[periodKey]
      if (days === undefined) {
        res.status(400).json({ error: 'period must be 7d, 30d, or 90d' })
        return
      }
      res.json(await service.getEtaAccuracy(days))
    } catch (err) {
      next(err)
    }
  }
)

export default router
