import { Router, IRouter, Request } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { AppErrors } from '@/constants/errors'
import { createHttpError, httpError } from '@/lib/errors'
import * as repo from './notifications.repository'
import type { DeviceOwnerType } from './notifications.repository'

const VALID_PLATFORMS = new Set(['web', 'android', 'ios'])

const router: IRouter = Router()

function resolveOwner(req: Request): { ownerType: DeviceOwnerType; ownerId: bigint } | null {
  if (req.user) return { ownerType: 'user', ownerId: req.user.id }
  if (req.driver) return { ownerType: 'driver', ownerId: req.driver.id }
  if (req.admin) return { ownerType: 'admin', ownerId: req.admin.id }
  return null
}

router.post('/devices', authenticate(), async (req, res, next) => {
  try {
    const owner = resolveOwner(req)
    if (!owner) throw createHttpError(AppErrors.AUTH_FORBIDDEN)

    const token = req.body?.token
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw httpError(422, 'token is required', AppErrors.VALIDATION_ERROR.code)
    }

    const platformInput = req.body?.platform
    if (platformInput !== undefined && (typeof platformInput !== 'string' || !VALID_PLATFORMS.has(platformInput))) {
      throw httpError(422, 'platform must be one of web, android, ios', AppErrors.VALIDATION_ERROR.code)
    }
    const platform = typeof platformInput === 'string' ? platformInput : 'web'

    await repo.upsertDeviceToken({ ownerType: owner.ownerType, ownerId: owner.ownerId, token, platform })
    res.status(204).send()
  } catch (err) { next(err) }
})

router.delete('/devices', authenticate(), async (req, res, next) => {
  try {
    const owner = resolveOwner(req)
    if (!owner) throw createHttpError(AppErrors.AUTH_FORBIDDEN)

    const token = req.body?.token
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw httpError(422, 'token is required', AppErrors.VALIDATION_ERROR.code)
    }
    await repo.deleteDeviceToken(token, owner.ownerType, owner.ownerId)
    res.status(204).send()
  } catch (err) { next(err) }
})

// ── In-app notification feed ─────────────────────────────────────

router.get('/', authenticate(), async (req, res, next) => {
  try {
    const owner = resolveOwner(req)
    if (!owner) throw createHttpError(AppErrors.AUTH_FORBIDDEN)

    const cursorInput = req.query['cursor']
    const cursor = typeof cursorInput === 'string' ? cursorInput : undefined

    const params: Parameters<typeof repo.listNotifications>[0] = {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      limit: 20,
    }
    if (cursor !== undefined) params.cursor = cursor

    const items = await repo.listNotifications(params)
    res.json({ items, nextCursor: items.length === 20 ? items[items.length - 1]!.id : null })
  } catch (err) { next(err) }
})

router.get('/unread-count', authenticate(), async (req, res, next) => {
  try {
    const owner = resolveOwner(req)
    if (!owner) throw createHttpError(AppErrors.AUTH_FORBIDDEN)

    const count = await repo.getUnreadCount(owner.ownerType, owner.ownerId)
    res.json({ count })
  } catch (err) { next(err) }
})

router.patch('/:id/read', authenticate(), async (req, res, next) => {
  try {
    const owner = resolveOwner(req)
    if (!owner) throw createHttpError(AppErrors.AUTH_FORBIDDEN)

    const found = await repo.markRead(BigInt(req.params['id']!), owner.ownerType, owner.ownerId)
    if (!found) throw createHttpError(AppErrors.NOT_FOUND)
    res.status(204).send()
  } catch (err) { next(err) }
})

router.post('/read-all', authenticate(), async (req, res, next) => {
  try {
    const owner = resolveOwner(req)
    if (!owner) throw createHttpError(AppErrors.AUTH_FORBIDDEN)

    await repo.markAllRead(owner.ownerType, owner.ownerId)
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
