import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { geoLimiter } from '@/middleware/rateLimit.middleware'
import * as controller from './geo.controller'

const router: IRouter = Router()

// ── Public ────────────────────────────────────────────────────
router.get('/cities', controller.getCities)
router.get('/cities/nearest', controller.getNearestCity)

// Maps / geocoding (proxied — key stays server-side). These bill against our Google account on every call, so they
// require a signed-in principal and a per-principal throttle; they used to be open to the whole internet.
router.get('/autocomplete', authenticate(), geoLimiter, controller.getAutocomplete)
router.get('/place/:placeId', authenticate(), geoLimiter, controller.getPlaceDetails)
router.get('/reverse', authenticate(), geoLimiter, controller.getReverseGeocode)
router.get('/route', authenticate(), geoLimiter, controller.getRoute)
router.get('/classify-trip', authenticate(), geoLimiter, controller.getTripClassification)

// ── Authenticated (driver JWT required) ───────────────────────
// Flush GPS track batch — called every 30s during active trip
router.post('/tracks/flush', authenticate(), controller.flushTracks)

export default router
