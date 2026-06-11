import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import * as service from './rides.service'
import * as repo from './rides.repository'

const HISTORY_LIMIT = 20

const router: IRouter = Router()

// ── User ride history ─────────────────────────────────────────

router.get('/me/history', authenticate(), async (req, res, next) => {
  try {
    const userId = req.user!.id
    const page  = Math.max(parseInt((req.query['page'] as string) ?? '1', 10), 1)
    const limit = Math.min(parseInt((req.query['limit'] as string) ?? String(HISTORY_LIMIT), 10), 50)
    const { rows, total } = await repo.getUserRideHistory(userId, limit, (page - 1) * limit)
    res.json({ rides: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
})

// ── Driver trip history ────────────────────────────────────────

router.get('/me/trips', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const page  = Math.max(parseInt((req.query['page'] as string) ?? '1', 10), 1)
    const limit = Math.min(parseInt((req.query['limit'] as string) ?? String(HISTORY_LIMIT), 10), 50)
    const { rows, total } = await repo.getDriverTripHistory(driverId, limit, (page - 1) * limit)
    res.json({ trips: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
})

// ── Driver session ────────────────────────────────────────────

router.post('/sessions/online', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const session = await service.goOnline(driverId, req.body as Parameters<typeof service.goOnline>[1])
    res.json(session)
  } catch (err) { next(err) }
})

router.post('/sessions/offline', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const session = await service.goOffline(driverId, (req.body as { reason?: string }).reason)
    res.json({ success: true, session })
  } catch (err) { next(err) }
})

router.post('/sessions/location', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    await service.updateLocation(driverId, req.body as Parameters<typeof service.updateLocation>[1])
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.get('/sessions/current', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const session = await repo.getActiveSession(driverId)
    res.json(session)
  } catch (err) { next(err) }
})

// ── Ride booking (user) ───────────────────────────────────────

router.post('/', authenticate(), async (req, res, next) => {
  try {
    const userId = req.user!.id
    const result = await service.createBooking(userId, req.body as import('./rides.types').BookingRequest)
    res.status(201).json(result)
  } catch (err) { next(err) }
})

router.get('/nearby-drivers', async (req, res, next) => {
  try {
    const lat = parseFloat(req.query['lat'] as string)
    const lng = parseFloat(req.query['lng'] as string)
    if (isNaN(lat) || isNaN(lng)) { res.status(400).json({ error: 'lat and lng required' }); return }
    const radius = Math.min(parseFloat((req.query['radius'] as string) ?? '8000'), 20000)
    const drivers = await repo.findAllNearbyDrivers({ lat, lng, radiusMetres: radius })
    res.json({ drivers })
  } catch (err) { next(err) }
})

router.get('/:id', authenticate(), async (req, res, next) => {
  try {
    const ride = await repo.getRideById(BigInt(req.params['id']!))
    if (!ride) { res.status(404).json({ error: 'Ride not found' }); return }
    res.json(ride)
  } catch (err) { next(err) }
})

// ── Driver ride actions ───────────────────────────────────────

router.post('/:id/accept', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const result = await service.acceptRide(driverId, BigInt(req.params['id']!))
    res.json(result)
  } catch (err) { next(err) }
})

router.post('/:id/arrived', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const result = await service.markArrived(driverId, BigInt(req.params['id']!))
    res.json(result)
  } catch (err) { next(err) }
})

router.post('/:id/start-otp', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const result = await service.verifyStartOTP(
      driverId,
      BigInt(req.params['id']!),
      (req.body as { otp: string }).otp
    )
    res.json(result)
  } catch (err) { next(err) }
})

router.post('/:id/end-otp', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const body = req.body as { otp: string; actual_distance_km?: number; actual_duration_min?: number }
    const result = await service.verifyEndOTP(
      driverId,
      BigInt(req.params['id']!),
      body.otp,
      body.actual_distance_km,
      body.actual_duration_min
    )
    res.json(result)
  } catch (err) { next(err) }
})

export default router
