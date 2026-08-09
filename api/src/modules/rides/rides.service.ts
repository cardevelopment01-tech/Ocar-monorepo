import { pool } from '@/db/client'
import { httpError, createHttpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { client as redis } from '@/db/redis'
import { startOtpKey, endOtpKey, activeRideByDriverKey, rideAckKey } from '@/constants/redis-keys'
import { getPresignedUrl } from '@/lib/storage'
import { getConfigValue } from '@/lib/system-config'
import * as repo from './rides.repository'
import { getTodayStatus } from '@/modules/drivers/driver-verification.repository'
import { getFareEstimate, clampTripHours } from '@/modules/pricing/pricing.service'
import type { FareEstimateRequest } from '@/modules/pricing/pricing.types'
import { queues, QUEUE_NAMES, gpsFlushQueue } from '@/jobs/queues'
import { socketEvents } from '@/websocket/socket.server'
import { generateOtp, hashOtp } from '@/lib/otp'
import {
  RIDE_OTP_LENGTH,
  ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES,
  MIN_ADVANCE_BOOKING_MINUTES,
  MAX_ADVANCE_BOOKING_DAYS,
  MAX_CONCURRENT_SCHEDULED_BOOKINGS,
  IN_CITY_MAX_TRIP_DISTANCE_METRES,
  MANUAL_ASSIGN_REQUEST_TIMEOUT_SECONDS,
  FORCE_ASSIGN_GRACE_MINUTES,
} from '@/constants/limits'
import type { BroadcastJobData } from '@/jobs/processors/broadcast.processor'
import type { BillingMode, BookingRequest, StopInput } from './rides.types'
import {
  createPaymentRecord,
  deductCommission,
  creditCashback,
  confirmRidePayment,
  payFromUserWallet,
  createRidePaymentOrder,
  getDriverWallet,
  getMinWalletBalance,
} from '@/modules/payments/payments.service'
import { notifyRidePaymentFailed, notifyAllAdmins, notifyOwner } from '@/modules/notifications/notifications.service'
import { consumePackageBalance } from '@/modules/packages/packages.service'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { calculateFare } from '@/lib/fare'
import { classifyTrip, findNearestCity, getRoute, snapTrailToRoads } from '@/modules/geo/geo.service'
import { getStopCharge } from '@/modules/pricing/pricing.repository'
import { MAX_STOPS_PER_RIDE, STOP_DUPLICATE_RADIUS_METRES, STOP_FREE_WAIT_MINUTES } from '@/constants/limits'
import { logger } from '@/lib/logger'
import * as callMasking from '@/modules/call-masking/call-masking.service'

const log = logger.child({ module: 'rides-service' })

// Logs the routing engine's predicted ETA at the start of a leg (see
// docs/PRODUCTION_NAVIGATION_SYSTEM_PLAN.md Phase 4) — instrumentation only,
// never allowed to affect the ride status transition it's attached to.
async function logEtaSnapshot(
  rideId: bigint,
  leg: 'to_pickup' | 'to_destination',
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): Promise<void> {
  try {
    const route = await getRoute(originLat, originLng, destLat, destLng, { trafficAware: true })
    const predicted = route.trafficDurationMin ?? route.durationMin
    await repo.insertEtaSnapshot(rideId, leg, predicted)
  } catch { /* best-effort instrumentation only */ }
}

// Straight-line distance in metres — used only for the ~100m duplicate-stop
// guard, not for fare or routing (those use the client-supplied distanceKm).
function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

const INDIAN_PHONE_RE = /^\+91[6-9]\d{9}$/

function validateRider(data: BookingRequest): void {
  if (data.riderName === undefined && data.riderPhone === undefined) return
  const name = data.riderName?.trim()
  if (!name || name.length > 50) {
    throw Object.assign(new Error('Rider name is required and must be under 50 characters'), { httpStatus: 422 })
  }
  if (!data.riderPhone || !INDIAN_PHONE_RE.test(data.riderPhone)) {
    throw Object.assign(new Error('Rider phone must be a valid Indian mobile number (+91XXXXXXXXXX)'), { httpStatus: 422 })
  }
}

function validateStops(data: BookingRequest): void {
  if (!data.stops || data.stops.length === 0) return
  if (data.rideType !== 'round_trip' && data.rideType !== 'rental' && data.rideType !== 'one_way') {
    throw Object.assign(new Error('Stops are not supported for this ride type'), { httpStatus: 422 })
  }
  if (data.stops.length > MAX_STOPS_PER_RIDE) {
    throw Object.assign(new Error(`A ride can have at most ${MAX_STOPS_PER_RIDE} stops`), { httpStatus: 422 })
  }
  const anchors: Array<{ lat: number; lng: number }> = [{ lat: data.originLat, lng: data.originLng }]
  if (data.destinationLat !== undefined && data.destinationLng !== undefined) {
    anchors.push({ lat: data.destinationLat, lng: data.destinationLng })
  }
  for (let i = 0; i < data.stops.length; i++) {
    const stop = data.stops[i]!
    const others = [...anchors, ...data.stops.slice(0, i)]
    for (const other of others) {
      if (distanceMetres(stop.lat, stop.lng, other.lat, other.lng) < STOP_DUPLICATE_RADIUS_METRES) {
        throw Object.assign(
          new Error(`Stop ${i + 1} is too close to another point in this trip`),
          { httpStatus: 422 }
        )
      }
    }
  }
}

// ── Driver session management ─────────────────────────────────

async function deactivateReturnCabRoutes(sessionId: bigint) {
  await pool.query(
    `UPDATE return_cab_routes
     SET is_active = false, deactivated_at = now(),
         deactivation_reason = 'session_ended'
     WHERE session_id = $1 AND is_active = true`,
    [sessionId]
  )
}

export async function goOnline(driverId: bigint, data: {
  mode: 'standard' | 'return_cab'
  vehicleId: bigint
  categoryId: bigint
  lat: number
  lng: number
  destinationCityId?: bigint
}) {
  const verification = await getTodayStatus(driverId)
  if (!verification.selfieDone || !verification.plateDone) {
    throw httpError(428, "Today's selfie and plate verification is required before going online", 'DAILY_CHECK_REQUIRED')
  }

  // Billing mode is fixed to the driver's assigned operating city
  // (drivers.city_id, set at onboarding — see updatePersonalInfo) — no GPS
  // fallback, so it never flips based on where the driver happens to be.
  const cityRes = await pool.query<{ billing_mode: BillingMode }>(
    `SELECT c.billing_mode FROM drivers d
     JOIN cities c ON c.id = d.city_id AND c.status = 'active'
     WHERE d.id = $1`,
    [driverId]
  )
  if (!cityRes.rows[0]) {
    throw httpError(422, 'Your operating city is not set. Contact support to get it assigned before going online.', 'CITY_NOT_ASSIGNED')
  }
  const billingMode = cityRes.rows[0].billing_mode

  if (billingMode === 'commission') {
    const [minBalance, wallet] = await Promise.all([getMinWalletBalance(), getDriverWallet(driverId)])
    if (wallet?.is_frozen) {
      throw createHttpError(AppErrors.WALLET_FROZEN)
    }
    const balance = wallet ? parseFloat(wallet.balance) : 0
    if (balance < minBalance) {
      throw createHttpError(AppErrors.LOW_WALLET_BALANCE)
    }
  }
  // package-mode: no gate here — a zero/negative package balance only blocks
  // new ride offers (see findNearbyDrivers/findReturnCabDrivers), not going online.

  const existing = await repo.getActiveSession(driverId)
  if (existing) {
    if (existing.status === 'on_trip') {
      throw Object.assign(new Error('Driver has an active ride in progress'), { httpStatus: 409 })
    }
    await repo.endSession(BigInt(existing.id), 'reconnected')
    await deactivateReturnCabRoutes(BigInt(existing.id))
  }

  const session = await repo.createSession({
    driverId,
    vehicleId:         data.vehicleId,
    categoryId:        data.categoryId,
    mode:              data.mode,
    destinationCityId: data.destinationCityId ?? null,
    originLat:         data.lat,
    originLng:         data.lng,
  })

  if (data.mode === 'return_cab' && data.destinationCityId) {
    const cityRes = await pool.query<{ dest_lat: number; dest_lng: number }>(
      `SELECT
         ST_Y(centroid::geometry) AS dest_lat,
         ST_X(centroid::geometry) AS dest_lng
       FROM cities WHERE id = $1`,
      [data.destinationCityId]
    )
    const cityRow = cityRes.rows[0]
    if (cityRow) {
      await pool.query(
        `INSERT INTO return_cab_routes
           (session_id, driver_id, destination_city_id,
            origin_lat, origin_lng,
            destination_lat, destination_lng,
            corridor)
         VALUES ($1,$2,$3,$4::float8,$5::float8,$6::float8,$7::float8,
           ST_MakeLine(
             ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326),
             ST_SetSRID(ST_MakePoint($7::float8, $6::float8), 4326)
           )::geography
         )`,
        [session.id, driverId, data.destinationCityId, data.lat, data.lng, cityRow.dest_lat, cityRow.dest_lng]
      )
    }
  }

  await repo.upsertDriverLocation({
    driverId,
    sessionId:   BigInt(session.id),
    lat:         data.lat,
    lng:         data.lng,
    recordedAt:  new Date().toISOString(),
    isAvailable: true,
  })

  socketEvents.sendAdminDriverUpdate({
    driverId: String(driverId),
    lat:      data.lat,
    lng:      data.lng,
    heading:  0,
    speed:    0,
  })

  return session
}

export async function goOffline(driverId: bigint, reason = 'driver_choice') {
  const session = await repo.getActiveSession(driverId)
  if (!session) return null

  await repo.endSession(BigInt(session.id), reason)
  await deactivateReturnCabRoutes(BigInt(session.id))

  await pool.query(
    `UPDATE driver_location_snapshots
     SET is_available = false
     WHERE driver_id = $1`,
    [driverId]
  )

  return session
}

// Last raw ping per driver, so each new ping can be road-snapped together with
// its predecessor (the exact hop where a straight chord would cut through a
// building/lake, or across a turn) — keyed by driverId (a small, slowly-growing
// set), not rideId, so it never leaks memory across completed rides.
const lastRawPingByDriver = new Map<string, { lat: number; lng: number }>()

const ACTIVE_RIDE_CACHE_TTL_SEC = 10

export async function updateLocation(driverId: bigint, data: {
  sessionId: bigint
  lat: number
  lng: number
  heading?: number
  speed?: number
  recordedAt: string
}) {
  const locationInput: Parameters<typeof repo.upsertDriverLocation>[0] = {
    driverId,
    sessionId:   data.sessionId,
    lat:         data.lat,
    lng:         data.lng,
    recordedAt:  data.recordedAt,
    isAvailable: true,
  }
  if (data.heading !== undefined) locationInput.heading = data.heading
  if (data.speed   !== undefined) locationInput.speed   = data.speed
  await repo.upsertDriverLocation(locationInput)

  socketEvents.sendAdminDriverUpdate({
    driverId: driverId.toString(),
    lat:      data.lat,
    lng:      data.lng,
    heading:  data.heading ?? 0,
    speed:    data.speed   ?? 0,
  })

  // Emit live location to the user's tracking page. This query runs on every
  // GPS ping (every ~3s per online driver), so the result is cached with a
  // short TTL — worst case a status change (accept/complete/cancel) takes up
  // to ACTIVE_RIDE_CACHE_TTL_SEC to be reflected, which just delays/extends
  // live tracking emission by that long, never breaks correctness elsewhere.
  const activeRideCacheKey = activeRideByDriverKey(driverId.toString())
  let rideId = await redis.get(activeRideCacheKey)
  if (rideId === null) {
    const activeRideRes = await pool.query<{ id: string }>(
      `SELECT id::text FROM rides WHERE driver_id = $1 AND status IN ('accepted','driver_arrived','in_progress','returning') LIMIT 1`,
      [driverId]
    )
    rideId = activeRideRes.rows[0]?.id ?? ''
    await redis.set(activeRideCacheKey, rideId, 'EX', ACTIVE_RIDE_CACHE_TTL_SEC)
  }
  if (rideId) {
    const current = { lat: data.lat, lng: data.lng }
    const prevPing = lastRawPingByDriver.get(driverId.toString())
    lastRawPingByDriver.set(driverId.toString(), current)

    // Road-snap this hop (previous raw ping -> this one) so both the live driver
    // marker and the rider's trail line follow real roads instead of a straight
    // GPS chord — this is the exact segment that cuts through a building/lake or
    // clips a turn. Fire-and-forget: a slow/failed Roads API call must never
    // delay this response or the driver's location-update loop.
    void (async () => {
      const points = prevPing ? await snapTrailToRoads([prevPing, current]) : [current]
      const marker = points[points.length - 1] ?? current
      socketEvents.sendDriverLocation(rideId, {
        lat:        marker.lat,
        lng:        marker.lng,
        heading:    data.heading ?? 0,
        speed_kmph: data.speed ?? 0,
      })
      socketEvents.sendTrailSegment(rideId, points)
    })().catch(() => {})

    // Async GPS track write — best-effort, does not block the response
    gpsFlushQueue.add('gps_track', {
      rideId,
      driverId:  driverId.toString(),
      sessionId: data.sessionId.toString(),
      lat:       data.lat,
      lng:       data.lng,
      heading:   data.heading,
      speed:     data.speed,
      recordedAt: data.recordedAt,
    }, { removeOnComplete: 200, removeOnFail: 50 }).catch(() => {})
  }
}

// Strips the *other* party's raw phone number before a ride row leaves the
// API — the rider must never see the driver's number and vice versa (admin
// ops views are exempt). Applied at the route boundary, not the repository,
// so the numbers are still available server-side for SMS/notification jobs.
export function maskRideContacts<T extends {
  user_phone?: string | null
  rider_phone?: string | null
  driver_phone?: string | null
  commission_percent?: string | null
  commission_amount?: string | null
  driver_earning?: string | null
}>(ride: T, viewer: 'user' | 'driver' | 'admin'): T {
  if (viewer === 'admin') return ride
  if (viewer === 'user') {
    // Commission/earning are the driver's business, not the rider's — strip
    // them here rather than gating in every route handler that calls this.
    return { ...ride, driver_phone: null, commission_percent: null, commission_amount: null, driver_earning: null }
  }
  return { ...ride, user_phone: null, rider_phone: null }
}

// ── Ride booking ──────────────────────────────────────────────

export async function createBooking(userId: bigint, data: BookingRequest) {
  // Only immediate bookings conflict with an existing active ride — a
  // scheduled-for-later booking (data.scheduledFor set) is fine to stack on
  // top of a ride happening right now. Reuses the same staleness-aware query
  // the frontend's auto-redirect uses, so this can't false-positive on the
  // class of orphaned ride the cleanup sweep exists to resolve.
  if (data.scheduledFor === undefined) {
    const activeRideId = await repo.getActiveRideIdForUser(userId)
    if (activeRideId) {
      throw Object.assign(new Error('You already have an active ride'), { httpStatus: 409 })
    }
  }

  if (
    (data.rideType === 'one_way' || data.rideType === 'round_trip') &&
    data.destinationLat !== undefined &&
    data.destinationLng !== undefined
  ) {
    const classification = await classifyTrip(
      data.originLat, data.originLng, data.destinationLat, data.destinationLng
    )
    if (classification.scope === 'in_city') {
      const tripDistanceMetres = distanceMetres(
        data.originLat, data.originLng, data.destinationLat, data.destinationLng
      )
      if (tripDistanceMetres < IN_CITY_MAX_TRIP_DISTANCE_METRES) {
        throw Object.assign(
          new Error(`This trip stays within ${classification.cityName} — book an hourly rental package instead`),
          { httpStatus: 422 }
        )
      }
    }
  }

  if (data.rideType === 'rental' && (data.destinationLat === undefined || data.destinationLng === undefined)) {
    throw Object.assign(
      new Error('Please add a drop-off location before booking this rental'),
      { httpStatus: 422 }
    )
  }

  let scheduledForDate: Date | null = null
  if (data.scheduledFor !== undefined) {
    scheduledForDate = new Date(data.scheduledFor)
    if (isNaN(scheduledForDate.getTime())) {
      throw Object.assign(new Error('Invalid scheduledFor date'), { httpStatus: 422 })
    }
    const minAllowed = Date.now() + MIN_ADVANCE_BOOKING_MINUTES * 60_000
    const maxAllowed = Date.now() + MAX_ADVANCE_BOOKING_DAYS * 24 * 60 * 60_000
    if (scheduledForDate.getTime() < minAllowed) {
      throw Object.assign(
        new Error(`Scheduled rides must be booked at least ${MIN_ADVANCE_BOOKING_MINUTES} minutes ahead`),
        { httpStatus: 422 }
      )
    }
    if (scheduledForDate.getTime() > maxAllowed) {
      throw Object.assign(
        new Error(`Scheduled rides can only be booked up to ${MAX_ADVANCE_BOOKING_DAYS} days ahead`),
        { httpStatus: 422 }
      )
    }
    const scheduledCount = await repo.countScheduledRidesForUser(userId)
    if (scheduledCount >= MAX_CONCURRENT_SCHEDULED_BOOKINGS) {
      throw Object.assign(
        new Error(`You can only have ${MAX_CONCURRENT_SCHEDULED_BOOKINGS} scheduled rides at a time`),
        { httpStatus: 422 }
      )
    }
  }

  validateRider(data)
  validateStops(data)
  // Derived server-side so the persisted count and ride_stops rows can never
  // diverge — client-supplied stopCount is accepted-but-ignored (see BookingRequest).
  const stopCount = data.stops?.length ?? 0
  // Only round trips levy the flat per-stop charge. Rental stops are a free
  // itinerary (§2.2); one-way stops are priced through the detour distance the
  // client routes through the waypoints (§5.2 v2 trigger) — the flat fee would
  // double-charge on a per-km ride type, so both pass 0 here.
  const fareStopCount = data.rideType === 'round_trip' ? stopCount : 0

  // Enforce minimum 4h for round trips — must match pricing.service clamp so
  // fare_snapshots.trip_hours records the same value used to compute the fare.
  const effectiveTripHours = clampTripHours(data.rideType, data.tripHours)

  // originCityId is client-supplied and unverified (URL params are tamperable) — the
  // pickup coordinates are what the client actually can't fake without lying about GPS,
  // so re-derive the billing city from them instead of trusting data.originCityId.
  const originCity = await findNearestCity(data.originLat, data.originLng)

  const fareReq: FareEstimateRequest = {
    category_id:  data.categoryId,
    ride_type:    data.rideType,
    is_return_cab: data.isReturnCab ?? false,
    distance_km:  data.distanceKm,
    duration_min: data.durationMin,
    stop_count:   fareStopCount,
    trip_hours:   effectiveTripHours,
  }
  if (data.rentalPackageId !== undefined) fareReq.rental_package_id = data.rentalPackageId
  if (originCity           !== null)      fareReq.city_id           = originCity.id
  const fareEstimate = await getFareEstimate(fareReq)

  const rideInput: Parameters<typeof repo.createRide>[0] = {
    userId,
    categoryId:   BigInt(data.categoryId),
    rideType:     data.rideType,
    isReturnCab:  data.isReturnCab ?? false,
    originLat:    data.originLat,
    originLng:    data.originLng,
    destinationLat: data.destinationLat ?? null,
    destinationLng: data.destinationLng ?? null,
  }
  if (data.originAddress      !== undefined) rideInput.originAddress      = data.originAddress
  if (data.destinationAddress !== undefined) rideInput.destinationAddress = data.destinationAddress
  if (originCity              !== null)      rideInput.originCityId       = BigInt(originCity.id)
  if (data.destinationCityId  !== undefined) rideInput.destinationCityId  = BigInt(data.destinationCityId)
  if (data.rentalPackageId    !== undefined) rideInput.rentalPackageId    = BigInt(data.rentalPackageId)
  const storedTripHours = fareEstimate.rental_hours ?? (effectiveTripHours > 0 ? effectiveTripHours : undefined)
  if (storedTripHours !== undefined) rideInput.tripHours = storedTripHours
  if (data.returnAt           !== undefined) rideInput.returnAt           = data.returnAt
  if (data.riderName          !== undefined) rideInput.riderName          = data.riderName.trim()
  if (data.riderPhone         !== undefined) rideInput.riderPhone         = data.riderPhone
  rideInput.paymentChannel = data.paymentChannel ?? 'cash'
  if (scheduledForDate && data.scheduledFor !== undefined) {
    rideInput.scheduledFor = data.scheduledFor
    rideInput.status = 'scheduled'
  }
  const ride = await repo.createRide(rideInput)

  if (data.stops && data.stops.length > 0) {
    const chargePerStop = data.rideType === 'round_trip' ? await getStopCharge(data.categoryId) : 0
    await repo.insertRideStops(
      BigInt(ride.id),
      data.stops.map(stop => ({ ...stop, chargeApplied: chargePerStop }))
    )
  }

  await pool.query(
    `INSERT INTO fare_snapshots (
       ride_id, rate_card_id, rental_package_id,
       ride_type, is_return_cab,
       surge_event_id, surge_multiplier,
       estimated_km, estimated_min, stop_count, trip_hours,
       base_fare, distance_fare, time_fare,
       stop_fare, hour_surcharge, surge_fare,
       total_estimated, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'estimate')`,
    [
      ride.id,
      fareEstimate.rate_card_id,
      data.rentalPackageId ?? null,
      data.rideType,
      data.isReturnCab ?? false,
      fareEstimate.surge_event_id,
      fareEstimate.surge_multiplier,
      data.distanceKm,
      data.durationMin,
      fareStopCount,
      effectiveTripHours,
      fareEstimate.breakdown.base_fare,
      fareEstimate.breakdown.distance_fare,
      fareEstimate.breakdown.time_fare,
      fareEstimate.breakdown.stop_fare,
      fareEstimate.breakdown.hour_surcharge,
      fareEstimate.breakdown.surge_fare,
      fareEstimate.breakdown.total,
    ]
  )

  if (scheduledForDate) {
    await repo.logStatusHistory({
      rideId:     BigInt(ride.id),
      fromStatus: null,
      toStatus:   'scheduled',
      actor:      'user',
      actorId:    userId,
    })

    await repo.createAdvanceMeta({
      rideId:                 BigInt(ride.id),
      dispatchBufferMinutes:  ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES,
      rateCardIdAtBooking:    BigInt(fareEstimate.rate_card_id),
    })

    const dispatchAt = scheduledForDate.getTime() - ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES * 60_000
    const delay = Math.max(dispatchAt - Date.now(), 0)
    const job = await queues[QUEUE_NAMES.SCHEDULER].add(
      'dispatch_scheduled_ride',
      { rideId: ride.id.toString() },
      { delay, attempts: 3, removeOnComplete: true }
    )
    if (job.id) await repo.setAdvanceMetaJobId(BigInt(ride.id), job.id)

    return {
      rideId:          ride.id.toString(),
      status:          'scheduled',
      scheduledFor:    data.scheduledFor,
      estimatedFare:   fareEstimate.breakdown.total,
      surgeMultiplier: fareEstimate.surge_multiplier,
    }
  }

  await repo.logStatusHistory({
    rideId:     BigInt(ride.id),
    fromStatus: null,
    toStatus:   'requested',
    actor:      'user',
    actorId:    userId,
  })

  const jobData: BroadcastJobData = {
    rideId:         ride.id.toString(),
    categoryId:     data.categoryId.toString(),
    originLat:      data.originLat,
    originLng:      data.originLng,
    rideType:       data.rideType,
    isReturnCab:    data.isReturnCab ?? false,
    broadcastRound: 1,
  }
  if (data.destinationLat !== undefined) jobData.destinationLat = data.destinationLat
  if (data.destinationLng !== undefined) jobData.destinationLng = data.destinationLng
  if (data.returnAt       !== undefined) jobData.returnAt       = data.returnAt
  if (storedTripHours     !== undefined) jobData.tripHours      = storedTripHours

  // All three rounds go through BullMQ so failures are logged consistently and
  // broadcastRound numbering is always correct even if an earlier round fails.
  await Promise.all([
    queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride',
      { ...jobData, broadcastRound: 1 },
      { delay: 0, attempts: 2, removeOnComplete: true }
    ),
    queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride',
      { ...jobData, broadcastRound: 2 },
      { delay: 25_000, attempts: 1, removeOnComplete: true }
    ),
    queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride',
      { ...jobData, broadcastRound: 3 },
      { delay: 50_000, attempts: 1, removeOnComplete: true }
    ),
  ])

  return {
    rideId:          ride.id.toString(),
    status:          'requested',
    estimatedFare:   fareEstimate.breakdown.total,
    surgeMultiplier: fareEstimate.surge_multiplier,
  }
}

