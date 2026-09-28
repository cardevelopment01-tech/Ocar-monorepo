import { Router, IRouter, type Request, type Response, type NextFunction } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import * as service from './analytics.service'
import * as repo from './analytics.repository'
import { parseRange, InvalidRangeError, type ParsedRange } from './analytics.range'
import { roleClassOf, type RoleClass } from './analytics.service'
import { toCsv } from './csv'
import { recordAuditLog } from '@/lib/audit-log'
import { analyticsExportTotal } from '@/observability/metrics'
import { logger } from '@/lib/logger'

const router: IRouter = Router()

const ALL_ADMINS = requireAdmin('super_admin', 'ops_admin', 'finance_admin')
const FINANCE_ONLY = requireAdmin('super_admin', 'finance_admin')

function ctx(req: Request): { p: ParsedRange; roleClass: RoleClass } {
  return { p: parseRange(req.query as Record<string, unknown>), roleClass: roleClassOf(req.admin!.role) }
}

// Bad range/filters are a client error with a stable code; everything else goes to the error handler.
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res)
    } catch (err) {
      if (err instanceof InvalidRangeError) {
        res.status(400).json({ error: err.message, code: err.code })
        return
      }
      next(err)
    }
  }
}

// Legacy period-based summary; ops gets no money fields (CEO E5).
router.get('/summary', authenticate(), ALL_ADMINS, handle(async (req, res) => {
  const { p, roleClass } = ctx(req)
  res.json(await service.getAnalyticsSummary(p, roleClass))
}))

router.get('/kpis', authenticate(), ALL_ADMINS, handle(async (req, res) => {
  const { p, roleClass } = ctx(req)
  res.json(await service.getKpis(p, roleClass))
}))

router.get('/demand', authenticate(), ALL_ADMINS, handle(async (req, res) => {
  const { p, roleClass } = ctx(req)
  res.json(await service.getDemand(p, roleClass))
}))

router.get('/drivers/quality', authenticate(), ALL_ADMINS, handle(async (req, res) => {
  const { p, roleClass } = ctx(req)
  res.json(await service.getDrivers(p, roleClass))
}))

// Take rate, refund / dispute rates, cash discrepancy: finance class only (403 for ops).
router.get('/finance', authenticate(), FINANCE_ONLY, handle(async (req, res) => {
  res.json(await service.getFinance(ctx(req).p))
}))

router.get('/eta-accuracy', authenticate(), ALL_ADMINS, handle(async (req, res) => {
  res.json(await service.getEtaAccuracy(ctx(req).p))
}))

router.get('/drivers/onboarding', authenticate(), ALL_ADMINS, handle(async (req, res) => {
  res.json(await service.getDriverOnboardingFunnel(ctx(req).p))
}))

router.get('/drivers/availability', authenticate(), ALL_ADMINS, handle(async (_req, res) => {
  res.json(await service.getDriverAvailability())
}))

// ── CSV export (finance class only; audited) ──────────────────────────────────
type ExportTab = 'daily' | 'drivers' | 'cities'
const EXPORT_TABS: ExportTab[] = ['daily', 'drivers', 'cities']

async function buildExport(tab: ExportTab, p: ParsedRange): Promise<string> {
  if (tab === 'daily') {
    const series = await repo.getDailySeries(p.range, p.filters)
    return toCsv(
      ['Date (IST)', 'Completed rides', 'Gross bookings (INR)', 'Ocar revenue (INR)', 'Requested and completed', 'Requested and cancelled'],
      series.map(s => [s.day, s.completed_rides, s.gross, s.commission, s.cohort_completed, s.cohort_cancelled])
    )
  }
  if (tab === 'drivers') {
    const q = await repo.getDriverQuality(p.range, p.filters, 500)
    return toCsv(
      ['Driver code', 'Driver', 'Offers', 'Accepted', 'Completed', 'Cancelled', 'Acceptance rate', 'Completion rate', 'Cancellation rate', 'Earnings (INR)', 'Rating'],
      q.map(d => [d.driver_code, d.driver_name, d.offered, d.accepted, d.completed, d.cancelled,
        d.acceptance_rate, d.completion_rate, d.cancellation_rate, d.earnings, d.rating_avg])
    )
  }
  const cities = await repo.getCityBreakdown(p.range, p.filters)
  return toCsv(
    ['City', 'Completed rides', 'Gross bookings (INR)', 'Cancelled', 'Cancellation rate', 'Active fleet'],
    cities.map(c => [c.city_name, c.ride_count, c.revenue, c.cancelled_count, c.cancellation_rate, c.active_drivers])
  )
}

router.get('/export/:tab.csv', authenticate(), FINANCE_ONLY, handle(async (req, res) => {
  const tab = req.params['tab'] as ExportTab
  if (!EXPORT_TABS.includes(tab)) {
    res.status(404).json({ error: 'unknown export tab', code: 'ANALYTICS_EXPORT_TAB' })
    return
  }
  const p = parseRange(req.query as Record<string, unknown>)
  const audit = { adminId: req.admin!.id, action: 'analytics_export', targetTable: 'analytics_export', targetId: 0n, ipAddress: req.ip ?? null }
  let csv: string
  try {
    // The whole file is built before any byte is sent, so a failure is a real 5xx, never a truncated 200.
    csv = await buildExport(tab, p)
  } catch (err) {
    analyticsExportTotal.inc({ tab, result: 'failed' })
    logger.error({ err, adminId: String(req.admin!.id), tab, from: p.from, to: p.to }, 'analytics export failed')
    void recordAuditLog({ ...audit, action: 'analytics_export_failed', afterState: { tab, from: p.from, to: p.to } }).catch(() => undefined)
    throw err
  }
  analyticsExportTotal.inc({ tab, result: 'ok' })
  logger.info({ adminId: String(req.admin!.id), tab, from: p.from, to: p.to, bytes: csv.length }, 'analytics export')
  await recordAuditLog({ ...audit, afterState: { tab, from: p.from, to: p.to, cityIds: p.filters.cityIds ?? null, categoryId: p.filters.categoryId ?? null } })
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="ocar-${tab}-${p.from}_${p.to}.csv"`)
  res.send(csv)
}))

export default router
