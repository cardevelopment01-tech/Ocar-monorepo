import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { deleteAccount } from './account.service'

const router: IRouter = Router()

// DELETE /api/v1/account  { confirm: true } -- the signed-in rider or driver deletes their own account.
router.delete('/', authenticate(), async (req, res, next) => {
  try {
    const role = req.user ? 'user' : req.driver ? 'driver' : null
    const id = req.user?.id ?? req.driver?.id
    if (!role || id === undefined) throw createHttpError(AppErrors.AUTH_FORBIDDEN)
    // Explicit confirmation so a stray or replayed request cannot erase an account by accident.
    if (req.body?.confirm !== true) throw httpError(422, 'confirm must be true', AppErrors.VALIDATION_ERROR.code)
    await deleteAccount(role, id, req.ip ?? null)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