// ── Driver ride actions ───────────────────────────────────────

export async function acceptRide(driverId: bigint, rideId: bigint) {
  // Same driver-city resolution as goOnline above — no GPS fallback. A driver
  // reaching this point already passed the goOnline city gate, so this should
  // always resolve; erroring instead of defaulting surfaces a data problem
  // rather than silently mis-billing the ride. Deliberately independent of
  // rideId — whether the ride still exists/is acceptable is repo.acceptAssignment's
  // job below (its own UPDATE ... WHERE status = 'requested' check), not this one's.
  const cityRes = await pool.query<{ billing_mode: BillingMode }>(
    `SELECT c.billing_mode FROM drivers d
     JOIN cities c ON c.id = d.city_id AND c.status = 'active'
     WHERE d.id = $1`,
    [driverId]
  )
  if (!cityRes.rows[0]) {
    throw httpError(422, 'Driver operating city is not set', 'CITY_NOT_ASSIGNED')
  }
  const billingMode = cityRes.rows[0].billing_mode

  const cancelledDriverIds = await repo.acceptAssignment(rideId, driverId, billingMode)
  if (cancelledDriverIds === false) {
    throw Object.assign(new Error('Ride no longer available'), { httpStatus: 409 })
  }

  for (const id of cancelledDriverIds) {
    socketEvents.sendRequestExpired(id, rideId.toString())
  }

  const ride = await repo.getRideById(rideId)

  if (ride?.driver_current_lat != null && ride?.driver_current_lng != null) {
    void logEtaSnapshot(
      rideId, 'to_pickup',
      ride.driver_current_lat, ride.driver_current_lng,
      ride.origin_lat, ride.origin_lng,
    )
  }

  await repo.logStatusHistory({
    rideId,
    fromStatus: 'requested',
    toStatus:   'accepted',
    actor:      'driver',
    actorId:    driverId,
  })

  let driverPhoto = ride?.driver_photo ?? null
  if (driverPhoto) {
    try { driverPhoto = await getPresignedUrl(driverPhoto) }
    catch { driverPhoto = null }
  }

  socketEvents.sendDriverAssigned(rideId.toString(), {
    rideId:             rideId.toString(),
    status:             'accepted',
    driverId:           driverId.toString(),
    driverName:         ride?.driver_name ?? null,
    driverRating:       ride?.driver_rating ?? null,
    driverPhoto:        driverPhoto,
    vehicleModel:       ride?.vehicle_model ?? null,
    vehicleBrand:       ride?.vehicle_brand ?? null,
    vehicleColor:       ride?.vehicle_color ?? null,
    vehicleName:        ride?.vehicle_name ?? null,
    vehicleNumberPlate: ride?.vehicle_number_plate ?? null,
  })

  const riderPhoneForMasking = ride?.rider_phone ?? ride?.user_phone
  if (ride?.driver_phone && riderPhoneForMasking) {
    void callMasking.allocateForRide({
      rideId,
      driverPhone: ride.driver_phone,
      riderPhone:  riderPhoneForMasking,
    }).catch((err: unknown) => {
      log.error({ err, rideId }, 'call-masking allocation failed')
    })
  }

  if (ride?.user_phone) {
    void queues[QUEUE_NAMES.NOTIFICATIONS].add('ride_accepted', {
      rideId:      rideId.toString(),
      userId:      ride.user_id.toString(),
      userPhone:   ride.user_phone,
      driverName:  ride.driver_name ?? null,
      driverPhone: ride.driver_phone ?? null,
    }, { attempts: 2, removeOnComplete: 50, removeOnFail: 20 }).catch(() => {})
  }

  return { success: true, rideId: rideId.toString() }
}

