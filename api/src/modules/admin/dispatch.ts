import { Router, IRouter, Request, Response, NextFunction } from 'express'
import { requireAdmin } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'
import * as repo from './dispatch.repository'
import { readPolicy, savePolicy } from './advance-policy.admin'
import { adminCancelRide, rescheduleAdvanceRide } from '@/modules/rides/advance.service'
import { reserveDriver, releaseReservation } from '@/modules/rides/reservation.service'

// Dispatch desk API (read-only). Assigning a driver stays on POST /admin/rides/:id/assign.

const MAX_LIMIT = 50
const WITHIN_OPTIONS = [60, 1440, 10080]

function int(v: unknown): number | undefined {
  if (typeof v !== 'string' || v === '') return undefined
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : NaN
}

/** Parses and validates the queue's query string. Exported for tests. */
export function parseQueueQuery(q: Record<string, unknown>): repo.DispatchFilters {
  const lane = q['lane'] ?? 'scheduled'
  if (lane !== 'scheduled' && lane !== 'needs_driver') throw httpError(422, 'lane must be scheduled or needs_driver', 'VALIDATION_ERROR')
  const limitIn = int(q['limit'])
  const page = int(q['page']) ?? 1
  const cityId = int(q['city_id'])
  const within = int(q['within'])
  if ([limitIn, page, cityId, within].some(n => n !== undefined && Number.isNaN(n))) {
    throw httpError(422, 'limit, page, city_id and within must be positive whole numbers', 'VALIDATION_ERROR')
  }
  if (within !== undefined && !WITHIN_OPTIONS.includes(within)) throw httpError(422, `within must be one of ${WITHIN_OPTIONS.join(', ')}`, 'VALIDATION_ERROR')
  const limit = Math.min(limitIn ?? 25, MAX_LIMIT)
  const f: repo.DispatchFilters = { lane, limit, offset: (page - 1) * limit }
  if (cityId !== undefined) f.cityId = cityId
  if (within !== undefined && lane === 'scheduled') f.withinMinutes = within
  return f
}

const router: IRouter = Router()
const READ = requireAdmin('super_admin', 'ops_admin', 'support_admin')

router.get('/summary', READ, async (_req: Request, res: Response, next: NextFunction) => {
  try { res.json(await repo.getDispatchSummary()) } catch (err) { next(err) }
})

router.get('/queue', READ, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const f = parseQueueQuery(req.query)
    const { rows, total, totalCapped } = await repo.listDispatchQueue(f)
    const page = Math.floor(f.offset / f.limit) + 1
    res.json({ rides: rows, pagination: { total, total_capped: totalCapped, page, limit: f.limit, pages: Math.max(1, Math.ceil(total / f.limit)) } })
  } catch (err) { next(err) }
})

// ── Policy: the rules for advance bookings (late-cancel fee, reschedule limit, how long to keep searching) ──
router.get('/policy', READ, async (_req: Request, res: Response, next: NextFunction) => {
  try { res.json(await readPolicy()) } catch (err) { next(err) }
})

// Money and rider promises: super admin only, with a reason that goes into the audit log.
router.put('/policy', requireAdmin('super_admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { changes?: unknown; reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (reason.length < 3 || reason.length > 300) throw httpError(422, 'Give a reason for this change (3 to 300 characters)', 'VALIDATION_ERROR')
    res.json({ policy: await savePolicy(body.changes as never, reason, req.admin!.id, req.ip ?? null) })
  } catch (err) { next(err) }
})

// ── Actions on one ride (ops and super admin). The reason is required and is kept in the ride's history and the audit log. ──
const ACT = requireAdmin('super_admin', 'ops_admin')

function reasonOf(v: unknown): string {
  const r = typeof v === 'string' ? v.trim() : ''
  if (r.length < 10 || r.length > 300) throw httpError(422, 'Give a reason, 10 to 300 characters', 'VALIDATION_ERROR')
  return r
}

router.post('/rides/:id/cancel', ACT, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await adminCancelRide(BigInt(req.params['id']!), req.admin!.id, reasonOf((req.body as { reason?: unknown }).reason), req.ip ?? null)
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/rides/:id/reschedule', ACT, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { scheduledFor?: unknown; reason?: unknown }
    if (typeof body.scheduledFor !== 'string') throw httpError(422, 'scheduledFor is required', 'VALIDATION_ERROR')
    const out = await rescheduleAdvanceRide(BigInt(req.params['id']!), body.scheduledFor, { type: 'admin', adminId: req.admin!.id, reason: reasonOf(body.reason), ip: req.ip ?? null })
    res.json(out)
  } catch (err) { next(err) }
})

router.post('/rides/:id/reserve', ACT, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as { driverId?: unknown; override?: unknown }
    if (typeof body.driverId !== 'string' || !/^\d+$/.test(body.driverId)) throw httpError(422, 'driverId is required', 'VALIDATION_ERROR')
    res.json(await reserveDriver(BigInt(req.params['id']!), BigInt(body.driverId), req.admin!.id, req.ip ?? null, body.override === true))
  } catch (err) { next(err) }
})

router.delete('/rides/:id/reserve', ACT, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await releaseReservation(BigInt(req.params['id']!), 'admin', { actorId: req.admin!.id, reason: 'released by ops' })
    if (!out.released) throw httpError(409, 'This booking has no reserved driver', 'NOT_RESERVED')
    res.json({ success: true })
  } catch (err) { next(err) }
})

export default router
