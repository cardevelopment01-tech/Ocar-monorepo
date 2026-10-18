import { Router, IRouter, RequestHandler } from 'express'
import { AppErrors } from '@/constants/errors'
import { httpError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { getVersionPolicy, identityFromHeaders, parseIdentity } from './app-version.policy'

const router: IRouter = Router()

// Public, no auth: a hard-blocked or logged-out app must still be able to ask. Rate-limited by the
// generalLimiter mounted ahead of it in app.ts.
router.get('/version-policy', async (req, res, next) => {
  try {
    const id = parseIdentity(req.query)
    if (!id) throw httpError(422, 'app, platform and version (1.2.3) are required', AppErrors.VALIDATION_ERROR.code)
    const policy = await getVersionPolicy(id)
    res.set('Cache-Control', 'public, max-age=300')
    res.json(policy)
  } catch (err) { next(err) }
})

/**
 * 426 for builds below the hard minimum. Mounted ONLY on routes that start new work (driver go-online /
 * resume, rider booking) so a live ride is never interrupted. Requests without valid X-App-* headers
 * (web portals, builds that predate the gate) pass; any failure reading config fails open.
 */
export const requireSupportedApp: RequestHandler = async (req, res, next) => {
  const id = identityFromHeaders(req.headers)
  if (!id) { next(); return }
  try {
    const policy = await getVersionPolicy(id)
    if (policy.action !== 'hard') { next(); return }
    logger.info({ app: id.app, platform: id.platform, appVersion: id.version }, 'upgrade_required')
    res.status(AppErrors.UPGRADE_REQUIRED.httpStatus).json({
      error: AppErrors.UPGRADE_REQUIRED.message,
      code: AppErrors.UPGRADE_REQUIRED.code,
      store_url: policy.store_url,
      requestId: req.requestId ?? 'unknown',
    })
  } catch (err) {
    logger.warn({ err }, 'app version check failed, failing open')
    next()
  }
}

export default router