export async function markArrived(driverId: bigint, rideId: bigint) {
  const otp  = generateOtp(RIDE_OTP_LENGTH)
  const hash = hashOtp(otp)

  await repo.updateRideStatus(rideId, 'driver_arrived', {
    driver_arrived_at: new Date().toISOString(),
    start_otp_hash:    hash,
  })

  await repo.logStatusHistory({
    rideId,
    fromStatus: 'accepted',
    toStatus:   'driver_arrived',
    actor:      'driver',
    actorId:    driverId,
  })

  await redis.set(startOtpKey(rideId.toString()), otp, 'EX', 7200)

  socketEvents.sendRideStatusUpdate(rideId.toString(), {
    status: 'driver_arrived',
  })

  const ride = await repo.getRideById(rideId)
  if (ride) {
    // Rider-only channel: the OTP must never reach the driver's socket.
    socketEvents.sendUserUpdate(ride.user_id.toString(), {
      status:   'driver_arrived',
      startOtp: otp,
    })
  }

  return { success: true }
}

// Driver-triggered transition into the return leg of a round_trip ride. Uses
// the CAS variant (unlike markArrived's plain update) so a double-tap/retry
// of the "start return" control is a clean 409 no-op instead of double-
// logging history or double-emitting the socket event.
export async function startReturn(driverId: bigint, rideId: bigint) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!ride.driver_id || BigInt(ride.driver_id) !== driverId) {
    throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  }
  if (ride.ride_type !== 'round_trip') {
    throw Object.assign(new Error('Only round_trip rides have a return leg'), { httpStatus: 422 })
  }

  const updated = await repo.updateRideStatusCAS(rideId, 'in_progress', 'returning', {
    return_started_at: new Date().toISOString(),
  })
  if (!updated) {
    throw Object.assign(new Error('Ride is not in progress'), { httpStatus: 409 })
  }

  await repo.logStatusHistory({
    rideId,
    fromStatus: 'in_progress',
    toStatus:   'returning',
    actor:      'driver',
    actorId:    driverId,
  })

  socketEvents.sendRideStatusUpdate(rideId.toString(), { status: 'returning' })

  return { success: true }
}

