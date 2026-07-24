import { Router, IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { client as redis } from '@/db/redis'
import { startOtpKey, endOtpKey } from '@/constants/redis-keys'
import { getPresignedUrl } from '@/lib/storage'
import * as service from './rides.service'
import * as repo from './rides.repository'
import * as paymentsService from '@/modules/payments/payments.service'

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

// ── User upcoming (scheduled) rides ───────────────────────────

router.get('/me/upcoming', authenticate(), async (req, res, next) => {
  try {
    const userId = req.user!.id
    const rides = await repo.getUpcomingRides(userId)
    res.json({ rides })
  } catch (err) { next(err) }
})

// ── Driver earnings summary ───────────────────────────────────

const VALID_PERIODS = new Set(['today', 'week', 'month'])

router.get('/me/earnings-summary', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const period = (req.query['period'] as string) ?? 'today'
    if (!VALID_PERIODS.has(period)) {
      res.status(400).json({ error: 'period must be today, week, or month' }); return
    }
    const summary = await repo.getDriverEarningsSummary(
      driverId,
      period as 'today' | 'week' | 'month'
    )
    res.json(summary)
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

// ── User active ride ──────────────────────────────────────────

router.get('/me/active-user', authenticate(), async (req, res, next) => {
  try {
    const userId = req.user!.id
    const rideId = await repo.getActiveRideIdForUser(userId)
    if (!rideId) { res.status(404).json({ error: 'No active ride' }); return }
    res.json({ rideId })
  } catch (err) { next(err) }
})

// ── Driver active ride ────────────────────────────────────────

router.get('/me/active', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const ride = await repo.getActiveRideForDriver(driverId)
    if (!ride) { res.status(404).json({ error: 'No active ride' }); return }
    const stops = await repo.getRideStops(BigInt(ride.id))
    res.json({ ...ride, stops })
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

router.get('/return-cab-available', async (req, res, next) => {
  try {
    const pickupLat = parseFloat(req.query['pickupLat'] as string)
    const pickupLng = parseFloat(req.query['pickupLng'] as string)
    const dropLat   = parseFloat(req.query['dropLat']   as string)
    const dropLng   = parseFloat(req.query['dropLng']   as string)
    const categoryId = BigInt(req.query['categoryId'] as string)
    if ([pickupLat, pickupLng, dropLat, dropLng].some(isNaN)) {
      res.status(400).json({ error: 'pickupLat, pickupLng, dropLat, dropLng required' }); return
    }
    const minWalletBalance = await paymentsService.getMinWalletBalance()
    const drivers = await repo.findReturnCabDrivers({ pickupLat, pickupLng, dropLat, dropLng, categoryId, minWalletBalance })
    res.json({ drivers, count: drivers.length })
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

    const callerId = req.user?.id ?? req.driver?.id ?? req.admin?.id
    const isOwner =
      req.admin ||
      (req.user   && String(ride.user_id)   === String(req.user.id)) ||
      (req.driver && String(ride.driver_id) === String(req.driver.id))
    if (!callerId || !isOwner) {
      res.status(403).json({ error: 'Forbidden', code: 'AUTH_FORBIDDEN' }); return
    }

    const rideIdStr = req.params['id']!
    // Ride OTPs are for the rider to read aloud to the driver — never expose
    // them to the driver's or admin's own view of the ride.
    const isRider = !!req.user
    const [startOtp, endOtp, stops] = await Promise.all([
      isRider ? redis.get(startOtpKey(rideIdStr)) : Promise.resolve(null),
      isRider ? redis.get(endOtpKey(rideIdStr)) : Promise.resolve(null),
      repo.getRideStops(BigInt(rideIdStr)),
    ])

    let driverPhoto = ride.driver_photo ?? null
    if (driverPhoto) {
      try { driverPhoto = await getPresignedUrl(driverPhoto) }
      catch { driverPhoto = null }
    }

    res.json({ ...ride, stops, driver_photo: driverPhoto, startOtp: startOtp ?? undefined, endOtp: endOtp ?? undefined })
  } catch (err) { next(err) }
})

// ── Ride cancellation ─────────────────────────────────────────

router.post('/:id/cancel', authenticate(), async (req, res, next) => {
  try {
    const userId = req.user!.id
    const { reasonCode, reason } = req.body as { reasonCode?: string; reason?: string }
    const result = await service.cancelRide(userId, BigInt(req.params['id']!), reasonCode, reason)
    res.json(result)
  } catch (err) { next(err) }
})

router.post('/:id/cancel-driver', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const { reasonCode, reason } = req.body as { reasonCode?: string; reason?: string }
    const result = await service.cancelRideAsDriver(driverId, BigInt(req.params['id']!), reasonCode, reason)
    res.json(result)
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
    const body = req.body as { otp: string; actual_distance_km?: number; actual_duration_min?: number; actual_end_lat?: number; actual_end_lng?: number }
    const result = await service.verifyEndOTP(
      driverId,
      BigInt(req.params['id']!),
      body.otp,
      body.actual_distance_km,
      body.actual_duration_min,
      body.actual_end_lat,
      body.actual_end_lng
    )
    res.json(result)
  } catch (err) { next(err) }
})

// ── Online ride payment verification (user) ────────────────────

router.post('/:id/payment/verify', authenticate(), async (req, res, next) => {
  try {
    const rideId = BigInt(req.params['id']!)
    const { orderId, paymentId, signature } = req.body as {
      orderId: string; paymentId: string; signature: string
    }
    await paymentsService.verifyRidePayment(rideId, req.user!.id, { orderId, paymentId, signature })
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/:id/payment/retry', authenticate(), async (req, res, next) => {
  try {
    const rideId = BigInt(req.params['id']!)
    const result = await paymentsService.retryRidePayment(rideId, req.user!.id)
    res.json(result)
  } catch (err) { next(err) }
})

router.patch('/:id/stops/:sequence', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const sequence = parseInt(req.params['sequence']!, 10)
    const { status } = req.body as { status: 'reached' | 'skipped' }
    if (isNaN(sequence) || (status !== 'reached' && status !== 'skipped')) {
      res.status(400).json({ error: 'sequence and status (reached|skipped) required' }); return
    }
    const result = await service.markStopStatus(driverId, BigInt(req.params['id']!), sequence, status)
    res.json(result)
  } catch (err) { next(err) }
})

export default router
