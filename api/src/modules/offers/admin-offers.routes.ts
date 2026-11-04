import { Router, type IRouter, type Request, type RequestHandler } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import * as service from './admin-offers.service'

const router: IRouter = Router()

// Create/edit/pause: super_admin and ops_admin. Read-only stats and redemptions also for finance (plan D9).
const write = requireAdmin('super_admin', 'ops_admin')
const read = requireAdmin('super_admin', 'ops_admin', 'finance_admin')

const wrap = (fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler => async (req, res, next) => {
  try { res.status(status).json(await fn(req)) } catch (err) { next(err) }
}
const id = (req: Request) => BigInt(req.params['id']!)
const page = (req: Request) => ({
  limit: Math.min(Math.max(parseInt(String(req.query['limit'] ?? '50'), 10) || 50, 1), 200),
  offset: Math.max(parseInt(String(req.query['offset'] ?? '0'), 10) || 0, 0),
})

router.use(authenticate())

router.get('/meta', read, wrap(() => service.meta()))
router.get('/', read, wrap(async (req) => {
  const q: { status?: string; search?: string; limit: number; offset: number } = page(req)
  if (typeof req.query['status'] === 'string') q.status = req.query['status']
  if (typeof req.query['search'] === 'string') q.search = req.query['search']
  return { offers: await service.listOffers(q) }
}))
router.post('/', write, wrap(async (req) => ({ offer: await service.createOffer(req.admin!.id, req.body, req.ip ?? null) }), 201))
router.get('/:id', read, wrap(async (req) => ({ offer: await service.getOffer(id(req)) })))
router.patch('/:id', write, wrap(async (req) => ({ offer: await service.patchOffer(req.admin!.id, id(req), req.body, req.ip ?? null) })))
router.post('/:id/versions', write, wrap(async (req) => ({ offer: await service.createVersion(req.admin!.id, id(req), req.body, req.ip ?? null) }), 201))
router.post('/:id/simulate', read, wrap((req) => service.simulate(id(req), req.body)))
router.get('/:id/stats', read, wrap((req) => service.stats(id(req))))
router.get('/:id/redemptions', read, wrap(async (req) => {
  const { limit, offset } = page(req)
  return { redemptions: await service.redemptions(id(req), limit, offset) }
}))

export default router