export async function verifyStartOTP(driverId: bigint, rideId: bigint, otp: string) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (ride.status !== 'driver_arrived') {
    throw Object.assign(new Error('Ride not in correct state'), { httpStatus: 409 })
  }

  const valid = ride.start_otp_hash != null && hashOtp(otp) === ride.start_otp_hash

  await pool.query(
    `INSERT INTO ride_otp_events
       (ride_id, otp_type, event, actor_role, attempt_number)
     VALUES ($1,'trip_start',$2,'driver',1)`,
    [rideId, valid ? 'verified' : 'failed']
  )

  if (!valid) throw Object.assign(new Error('Invalid OTP'), { httpStatus: 422 })

  const endOtp  = generateOtp(RIDE_OTP_LENGTH)
  const endHash = hashOtp(endOtp)

  await repo.updateRideStatus(rideId, 'in_progress', {
    started_at:   new Date().toISOString(),
    end_otp_hash: endHash,
  })

  if (ride.dest_lat != null && ride.dest_lng != null) {
    void logEtaSnapshot(
      rideId, 'to_destination',
      ride.origin_lat, ride.origin_lng,
      ride.dest_lat, ride.dest_lng,
    )
  }

  await repo.logStatusHistory({
    rideId,
    fromStatus: 'driver_arrived',
    toStatus:   'in_progress',
    actor:      'driver',
    actorId:    driverId,
  })

  await redis.del(startOtpKey(rideId.toString()))
  await redis.set(endOtpKey(rideId.toString()), endOtp, 'EX', 43200)

  socketEvents.sendRideStatusUpdate(rideId.toString(), {
    status:    'in_progress',
    startedAt: new Date().toISOString(),
  })

  // Rider-only channel: the OTP must never reach the driver's socket.
  socketEvents.sendUserUpdate(ride.user_id.toString(), {
    status: 'in_progress',
    endOtp,
  })

  return { success: true }
}

// ── Ride stops ───────────────────────────────────────────────

async function assertRideStopAccess(driverId: bigint, rideId: bigint) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!ride.driver_id || BigInt(ride.driver_id) !== driverId) {
    throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  }
  if (ride.status !== 'in_progress') {
    throw Object.assign(new Error('Ride not in progress'), { httpStatus: 409 })
  }
  return ride
}

// Driver reached a stop — starts the server-side wait clock (one-way only).
export async function markStopArrived(
  driverId: bigint,
  rideId: bigint,
  sequence: number
) {
  await assertRideStopAccess(driverId, rideId)

  const stop = await repo.markStopArrived(rideId, sequence)
  if (!stop) {
    throw Object.assign(new Error('Stop not found or already resolved'), { httpStatus: 409 })
  }

  socketEvents.sendStopUpdated(rideId.toString(), {
    rideId: rideId.toString(),
    sequence: stop.sequence,
    status: stop.status,
    reachedAt: stop.reached_at,
  })

  return { success: true, stop }
}

export async function markStopStatus(
  driverId: bigint,
  rideId: bigint,
  sequence: number,
  status: 'reached' | 'skipped'
) {
  const ride = await assertRideStopAccess(driverId, rideId)

  // Only one-way meters wait (round-trip/rental absorb it in the hours package).
  // Wait is billed at the ride's per-minute rate beyond the free window.
  let ratePerMin = 0
  let freeMinutes = 0
  if (status === 'reached' && ride.ride_type === 'one_way') {
    ratePerMin  = await repo.getRideRatePerMin(rideId)
    freeMinutes = STOP_FREE_WAIT_MINUTES
  }

  const stop = await repo.markStopStatus(rideId, sequence, status, ratePerMin, freeMinutes)
  if (!stop) {
    throw Object.assign(new Error('Stop not found or already resolved'), { httpStatus: 409 })
  }

  socketEvents.sendStopUpdated(rideId.toString(), {
    rideId: rideId.toString(),
    sequence: stop.sequence,
    status: stop.status,
    reachedAt: stop.reached_at,
  })

  return { success: true, stop }
}

const STOP_ADDABLE_STATUSES = new Set(['accepted', 'driver_arrived', 'in_progress'])

// Lets the rider add a stop to a ride that's already been accepted/is on the
// way. Mirrors createBooking's stop pricing rule: only round_trip levies the
// flat per-stop charge (one_way prices the detour through distance instead;
// rental stops are a free itinerary) — see validateStops/createBooking for
// why. Retries once on a unique-violation (ride_stops has UNIQUE(ride_id,
// sequence)) because two concurrent adds for the same ride can race on the
// server-computed MAX(sequence)+1 — a bounded retry recomputes it fresh
// rather than surfacing a raw DB error to the rider.
export async function addRideStop(
  userId: bigint,
  rideId: bigint,
  stop: StopInput
) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (BigInt(ride.user_id) !== userId) {
    throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  }
  if (!STOP_ADDABLE_STATUSES.has(ride.status)) {
    throw Object.assign(new Error('Stops can only be added while the ride is on the way'), { httpStatus: 409 })
  }

  const existingStops = await repo.getRideStops(rideId)
  if (existingStops.length + 1 > MAX_STOPS_PER_RIDE) {
    throw Object.assign(new Error(`A ride can have at most ${MAX_STOPS_PER_RIDE} stops`), { httpStatus: 422 })
  }
  const anchors: Array<{ lat: number; lng: number }> = [{ lat: ride.origin_lat, lng: ride.origin_lng }]
  if (ride.dest_lat !== null && ride.dest_lng !== null) {
    anchors.push({ lat: ride.dest_lat, lng: ride.dest_lng })
  }
  const others = [...anchors, ...existingStops.map(s => ({ lat: s.lat, lng: s.lng }))]
  for (const other of others) {
    if (distanceMetres(stop.lat, stop.lng, other.lat, other.lng) < STOP_DUPLICATE_RADIUS_METRES) {
      throw Object.assign(new Error('This stop is too close to another point in this trip'), { httpStatus: 422 })
    }
  }

  const chargeApplied = ride.ride_type === 'round_trip'
    ? await getStopCharge(Number(ride.category_id))
    : 0

  let newStop
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      newStop = await repo.appendRideStop(rideId, { ...stop, chargeApplied })
      break
    } catch (err) {
      if ((err as { code?: string }).code === '23505' && attempt < MAX_ATTEMPTS) continue
      throw err
    }
  }

  socketEvents.sendStopAdded(rideId.toString(), {
    rideId: rideId.toString(),
    stop: newStop,
  })

  if (ride.driver_id != null) {
    try {
      const { subject, body } = await renderTemplate('stop_added', 'push', {
        stopAddress: newStop!.address ? ` at ${newStop!.address}` : '',
      })
      await notifyOwner({
        ownerType: 'driver',
        ownerId: BigInt(ride.driver_id),
        type: 'stop_added',
        title: subject ?? 'New stop added',
        body,
        rideId,
        // Several stops can be added to the same ride in quick succession —
        // collapse repeat pushes into one OS notification instead of stacking.
        tag: `stop:${rideId}`,
      })
    } catch (err) {
      log.error({ err }, 'stop_added notification failed')
    }
  }

  return newStop!
}

// ── Ride cancellation ─────────────────────────────────────────

const CANCELLABLE_BY_USER   = new Set(['scheduled', 'requested', 'accepted', 'driver_arrived'])
const CANCELLABLE_BY_DRIVER = new Set(['accepted', 'driver_arrived'])

function cancelStageFor(status: string): string {
  if (status === 'scheduled')       return 'before_dispatch'
  if (status === 'accepted')        return 'after_acceptance'
  if (status === 'driver_arrived')  return 'after_arrival'
  return 'before_acceptance'
}

