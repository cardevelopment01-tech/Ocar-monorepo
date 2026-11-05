import { Router, type IRouter, type Request, type RequestHandler } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'
import * as service from './admin-offers.service'

const router: IRouter = Router()

// Create/edit/pause: super_admin and ops_admin. Read-only stats and redemptions also for finance (plan D9).
const write = requireAdmin('super_admin', 'ops_admin')
const read = requireAdmin('super_admin', 'ops_admin', 'finance_admin')

const wrap = (fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler => async (req, res, next) => {
  try { res.status(status).json(await fn(req)) } catch (err) { next(err) }
}
// A non-numeric id is a 404, not a BigInt SyntaxError turning into a 500.
const id = (req: Request) => {
  const raw = req.params['id'] ?? ''
  if (!/^\d{1,18}$/.test(raw)) throw httpError(404, 'Not found', 'NOT_FOUND')
  return BigInt(raw)
}
const page = (req: Request) => ({
  limit: Math.min(Math.max(parseInt(String(req.query['limit'] ?? '50'), 10) || 50, 1), 200),
  offset: Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0),
})

router.use(authenticate())

router.get('/meta', read, wrap(() => service.meta()))
router.post('/preview-draft', read, wrap((req) => service.previewDraft(req.body)))
router.get('/', read, wrap(async (req) => {
  const q: { status?: string; search?: string; limit: number; offset: number } = page(req)
  if (typeof req.query['status'] === 'string') q.status = req.query['status']
  if (typeof req.query['search'] === 'string') q.search = req.query['search']
  return service.listOffers(q)
}))
router.post('/', write, wrap(async (req) => ({ offer: await service.createOffer(req.admin!.id, req.body, req.ip ?? null) }), 201))
router.get('/:id', read, wrap(async (req) => ({ offer: await service.getOffer(id(req)) })))
router.patch('/:id', write, wrap(async (req) => ({ offer: await service.patchOffer(req.admin!.id, id(req), req.body, req.ip ?? null) })))
router.post('/:id/versions', write, wrap(async (req) => ({ offer: await service.createVersion(req.admin!.id, id(req), req.body, req.ip ?? null) }), 201))
router.post('/:id/simulate', read, wrap((req) => service.simulate(id(req), req.body)))
router.get('/:id/stats', read, wrap((req) => service.stats(id(req))))
router.get('/:id/redemptions', read, wrap(async (req) => {
  const { limit, offset } = page(req)
  const filter: Record<string, string> = {}
  for (const k of ['status', 'from', 'to'] as const) if (typeof req.query[k] === 'string' && req.query[k]) filter[k] = req.query[k] as string
  return { redemptions: await service.redemptions(id(req), limit, offset, filter) }
}))

export default router
