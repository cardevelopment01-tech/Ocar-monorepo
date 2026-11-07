import { Router, type IRouter, type Request, type RequestHandler } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'
import * as service from './verification-review.service'

const router: IRouter = Router()

// Reviewing is an ops decision about who is driving: super_admin and ops_admin only.
router.use(authenticate(), requireAdmin('super_admin', 'ops_admin'))

const wrap = (fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler => async (req, res, next) => {
  try { res.status(status).json(await fn(req)) } catch (err) { next(err) }
}
// A non-numeric id is a 404, not a BigInt SyntaxError turning into a 500.
const id = (req: Request) => {
  const raw = req.params['id'] ?? ''
  if (!/^\d{1,18}$/.test(raw)) throw httpError(404, 'Not found', 'NOT_FOUND')
  return BigInt(raw)
}

router.get('/stats', wrap(() => service.stats()))
router.get('/', wrap((req) => service.list(req.query['state'] === 'resolved_today' ? 'resolved_today' : 'queued')))
router.get('/:id', wrap((req) => service.getCase(id(req))))
router.post('/:id/resolve', wrap((req) => service.resolve(req.admin!.id, id(req), req.body, req.ip ?? null)))

export default router