export async function cancelRide(
  userId: bigint,
  rideId: bigint,
  reasonCode?: string,
  reason?: string,
) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (BigInt(ride.user_id) !== userId) throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  if (!CANCELLABLE_BY_USER.has(ride.status)) {
    throw Object.assign(new Error('Ride cannot be cancelled at this stage'), { httpStatus: 409 })
  }

  const stage = cancelStageFor(ride.status)
  const feeApplicable = stage !== 'before_acceptance' && stage !== 'before_dispatch'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const upd = await client.query(
      `UPDATE rides SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1 AND status = $2`,
      [rideId, ride.status]
    )
    if ((upd.rowCount ?? 0) === 0) {
      throw Object.assign(new Error('Ride status changed — please refresh'), { httpStatus: 409 })
    }

    await client.query(
      `INSERT INTO ride_cancellations
         (ride_id, actor, stage, cancelled_by_user_id, reason_code, reason, fee_applicable, fee_amount, fee_waived)
       VALUES ($1, 'user', $2, $3, $4, $5, $6, 0, false)`,
      [rideId, stage, userId, reasonCode ?? null, reason ?? null, feeApplicable]
    )

    await client.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, actor_id)
       VALUES ($1, $2, 'cancelled', 'user', $3)`,
      [rideId, ride.status, userId]
    )

    if (stage === 'before_dispatch') {
      await client.query(
        `UPDATE ride_advance_meta SET status = 'cancelled' WHERE ride_id = $1`,
        [rideId]
      )
    }

    if (ride.driver_id) {
      await client.query(
        `UPDATE driver_sessions SET status = 'online'
         WHERE driver_id = $1 AND status = 'on_trip'`,
        [BigInt(ride.driver_id)]
      )
      await client.query(
        `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
        [BigInt(ride.driver_id)]
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  void callMasking.releaseForRide(rideId).catch((err: unknown) => {
    log.error({ err, rideId }, 'call-masking release failed')
  })

  socketEvents.sendRideStatusUpdate(rideId.toString(), {
    status: 'cancelled',
    cancelledBy: 'user',
    reasonCode: reasonCode ?? null,
  })

  // Ride was still broadcasting (no driver had accepted yet) — those drivers
  // never joined the ride:{id} room, so the status update above never reached
  // them. Without this, their incoming-request card sits until the broadcast
  // window times out on its own.
  if (stage === 'before_dispatch' || stage === 'before_acceptance') {
    const notifiedDriverIds = await repo.cancelAllAssignments(rideId)
    for (const driverId of notifiedDriverIds) {
      socketEvents.sendRequestExpired(driverId, rideId.toString())
    }
  }

  return { success: true }
}

export async function cancelRideAsDriver(
  driverId: bigint,
  rideId: bigint,
  reasonCode?: string,
  reason?: string,
) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!ride.driver_id || BigInt(ride.driver_id) !== driverId) {
    throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  }
  if (!CANCELLABLE_BY_DRIVER.has(ride.status)) {
    throw Object.assign(new Error('Ride cannot be cancelled at this stage'), { httpStatus: 409 })
  }

  const stage = cancelStageFor(ride.status)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const upd = await client.query(
      `UPDATE rides SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1 AND status = $2`,
      [rideId, ride.status]
    )
    if ((upd.rowCount ?? 0) === 0) {
      throw Object.assign(new Error('Ride status changed — please refresh'), { httpStatus: 409 })
    }

    await client.query(
      `INSERT INTO ride_cancellations
         (ride_id, actor, stage, cancelled_by_driver_id, reason_code, reason, fee_applicable, fee_amount, fee_waived)
       VALUES ($1, 'driver', $2, $3, $4, $5, false, 0, false)`,
      [rideId, stage, driverId, reasonCode ?? null, reason ?? null]
    )

    await client.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, actor_id)
       VALUES ($1, $2, 'cancelled', 'driver', $3)`,
      [rideId, ride.status, driverId]
    )

    await client.query(
      `UPDATE driver_sessions SET status = 'online'
       WHERE driver_id = $1 AND status = 'on_trip'`,
      [driverId]
    )
    await client.query(
      `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
      [driverId]
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  void callMasking.releaseForRide(rideId).catch((err: unknown) => {
    log.error({ err, rideId }, 'call-masking release failed')
  })

  socketEvents.sendRideStatusUpdate(rideId.toString(), {
    status: 'cancelled',
    cancelledBy: 'driver',
    reasonCode: reasonCode ?? null,
  })
  return { success: true }
}

// ── Mid-trip abort with partial-fare settlement ────────────────
// Distinct from cancelRideAsDriver: that function only ever runs pre-pickup
// (accepted/driver_arrived), where no fare is owed. Once in_progress, real
// distance has been driven and must be billed — so this marks the ride
// `completed` (not `cancelled`) and reuses the exact same partial-fare
// recalculation the round-trip early-termination path already performs,
// then falls through to the normal completion settlement pipeline.
// ponytail: the "why it ended early" reason lives in rides.review_reason
// (existing column) rather than a new ride_cancellations row — if ops needs
// richer reporting on this later (rate, by-reason breakdown), promote it to
// a dedicated table then.
// actualDistanceKm/actualDurationMin are supplied by the driver client (haversine
// pickup→current * 1.3 fudge factor), same trust contract as verifyEndOTP's
// optional params for normal completion — not recomputed server-side.
export async function endRideEarlyAsDriver(
  driverId: bigint,
  rideId: bigint,
  reasonCode: string,
  actualDistanceKm: number,
  actualDurationMin: number,
) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!ride.driver_id || BigInt(ride.driver_id) !== driverId) {
    throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  }
  if (ride.status !== 'in_progress' && ride.status !== 'returning') {
    throw Object.assign(new Error('Ride is not in progress'), { httpStatus: 409 })
  }

  const snapRes = await pool.query<{
    surge_multiplier: string
    stop_fare: string
    is_return_cab: boolean
    rate_per_km: string
    rate_per_min: string
    min_fare: string
    return_rate_per_km: string | null
    total_estimated: string
  }>(
    `SELECT fs.surge_multiplier, fs.stop_fare, fs.is_return_cab,
            rc.rate_per_km, rc.rate_per_min, rc.min_fare, rc.return_rate_per_km,
            fs.total_estimated
     FROM fare_snapshots fs
     JOIN rate_cards rc ON rc.id = fs.rate_card_id
     WHERE fs.ride_id = $1`,
    [rideId]
  )
  const snap = snapRes.rows[0]

  let finalFare: number | null = null
  if (snap) {
    const recalc = calculateFare({
      rate_card: {
        rate_per_km:        parseFloat(snap.rate_per_km),
        rate_per_min:       parseFloat(snap.rate_per_min),
        min_fare:           parseFloat(snap.min_fare),
        return_rate_per_km: snap.return_rate_per_km != null ? parseFloat(snap.return_rate_per_km) : null,
      },
      ride_type:        'one_way', // no hour_surcharge on an aborted trip
      is_return_cab:    snap.is_return_cab,
      estimated_km:     actualDistanceKm,
      estimated_min:    actualDurationMin,
      stop_count:       0, // stop fares for reached stops are already baked into snap.stop_fare
      charge_per_stop:  0,
      trip_hours:       0,
      surge_multiplier: parseFloat(snap.surge_multiplier),
    })
    const stopFare = parseFloat(snap.stop_fare ?? '0')
    finalFare = Math.round((recalc.total + stopFare) * 100) / 100

    // Never charge more for an early-ended trip than the full originally-quoted
    // trip would have cost — closes the client-supplied-distance overcharge exploit
    // regardless of what actualDistanceKm/actualDurationMin the driver app sends.
    const totalEstimated = parseFloat(snap.total_estimated)
    finalFare = Math.min(finalFare, totalEstimated)

    await pool.query(
      `UPDATE fare_snapshots
       SET actual_km = $2, actual_min = $3, total_final = $4,
           status = 'final', finalised_at = now()
       WHERE ride_id = $1`,
      [rideId, actualDistanceKm, actualDurationMin, finalFare]
    )
  }

  const completedAt = new Date().toISOString()
  const updated = await repo.updateRideStatusCAS(rideId, ride.status, 'completed', {
    completed_at:      completedAt,
    review_flagged_at: completedAt,
    review_reason:     `Ended early by driver: ${reasonCode}`,
  })
  if (!updated) {
    throw Object.assign(new Error('Ride already ended'), { httpStatus: 409 })
  }
  await repo.logStatusHistory({
    rideId, fromStatus: ride.status, toStatus: 'completed', actor: 'driver',
  })

  void callMasking.releaseForRide(rideId).catch((err: unknown) => {
    log.error({ err, rideId }, 'call-masking release failed')
  })

  await pool.query(
    `UPDATE driver_sessions SET status = 'online', trips_completed = trips_completed + 1
     WHERE driver_id = $1 AND status = 'on_trip'`,
    [driverId]
  )
  await pool.query(
    `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
    [driverId]
  )

  const statusPayload: Record<string, unknown> = { status: 'completed', completedAt, endedEarly: true }
  if (finalFare !== null) statusPayload['finalFare'] = finalFare
  socketEvents.sendRideStatusUpdate(rideId.toString(), statusPayload)

  void settleRideCompletionPayment(rideId, driverId).catch((err: unknown) => {
    log.error({ err, rideId }, 'payment post-processing failed for early-ended ride')
  })

  return { success: true, rideId: rideId.toString(), ...(finalFare !== null ? { finalFare } : {}) }
}

// ── Stuck ride resolution (sweeper timeout + admin override) ──

export async function forceResolveRide(
  rideId: bigint,
  outcome: 'completed' | 'cancelled',
  actor: 'admin' | 'timeout',
  note?: string,
  actorId?: bigint,
) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (ride.status !== 'in_progress' && ride.status !== 'returning') {
    throw Object.assign(new Error('Ride is not in progress'), { httpStatus: 409 })
  }

  const timestampField = outcome === 'completed' ? 'completed_at' : 'cancelled_at'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const upd = await client.query(
      `UPDATE rides SET status = $2, ${timestampField} = now(), review_flagged_at = NULL, updated_at = now()
       WHERE id = $1 AND status = $3`,
      [rideId, outcome, ride.status]
    )
    if ((upd.rowCount ?? 0) === 0) {
      throw Object.assign(new Error('Ride status changed — please refresh'), { httpStatus: 409 })
    }

    await client.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, actor_id, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [rideId, ride.status, outcome, actor, actorId ?? null, note ?? null]
    )

    if (ride.driver_id) {
      const tripsIncrement = outcome === 'completed' ? ', trips_completed = trips_completed + 1' : ''
      await client.query(
        `UPDATE driver_sessions SET status = 'online'${tripsIncrement}
         WHERE driver_id = $1 AND status = 'on_trip'`,
        [BigInt(ride.driver_id)]
      )
      await client.query(
        `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
        [BigInt(ride.driver_id)]
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  void callMasking.releaseForRide(rideId).catch((err: unknown) => {
    log.error({ err, rideId }, 'call-masking release failed')
  })

  socketEvents.sendRideStatusUpdate(rideId.toString(), { status: outcome, resolvedBy: actor })
  return { success: true }
}

