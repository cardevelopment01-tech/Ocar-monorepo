import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import * as controller from './geo.controller'

const router: IRouter = Router()

// ── Public ────────────────────────────────────────────────────
// All active cities — used by driver app for return_cab destination
router.get('/cities', controller.getCities)

// Nearest city to a GPS point
// Static path before :slug to avoid conflict
router.get('/cities/nearest', controller.getNearestCity)

// ── Authenticated (driver JWT required) ───────────────────────
// Flush GPS track batch — called every 30s during active trip
router.post('/tracks/flush', authenticate(), controller.flushTracks)

export default router
