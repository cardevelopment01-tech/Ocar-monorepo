import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import * as controller from './geo.controller'

const router: IRouter = Router()

// ── Public ────────────────────────────────────────────────────
router.get('/cities', controller.getCities)
router.get('/cities/nearest', controller.getNearestCity)

// Maps / geocoding (proxied — key stays server-side)
router.get('/autocomplete', controller.getAutocomplete)
router.get('/place/:placeId', controller.getPlaceDetails)
router.get('/reverse', controller.getReverseGeocode)
router.get('/route', controller.getRoute)
router.get('/classify-trip', controller.getTripClassification)

// ── Authenticated (driver JWT required) ───────────────────────
// Flush GPS track batch — called every 30s during active trip
router.post('/tracks/flush', authenticate(), controller.flushTracks)

export default router