// ── Admin manual driver assignment ──────────────────────────────

export async function getRideAssignCandidates(rideId: bigint) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!ride.origin_city_id) {
    throw Object.assign(new Error('Ride has no origin city'), { httpStatus: 409 })
  }

  const categoryIds = await repo.getEligibleDriverCategoryIds(ride.category_id)
  const minWalletBalance = await getMinWalletBalance()

  return repo.getAssignCandidates({
    cityId: ride.origin_city_id,
    rideLat: ride.origin_lat,
    rideLng: ride.origin_lng,
    categoryIds,
    minWalletBalance,
  })
}

export async function adminAssignDriver(
  rideId: bigint,
  driverId: bigint,
  mode: 'request' | 'force',
  overrideEligibility: boolean,
  adminId: bigint,
): Promise<{ success: true; mode: 'request' | 'force' }> {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!['scheduled', 'requested', 'no_drivers'].includes(ride.status)) {
    throw Object.assign(new Error('Ride is not open for assignment'), { httpStatus: 409 })
  }

  const candidates = await getRideAssignCandidates(rideId)
  const candidate = candidates.find(c => c.driver_id === driverId.toString())
  if (!candidate) throw Object.assign(new Error('Driver not found in this city'), { httpStatus: 404 })

  // is_online is a hard gate — there is nowhere to route the assignment
  // without an active session — never bypassable by overrideEligibility.
  if (!candidate.is_online) {
    throw Object.assign(new Error('Driver must be online to be assigned'), { httpStatus: 422 })
  }
  if (!candidate.eligible && !overrideEligibility) {
    throw Object.assign(new Error('Driver is not eligible — pass overrideEligibility to force'), { httpStatus: 422 })
  }

  let workingRide = ride
  if (ride.status !== 'requested') {
    const updated = await repo.updateRideStatusCAS(rideId, ride.status, 'requested')
    if (!updated) throw Object.assign(new Error('Ride status changed — please refresh'), { httpStatus: 409 })
    workingRide = updated
    await repo.logStatusHistory({
      rideId, fromStatus: ride.status, toStatus: 'requested',
      actor: 'admin', actorId: adminId, note: 'Opened for manual assignment',
    })
  }

  const cancelledDriverIds = await repo.cancelAllAssignments(rideId)
  for (const id of cancelledDriverIds) socketEvents.sendRequestExpired(id, rideId.toString())

  const sessionId = BigInt(candidate.session_id!)
  const billingMode = await repo.getCityBillingMode(workingRide.origin_city_id!)

  if (mode === 'force') {
    await repo.createRideAssignment({ rideId, driverId, sessionId, expiresAt: new Date(), broadcastRound: 0 })

    const cancelledOnAccept = await repo.acceptAssignment(rideId, driverId, billingMode)
    if (cancelledOnAccept === false) {
      throw Object.assign(new Error('Ride was accepted by another driver — please refresh'), { httpStatus: 409 })
    }
    for (const id of cancelledOnAccept) socketEvents.sendRequestExpired(id, rideId.toString())

    const graceMs = FORCE_ASSIGN_GRACE_MINUTES * 60_000
    const job = await queues[QUEUE_NAMES.DISPATCH].add(
      'force_assign_grace_check',
      { rideId: rideId.toString(), driverId: driverId.toString() },
      { delay: graceMs, attempts: 1, removeOnComplete: true }
    )
    if (job.id) await repo.setForceAssignGraceJob(rideId, job.id)

    await repo.logStatusHistory({
      rideId, fromStatus: 'requested', toStatus: 'accepted',
      actor: 'admin', actorId: adminId, note: `Force-assigned to driver ${driverId}`,
    })

    socketEvents.sendDriverAssigned(rideId.toString(), { rideId: rideId.toString(), driverId: driverId.toString() })
    await notifyOwner({
      ownerType: 'driver', ownerId: driverId, type: 'ride_force_assigned',
      title: 'You have a new ride', body: 'An admin has assigned you a ride — check your active ride screen.',
      rideId, tag: `ride-${rideId}`,
    })
    return { success: true, mode: 'force' }
  }

  const timeoutSeconds = MANUAL_ASSIGN_REQUEST_TIMEOUT_SECONDS
  const expiresAt = new Date(Date.now() + timeoutSeconds * 1000)
  await repo.createRideAssignment({ rideId, driverId, sessionId, expiresAt, broadcastRound: 0 })
  await redis.set(rideAckKey(rideId.toString(), driverId.toString()), '1', 'EX', timeoutSeconds + 30)

  socketEvents.sendRideRequest(driverId.toString(), {
    rideId: rideId.toString(),
    pickup: workingRide.origin_address ?? 'Pickup location',
    drop: workingRide.destination_address ?? 'Destination',
    pickupLat: workingRide.origin_lat,
    pickupLng: workingRide.origin_lng,
    distanceToPickup: Math.round(candidate.distance_metres ?? 0),
    estimatedFare: workingRide.total_estimated != null ? parseFloat(workingRide.total_estimated) : 0,
    rideType: workingRide.ride_type,
    isReturnCab: workingRide.is_return_cab,
    expiresAt: expiresAt.toISOString(),
    timeoutSeconds,
    assignedByOps: true,
  })

  // Fallback: processBroadcast() already no-ops when the ride is no longer
  // 'requested', so firing this unconditionally is safe — it only actually
  // rebroadcasts if the manual offer above was declined/timed out.
  await queues[QUEUE_NAMES.DISPATCH].add(
    'broadcast_ride',
    {
      rideId: rideId.toString(),
      categoryId: workingRide.category_id.toString(),
      originLat: workingRide.origin_lat,
      originLng: workingRide.origin_lng,
      rideType: workingRide.ride_type,
      isReturnCab: workingRide.is_return_cab,
      broadcastRound: 1,
    },
    { delay: (timeoutSeconds + 2) * 1000, attempts: 1, removeOnComplete: true }
  )

  await repo.logStatusHistory({
    rideId, fromStatus: workingRide.status, toStatus: workingRide.status,
    actor: 'admin', actorId: adminId, note: `Manually offered to driver ${driverId}, awaiting response`,
  })
  await notifyOwner({
    ownerType: 'driver', ownerId: driverId, type: 'ride_manual_request',
    title: 'Ride assigned to you', body: 'An admin has selected you for a ride — respond within 30s.',
    rideId, tag: `ride-${rideId}`,
  })

  return { success: true, mode: 'request' }
}

export async function forceAssignGraceCheck(rideId: bigint, driverId: bigint): Promise<void> {
  const hasActivity = await repo.hasRideGpsActivity(rideId)
  if (hasActivity) {
    await repo.clearForceAssignGraceJob(rideId)
    return
  }

  const ride = await repo.getRideById(rideId)
  if (!ride || ride.status !== 'accepted' || ride.driver_id !== driverId) return

  const reverted = await repo.revertForceAssign(rideId, driverId)
  if (!reverted) return

  await repo.logStatusHistory({
    rideId, fromStatus: 'accepted', toStatus: 'requested', actor: 'system',
    note: `Force-assigned driver ${driverId} showed no activity within the grace period — reverted to unassigned`,
  })

  await notifyAllAdmins({
    type: 'force_assign_reverted',
    title: 'Force-assigned ride reverted',
    body: `Ride #${rideId} was force-assigned but the driver never responded — it's unassigned again.`,
    rideId,
  })

  await queues[QUEUE_NAMES.DISPATCH].add(
    'broadcast_ride',
    {
      rideId: rideId.toString(),
      categoryId: ride.category_id.toString(),
      originLat: ride.origin_lat,
      originLng: ride.origin_lng,
      rideType: ride.ride_type,
      isReturnCab: ride.is_return_cab,
      broadcastRound: 1,
    },
    { delay: 0, attempts: 2, removeOnComplete: true }
  )
}

// ── Orphaned-ride sweep (cleanup worker) ────────────────────────

export async function expireStaleRequestedRide(rideId: bigint) {
  await repo.updateRideStatus(rideId, 'no_drivers')
  await repo.logStatusHistory({
    rideId,
    fromStatus: 'requested',
    toStatus:   'no_drivers',
    actor:      'system',
    note:       'auto-expired: no broadcast resolution',
  })
  socketEvents.sendRideStatusUpdate(rideId.toString(), { status: 'no_drivers' })
}

