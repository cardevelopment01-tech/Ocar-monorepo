import { RequestHandler } from 'express'
import { getMaintenanceStatus } from '@/lib/maintenance'
import { AppErrors } from '@/constants/errors'
import { logger } from '@/lib/logger'

// Not a general admin bypass (every other admin route stays blocked) --
// exempted only so the kill switch can't lock itself: an admin must always
// be able to log in, refresh an expiring token, and reach the toggle route
// to turn maintenance back off. /auth/refresh is shared across all three
// roles (no per-role variant), so this technically lets a user/driver
// refresh too, but that alone doesn't unblock anything else for them.
const BYPASS_PATHS = new Set([
  '/health',
  '/metrics',
  '/api/v1/admin/maintenance',
  '/api/v1/auth/admin/login',
  '/api/v1/auth/refresh',
])

const DEFAULT_RETRY_AFTER_SECONDS = 60

// Runs before rate-limiting/auth (both Redis/DB-touching) so a request never
// reaches them while maintenance is on. Fails OPEN on a Redis error — a
// Redis blip must not itself take the whole API down; infra/terraform/alb.tf's
// maintenance_mode listener rule exists for the case where a hard block is
// needed regardless of app/dependency health.
export const maintenanceCheck: RequestHandler = async (req, res, next) => {
  if (BYPASS_PATHS.has(req.path)) {
    next()
    return
  }

  let status
  try {
    status = await getMaintenanceStatus()
  } catch (err) {
    logger.warn({ err }, 'maintenance status check failed, failing open')
    next()
    return
  }

  if (!status.enabled) {
    next()
    return
  }

  const retryAfterSeconds = status.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS
  res.set('Retry-After', String(retryAfterSeconds))
  res.status(AppErrors.MAINTENANCE_MODE.httpStatus).json({
    error: AppErrors.MAINTENANCE_MODE.message,
    code: AppErrors.MAINTENANCE_MODE.code,
    message: status.message,
    requestId: req.requestId ?? 'unknown',
  })
}