export async function expireStaleAcceptedOrArrivedRide(
  rideId: bigint,
  status: 'accepted' | 'driver_arrived',
  driverId: bigint,
) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const upd = await client.query(
      `UPDATE rides SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1 AND status = $2`,
      [rideId, status]
    )
    if ((upd.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK')
      return // already resolved by someone else — no-op
    }

    await client.query(
      `INSERT INTO ride_cancellations
         (ride_id, actor, stage, reason_code, fee_applicable, fee_amount, fee_waived)
       VALUES ($1, 'system', $2, 'auto_timeout', false, 0, false)`,
      [rideId, cancelStageFor(status)]
    )

    await client.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, note)
       VALUES ($1, $2, 'cancelled', 'timeout', 'auto-cancelled: abandoned before in_progress')`,
      [rideId, status]
    )

    await client.query(
      `UPDATE driver_sessions SET status = 'online'
       WHERE driver_id = $1 AND status = 'on_trip'`,
      [driverId]
    )
    await client.query(
      `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
      [driverId]
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  void callMasking.releaseForRide(rideId).catch((err: unknown) => {
    log.error({ err, rideId }, 'call-masking release failed')
  })

  socketEvents.sendRideStatusUpdate(rideId.toString(), { status: 'cancelled', cancelledBy: 'system' })
}

export async function verifyEndOTP(
  driverId: bigint,
  rideId: bigint,
  otp: string,
  actualDistanceKm?: number,
  actualDurationMin?: number,
  actualEndLat?: number,
  actualEndLng?: number
) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  if (ride.status !== 'in_progress' && ride.status !== 'returning') {
    throw httpError(409, 'Ride not in progress', 'RIDE_NOT_IN_PROGRESS')
  }

  const stops = await repo.getRideStops(rideId)
  if (stops.some(s => s.status === 'pending')) {
    throw httpError(409, 'Ride has pending stops', 'RIDE_HAS_PENDING_STOPS')
  }

  const valid = ride.end_otp_hash != null && hashOtp(otp) === ride.end_otp_hash

  await pool.query(
    `INSERT INTO ride_otp_events
       (ride_id, otp_type, event, actor_role, attempt_number)
     VALUES ($1,'trip_end',$2,'driver',1)`,
    [rideId, valid ? 'verified' : 'failed']
  )

  if (!valid) throw httpError(422, 'Invalid OTP', 'INVALID_OTP')

  await redis.del(endOtpKey(rideId.toString()))

  const completedAt = new Date().toISOString()

  // GPS-breadcrumb-derived distance/duration for round_trip fare reconciliation
  // (see calculateFare call below) — falls back to the client-reported values
  // when there isn't enough GPS data (see getGpsTrackedDistanceKm).
  const gpsDistanceKm = ride.ride_type === 'round_trip' && ride.started_at != null
    ? await repo.getGpsTrackedDistanceKm(rideId, new Date(ride.started_at))
    : null
  const gpsDurationMin = ride.started_at != null
    ? (new Date(completedAt).getTime() - new Date(ride.started_at).getTime()) / 60000
    : null

  await repo.updateRideStatus(rideId, 'completed', {
    completed_at:        completedAt,
    actual_distance_km:  actualDistanceKm  ?? null,
    actual_duration_min: actualDurationMin ?? null,
    review_flagged_at:   null,
    review_reason:       null,
  })

  await repo.logStatusHistory({
    rideId,
    fromStatus: ride.status,
    toStatus:   'completed',
    actor:      'ride_completion',
  })

  void callMasking.releaseForRide(rideId).catch((err: unknown) => {
    log.error({ err, rideId }, 'call-masking release failed')
  })

  let finalFare: number | null = null

  if (actualDistanceKm != null && actualDurationMin != null) {
    let totalFinal: number | null = null
    let earlyTermKm:  number | null = null
    let earlyTermMin: number | null = null
    let billedKm  = actualDistanceKm
    let billedMin = actualDurationMin

    // Round trip: reconcile against ACTUAL km/duration, not just the estimate.
    // Two cases:
    //   - Driver ended >500m from origin → the return leg wasn't actually
    //     driven; treat it as an early termination (existing logic below,
    //     unchanged: bills what was driven + a straight-line estimate of the
    //     remaining return distance, at one_way rates, no driver allowance).
    //   - Otherwise (normal completion, or no end-coordinates supplied) →
    //     recalculate with the real round_trip package formula against
    //     actualDistanceKm/actualDurationMin, so overage km and extra days
    //     actually get billed instead of silently falling back to the estimate.
    if (ride.ride_type === 'round_trip') {
      let metres = 0
      let hasEndCoords = false
      if (actualEndLat != null && actualEndLng != null) {
        hasEndCoords = true
        const distRes = await pool.query<{ metres: string }>(
          `SELECT ST_Distance(
             ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
             ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326)::geography
           ) AS metres`,
          [actualEndLng, actualEndLat, ride.origin_lng, ride.origin_lat]
        )
        metres = parseFloat(distRes.rows[0]?.metres ?? '0')
      }

      const isEarlyTermination = hasEndCoords && metres > 500

      const snapRes = await pool.query<{
        surge_multiplier: string
        stop_fare:        string
        is_return_cab:    boolean
        rate_per_km:      string
        rate_per_min:      string
        min_fare:          string
        return_rate_per_km: string | null
        km_per_day:               string | null
        driver_allowance_per_day: string | null
      }>(
        `SELECT fs.surge_multiplier, fs.stop_fare, fs.is_return_cab,
                rc.rate_per_km, rc.rate_per_min, rc.min_fare, rc.return_rate_per_km,
                rc.km_per_day, rc.driver_allowance_per_day
         FROM fare_snapshots fs
         JOIN rate_cards rc ON rc.id = fs.rate_card_id
         WHERE fs.ride_id = $1`,
        [rideId]
      )
      const snap = snapRes.rows[0]

      if (snap && isEarlyTermination) {
        const returnKm  = metres / 1000
        const returnMin = returnKm / 0.5  // assume 30 km/h for return leg

        // Use PostGIS distance as the driven km — actualDistanceKm points at the
        // booked destination, not the actual early-stop location, so it would overcharge.
        const drivenKm = metres / 1000
        billedKm  = drivenKm + returnKm
        billedMin = actualDurationMin + returnMin

        const recalc = calculateFare({
          rate_card: {
            rate_per_km:         parseFloat(snap.rate_per_km),
            rate_per_min:        parseFloat(snap.rate_per_min),
            min_fare:            parseFloat(snap.min_fare),
            return_rate_per_km:  snap.return_rate_per_km != null ? parseFloat(snap.return_rate_per_km) : null,
          },
          ride_type:        'one_way',  // no driver allowance on early termination
          is_return_cab:    snap.is_return_cab,
          estimated_km:     billedKm,
          estimated_min:    billedMin,
          stop_count:       0,
          charge_per_stop:  0,
          trip_hours:       0,
          surge_multiplier: parseFloat(snap.surge_multiplier),
        })

        // Stops were already driven — add the pre-computed stop_fare unchanged
        const stopFare = parseFloat(snap.stop_fare ?? '0')
        totalFinal     = Math.round((recalc.total + stopFare) * 100) / 100
        earlyTermKm    = Math.round(returnKm  * 100) / 100
        earlyTermMin   = Math.round(returnMin * 100) / 100
      } else if (snap) {
        // Normal completion: recalculate the real round_trip package fare
        // against what was actually driven, instead of defaulting to the
        // booking-time estimate.
        const recalc = calculateFare({
          rate_card: {
            rate_per_km:  parseFloat(snap.rate_per_km),
            rate_per_min: parseFloat(snap.rate_per_min),
            min_fare:     parseFloat(snap.min_fare),
            return_rate_per_km:       snap.return_rate_per_km != null ? parseFloat(snap.return_rate_per_km) : null,
            km_per_day:               snap.km_per_day != null ? parseFloat(snap.km_per_day) : null,
            driver_allowance_per_day: snap.driver_allowance_per_day != null ? parseFloat(snap.driver_allowance_per_day) : null,
          },
          ride_type:        'round_trip',
          is_return_cab:    snap.is_return_cab,
          // Prefer GPS-breadcrumb-derived distance/duration over the
          // client-reported values — the driver app currently sends a
          // one-way straight-line estimate to the destination, not the
          // actual round-trip distance driven, so trusting it directly
          // would keep the same under-billing bug this branch exists to fix.
          estimated_km:     gpsDistanceKm ?? actualDistanceKm,
          estimated_min:    gpsDurationMin ?? actualDurationMin,
          stop_count:       0, // stop fares already baked into snap.stop_fare
          charge_per_stop:  0,
          trip_hours:       (gpsDurationMin ?? actualDurationMin) / 60,
          surge_multiplier: parseFloat(snap.surge_multiplier),
        })

        const stopFare = parseFloat(snap.stop_fare ?? '0')
        totalFinal = Math.round((recalc.total + stopFare) * 100) / 100
        // Keep the stored actual_km/actual_min consistent with whatever was
        // actually used to compute the fare above.
        billedKm  = gpsDistanceKm  ?? actualDistanceKm
        billedMin = gpsDurationMin ?? actualDurationMin

        // Flag for ops review: GPS breadcrumb data was insufficient, so this
        // fare had to fall back to the unreliable client-reported distance.
        if (gpsDistanceKm == null) {
          await repo.flagRideForReview(
            rideId,
            'Round-trip fare reconciled against client-reported distance — GPS breadcrumb data unavailable'
          )
        }
      }
    }

    await pool.query(
      `UPDATE fare_snapshots
       SET actual_km               = $2,
           actual_min              = $3,
           total_final             = COALESCE($4::numeric, total_estimated),
           early_termination_km    = $5,
           early_termination_min   = $6,
           status                  = 'final',
           finalised_at            = now()
       WHERE ride_id = $1`,
      [rideId, billedKm, billedMin, totalFinal, earlyTermKm, earlyTermMin]
    )

    finalFare = totalFinal
  }

  // One-way: fold metered stop-wait charges into the final fare. Each stop's
  // wait_charge was computed live from server timestamps at resume time (see
  // markStopStatus). One-way total_final always equals total_estimated before
  // wait (early-termination recompute is round-trip-only), so we RECOMPUTE from
  // total_estimated rather than add to total_final — that makes a replayed or
  // concurrent settlement idempotent (never double-charges). No-op for round-
  // trip/rental, whose stops never accrue wait_charge (wait is in the hours pkg).
  if (ride.ride_type === 'one_way') {
    const waitTotal = await repo.getStopWaitTotal(rideId)
    if (waitTotal > 0) {
      const upd = await pool.query<{ total_final: string }>(
        `UPDATE fare_snapshots
         SET total_final  = round(total_estimated + $2::numeric, 2),
             status       = 'final',
             finalised_at = now()
         WHERE ride_id = $1
         RETURNING total_final`,
        [rideId, waitTotal]
      )
      if (upd.rows[0]) finalFare = parseFloat(upd.rows[0].total_final)
    }
  }

  await pool.query(
    `UPDATE driver_sessions
     SET status = 'online',
         trips_completed = trips_completed + 1
     WHERE driver_id = $1 AND status = 'on_trip'`,
    [driverId]
  )

  await pool.query(
    `UPDATE driver_location_snapshots
     SET is_available = true
     WHERE driver_id = $1`,
    [driverId]
  )

  const statusPayload: Record<string, unknown> = { status: 'completed', completedAt }
  if (finalFare !== null) statusPayload['finalFare'] = finalFare

  socketEvents.sendRideStatusUpdate(rideId.toString(), statusPayload)

  if (ride.user_phone) {
    void queues[QUEUE_NAMES.NOTIFICATIONS].add('ride_completed', {
      rideId:     rideId.toString(),
      userId:     ride.user_id.toString(),
      userPhone:  ride.user_phone,
      driverName: ride.driver_name ?? null,
    }, { attempts: 2, removeOnComplete: 50, removeOnFail: 20 }).catch(() => {})
  }

  // Payment + wallet post-processing (non-blocking — ride is already completed)
  void settleRideCompletionPayment(rideId, driverId).catch((err: unknown) => {
    log.error({ err, rideId }, 'payment post-processing failed for ride')
  })

  return {
    success: true,
    rideId: rideId.toString(),
    ...(finalFare !== null ? { finalFare } : {}),
  }
}

// Extracted from verifyEndOTP so the wallet-insufficient failure path is unit
// testable. Behavior-preserving move of the completion payment post-processing,
// plus a proactive notifyRidePaymentFailed when the wallet debit can't cover the
// fare (payment stays 'pending'; the receipt offers retry).
export async function settleRideCompletionPayment(
  rideId: bigint,
  driverId: bigint
): Promise<void> {
  const rideData = await repo.getRideById(rideId)
  const paymentChannel = rideData?.payment_channel ?? 'cash'

  const fareRow = await pool.query(
    `SELECT COALESCE(total_final, total_estimated) AS amount
     FROM fare_snapshots WHERE ride_id = $1`,
    [rideId]
  )
  const fareAmount = parseFloat(fareRow.rows[0]?.amount ?? '0')

  if (paymentChannel === 'online') {
    await createPaymentRecord(rideId, 'razorpay_online', { status: 'pending' })
    if (rideData?.user_id == null || fareAmount <= 0) return
    const order = await createRidePaymentOrder(rideId, BigInt(rideData.user_id), fareAmount)
    // order is null in dev (auto-confirmed); with keys, push order id so the
    // app opens Checkout. Commission + cashback run only on confirm.
    if (order) {
      socketEvents.sendRideStatusUpdate(rideId.toString(), {
        status:          'completed',
        paymentChannel:  'online',
        razorpayOrderId: order.orderId,
        razorpayKey:     order.key,
        amount:          order.amount,
      })
    }
    return
  }

  if (paymentChannel === 'wallet') {
    await createPaymentRecord(rideId, 'platform_wallet', { status: 'pending' })
    if (rideData?.user_id == null || fareAmount <= 0) return
    const paid = await payFromUserWallet(rideId, BigInt(rideData.user_id), fareAmount)
    if (paid) {
      await confirmRidePayment(rideId)
    } else {
      // Insufficient balance → payment stays pending. Tell the rider now so they
      // can top up + retry from the receipt (no sweep needed for wallet).
      await notifyRidePaymentFailed(BigInt(rideData.user_id), rideId, fareAmount)
    }
    return
  }

  // cash (default) — settlement now happens on explicit driver confirmation
  // (POST /rides/:id/collect-cash). Kill switch reverts to legacy auto-settle.
  const cashCollectionEnabled = (await getConfigValue('cash_collection_enabled', 'true')) === 'true'
  if (cashCollectionEnabled) {
    // Tell the driver app to show the cash-collection screen.
    socketEvents.sendRideStatusUpdate(rideId.toString(), {
      status:              'completed',
      paymentChannel:      'cash',
      needsCashCollection: true,
      amount:              fareAmount,
    })
    return
  }
  await createPaymentRecord(rideId, 'cash_direct')
  if (rideData?.billing_mode_snapshot === 'package') {
    await consumePackageBalance(rideId, driverId, fareAmount)
  } else {
    await deductCommission(rideId, driverId)
  }
  // Stamp the same claim collectCash uses, so a client still on the
  // cash-collection screen (kill switch flipped after it loaded) sees
  // cash_collected_at already set and no-ops instead of double-settling.
  await pool.query(
    `UPDATE rides
       SET cash_collected_amount = $2, cash_collected_at = now(),
           cash_discrepancy = false, cash_collection_note = NULL
     WHERE id = $1 AND cash_collected_at IS NULL`,
    [rideId, fareAmount]
  )
  if (rideData?.user_id == null || fareAmount <= 0) return
  await creditCashback(rideId, BigInt(rideData.user_id), fareAmount)
}

// Explicit driver confirmation that cash was collected. Idempotent (cash_collected_at
// guard + createPaymentRecord's ON CONFLICT(ride_id)). Commission always accrues on the
// *fare* (driver owes on what they earned) so short/no collection still owes the platform;
// a collected amount off from the fare beyond tolerance flags the ride for ops but never blocks.
export async function collectCash(
  driverId: bigint,
  rideId: bigint,
  input: { collectedAmount?: number; notCollected?: boolean; note?: string }
): Promise<{ collected: number; discrepancy: boolean }> {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  if (String(ride.driver_id) !== String(driverId)) throw httpError(403, 'Not your ride', 'FORBIDDEN')
  if (ride.status !== 'completed') throw httpError(409, 'Ride is not completed', 'RIDE_NOT_COMPLETED')
  if ((ride.payment_channel ?? 'cash') !== 'cash') throw httpError(409, 'Ride is not a cash ride', 'NOT_CASH_RIDE')
  if (ride.cash_collected_at) return { collected: parseFloat(ride.cash_collected_amount ?? '0'), discrepancy: ride.cash_discrepancy }

  const fareRow = await pool.query(
    `SELECT COALESCE(total_final, total_estimated) AS amount FROM fare_snapshots WHERE ride_id = $1`,
    [rideId]
  )
  const fare = parseFloat(fareRow.rows[0]?.amount ?? '0')
  const collected = input.notCollected ? 0 : (input.collectedAmount ?? fare)
  const tolerance = parseFloat(await getConfigValue('cash_collection_tolerance', '1'))
  const discrepancy = input.notCollected === true || Math.abs(collected - fare) > tolerance

  // Atomic claim: only the caller that flips cash_collected_at from NULL wins and
  // settles. Guards the TOCTOU race (driver double-tap / SwipeToConfirm auto-retry /
  // network retry) — the read-time early-exit above is just a fast-path, this is the
  // real guard. deductCommission/creditCashback are NOT idempotent, so a loser must not
  // reach them.
  const claim = await pool.query(
    `UPDATE rides
       SET cash_collected_amount = $2, cash_collected_at = now(),
           cash_discrepancy = $3, cash_collection_note = $4
     WHERE id = $1 AND cash_collected_at IS NULL`,
    [rideId, collected, discrepancy, input.note ?? null]
  )
  if (claim.rowCount === 0) {
    const fresh = await repo.getRideById(rideId)
    return {
      collected:   parseFloat(fresh?.cash_collected_amount ?? '0'),
      discrepancy: fresh?.cash_discrepancy ?? false,
    }
  }

  // Settle: commission on the fare (not the collected amount) so short/no collection
  // still owes the platform. createPaymentRecord is ON CONFLICT DO NOTHING = idempotent.
  // ponytail: settlement helpers aren't in one txn; a mid-settlement crash won't auto-retry
  // (matches legacy settleRideCompletionPayment). Reconciliation is future work.
  await createPaymentRecord(rideId, 'cash_direct')
  if (ride.billing_mode_snapshot === 'package') {
    await consumePackageBalance(rideId, driverId, fare)
  } else {
    await deductCommission(rideId, driverId)
  }
  if (ride.user_id != null && fare > 0) await creditCashback(rideId, BigInt(ride.user_id), fare)

  if (discrepancy) {
    // Best-effort ops alert; the cash_discrepancy flag on the ride is the source of truth.
    await notifyAllAdmins({
      type:  'cash_discrepancy',
      title: 'Cash discrepancy',
      body:  `Ride #${rideId}: fare Rs.${fare}, driver logged Rs.${collected}${input.notCollected ? ' (not collected)' : ''}.`,
      payload: { rideId: rideId.toString(), fare, collected },
      rideId,
    }).catch(() => {})
  }

  return { collected, discrepancy }
}
