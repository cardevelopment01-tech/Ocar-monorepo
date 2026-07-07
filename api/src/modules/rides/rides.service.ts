import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { startOtpKey, endOtpKey } from '@/constants/redis-keys'
import { getPresignedUrl } from '@/lib/storage'
import * as repo from './rides.repository'
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
} from '@/constants/limits'
import type { BroadcastJobData } from '@/jobs/processors/broadcast.processor'
import type { BookingRequest } from './rides.types'
import {
  createPaymentRecord,
  deductCommission,
  creditCashback,
} from '@/modules/payments/payments.service'
import { calculateFare } from '@/lib/fare'
import { classifyTrip } from '@/modules/geo/geo.service'

// ── Driver session management ─────────────────────────────────

export async function goOnline(driverId: bigint, data: {
  mode: 'standard' | 'return_cab'
  vehicleId: bigint
  categoryId: bigint
  lat: number
  lng: number
  destinationCityId?: bigint
}) {
  const existing = await repo.getActiveSession(driverId)
  if (existing) {
    if (existing.status === 'on_trip') {
      throw Object.assign(new Error('Driver has an active ride in progress'), { httpStatus: 409 })
    }
    await repo.endSession(BigInt(existing.id), 'reconnected')
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
           (session_id, driver_id,
            origin_lat, origin_lng,
            destination_lat, destination_lng,
            corridor)
         VALUES ($1,$2,$3::float8,$4::float8,$5::float8,$6::float8,
           ST_MakeLine(
             ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326),
             ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)
           )::geography
         )`,
        [session.id, driverId, data.lat, data.lng, cityRow.dest_lat, cityRow.dest_lng]
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

  await pool.query(
    `UPDATE return_cab_routes
     SET is_active = false, deactivated_at = now(),
         deactivation_reason = 'session_ended'
     WHERE session_id = $1 AND is_active = true`,
    [session.id]
  )

  await pool.query(
    `UPDATE driver_location_snapshots
     SET is_available = false
     WHERE driver_id = $1`,
    [driverId]
  )

  return session
}

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

  // Emit live location to the user's tracking page
  const activeRideRes = await pool.query<{ id: string }>(
    `SELECT id::text FROM rides WHERE driver_id = $1 AND status IN ('accepted','driver_arrived','in_progress') LIMIT 1`,
    [driverId]
  )
  if (activeRideRes.rows[0]) {
    const rideId = activeRideRes.rows[0].id
    socketEvents.sendDriverLocation(rideId, {
      lat:        data.lat,
      lng:        data.lng,
      heading:    data.heading ?? 0,
      speed_kmph: data.speed ?? 0,
    })
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

// ── Ride booking ──────────────────────────────────────────────

export async function createBooking(userId: bigint, data: BookingRequest) {
  if (
    (data.rideType === 'one_way' || data.rideType === 'round_trip') &&
    data.destinationLat !== undefined &&
    data.destinationLng !== undefined
  ) {
    const classification = await classifyTrip(
      data.originLat, data.originLng, data.destinationLat, data.destinationLng
    )
    if (classification.scope === 'in_city') {
      throw Object.assign(
        new Error(`This trip stays within ${classification.cityName} — book it as a City Ride instead`),
        { httpStatus: 422 }
      )
    }
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

  // Enforce minimum 4h for round trips — must match pricing.service clamp so
  // fare_snapshots.trip_hours records the same value used to compute the fare.
  const effectiveTripHours = clampTripHours(data.rideType, data.tripHours)

  const fareReq: FareEstimateRequest = {
    category_id:  data.categoryId,
    ride_type:    data.rideType,
    is_return_cab: data.isReturnCab ?? false,
    distance_km:  data.distanceKm,
    duration_min: data.durationMin,
    stop_count:   data.stopCount ?? 0,
    trip_hours:   effectiveTripHours,
  }
  if (data.rentalPackageId !== undefined) fareReq.rental_package_id = data.rentalPackageId
  if (data.originCityId   !== undefined) fareReq.city_id            = data.originCityId
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
  if (data.originCityId       !== undefined) rideInput.originCityId       = BigInt(data.originCityId)
  if (data.destinationCityId  !== undefined) rideInput.destinationCityId  = BigInt(data.destinationCityId)
  if (data.rentalPackageId    !== undefined) rideInput.rentalPackageId    = BigInt(data.rentalPackageId)
  const storedTripHours = fareEstimate.rental_hours ?? (effectiveTripHours > 0 ? effectiveTripHours : undefined)
  if (storedTripHours !== undefined) rideInput.tripHours = storedTripHours
  if (data.returnAt           !== undefined) rideInput.returnAt           = data.returnAt
  if (scheduledForDate && data.scheduledFor !== undefined) {
    rideInput.scheduledFor = data.scheduledFor
    rideInput.status = 'scheduled'
  }
  const ride = await repo.createRide(rideInput)

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
      data.stopCount ?? 0,
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
    queues[QUEUE_NAMES.NOTIFICATIONS].add(
      'broadcast_ride',
      { ...jobData, broadcastRound: 1 },
      { delay: 0, attempts: 2, removeOnComplete: true }
    ),
    queues[QUEUE_NAMES.NOTIFICATIONS].add(
      'broadcast_ride',
      { ...jobData, broadcastRound: 2 },
      { delay: 25_000, attempts: 1, removeOnComplete: true }
    ),
    queues[QUEUE_NAMES.NOTIFICATIONS].add(
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
  const cancelledDriverIds = await repo.acceptAssignment(rideId, driverId)
  if (cancelledDriverIds === false) {
    throw Object.assign(new Error('Ride no longer available'), { httpStatus: 409 })
  }

  for (const id of cancelledDriverIds) {
    socketEvents.sendRequestExpired(id, rideId.toString())
  }

  const ride = await repo.getRideById(rideId)

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
    driverPhone:        ride?.driver_phone ?? null,
    driverRating:       ride?.driver_rating ?? null,
    driverPhoto:        driverPhoto,
    vehicleModel:       ride?.vehicle_model ?? null,
    vehicleBrand:       ride?.vehicle_brand ?? null,
    vehicleColor:       ride?.vehicle_color ?? null,
    vehicleName:        ride?.vehicle_name ?? null,
    vehicleNumberPlate: ride?.vehicle_number_plate ?? null,
  })

  if (ride?.user_phone) {
    void queues[QUEUE_NAMES.NOTIFICATIONS].add('ride_accepted', {
      rideId:      rideId.toString(),
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
    status:   'driver_arrived',
    startOtp: otp,
  })

  const ride = await repo.getRideById(rideId)
  if (ride?.user_phone) {
    await queues[QUEUE_NAMES.NOTIFICATIONS].add('otp_sms', {
      phone: ride.user_phone,
      otp,
      type: 'trip_start',
    })
  }

  return { success: true, startOtp: otp }
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
    endOtp,
  })

  if (ride.user_phone) {
    await queues[QUEUE_NAMES.NOTIFICATIONS].add('otp_sms', {
      phone: ride.user_phone,
      otp:   endOtp,
      type:  'trip_end',
    })
  }

  return { success: true, endOtp }
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

  socketEvents.sendRideStatusUpdate(rideId.toString(), {
    status: 'cancelled',
    cancelledBy: 'user',
    reasonCode: reasonCode ?? null,
  })
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

  socketEvents.sendRideStatusUpdate(rideId.toString(), {
    status: 'cancelled',
    cancelledBy: 'driver',
    reasonCode: reasonCode ?? null,
  })
  return { success: true }
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
  if (ride.status !== 'in_progress') {
    throw Object.assign(new Error('Ride is not in progress'), { httpStatus: 409 })
  }

  const timestampField = outcome === 'completed' ? 'completed_at' : 'cancelled_at'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const upd = await client.query(
      `UPDATE rides SET status = $2, ${timestampField} = now(), review_flagged_at = NULL, updated_at = now()
       WHERE id = $1 AND status = 'in_progress'`,
      [rideId, outcome]
    )
    if ((upd.rowCount ?? 0) === 0) {
      throw Object.assign(new Error('Ride status changed — please refresh'), { httpStatus: 409 })
    }

    await client.query(
      `INSERT INTO ride_status_history (ride_id, from_status, to_status, actor, actor_id, note)
       VALUES ($1, 'in_progress', $2, $3, $4, $5)`,
      [rideId, outcome, actor, actorId ?? null, note ?? null]
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

  socketEvents.sendRideStatusUpdate(rideId.toString(), { status: outcome, resolvedBy: actor })
  return { success: true }
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
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (ride.status !== 'in_progress') {
    throw Object.assign(new Error('Ride not in progress'), { httpStatus: 409 })
  }

  const valid = ride.end_otp_hash != null && hashOtp(otp) === ride.end_otp_hash

  await pool.query(
    `INSERT INTO ride_otp_events
       (ride_id, otp_type, event, actor_role, attempt_number)
     VALUES ($1,'trip_end',$2,'driver',1)`,
    [rideId, valid ? 'verified' : 'failed']
  )

  if (!valid) throw Object.assign(new Error('Invalid OTP'), { httpStatus: 422 })

  await redis.del(endOtpKey(rideId.toString()))

  const completedAt = new Date().toISOString()

  await repo.updateRideStatus(rideId, 'completed', {
    completed_at:        completedAt,
    actual_distance_km:  actualDistanceKm  ?? null,
    actual_duration_min: actualDurationMin ?? null,
    review_flagged_at:   null,
    review_reason:       null,
  })

  await repo.logStatusHistory({
    rideId,
    fromStatus: 'in_progress',
    toStatus:   'completed',
    actor:      'ride_completion',
  })

  let finalFare: number | null = null

  if (actualDistanceKm != null && actualDurationMin != null) {
    let totalFinal: number | null = null
    let earlyTermKm:  number | null = null
    let earlyTermMin: number | null = null
    let billedKm  = actualDistanceKm
    let billedMin = actualDurationMin

    // Early termination check: only for round_trip when we have end coordinates
    if (
      ride.ride_type === 'round_trip' &&
      actualEndLat != null && actualEndLng != null
    ) {
      const distRes = await pool.query<{ metres: string }>(
        `SELECT ST_Distance(
           ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
           ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326)::geography
         ) AS metres`,
        [actualEndLng, actualEndLat, ride.origin_lng, ride.origin_lat]
      )
      const metres = parseFloat(distRes.rows[0]?.metres ?? '0')

      if (metres > 500) {
        // Load fare snapshot + rate card for recalculation
        const snapRes = await pool.query<{
          surge_multiplier: string
          stop_fare:        string
          is_return_cab:    boolean
          rate_per_km:      string
          rate_per_min:     string
          min_fare:         string
          return_rate_per_km: string | null
        }>(
          `SELECT fs.surge_multiplier, fs.stop_fare, fs.is_return_cab,
                  rc.rate_per_km, rc.rate_per_min, rc.min_fare, rc.return_rate_per_km
           FROM fare_snapshots fs
           JOIN rate_cards rc ON rc.id = fs.rate_card_id
           WHERE fs.ride_id = $1`,
          [rideId]
        )
        const snap = snapRes.rows[0]

        if (snap) {
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
            ride_type:        'one_way',  // no hour_surcharge on early termination
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
      userPhone:  ride.user_phone,
      driverName: ride.driver_name ?? null,
    }, { attempts: 2, removeOnComplete: 50, removeOnFail: 20 }).catch(() => {})
  }

  // Payment + wallet post-processing (non-blocking — ride is already completed)
  const rideData = await repo.getRideById(rideId)
  void createPaymentRecord(rideId, 'cash_direct')
    .then(() => deductCommission(rideId, driverId))
    .then(async () => {
      if (rideData?.user_id == null) return
      const fareRes = await pool.query(
        `SELECT COALESCE(total_final, total_estimated) AS amount
         FROM fare_snapshots WHERE ride_id = $1`,
        [rideId]
      )
      const fareAmount = parseFloat(fareRes.rows[0]?.amount ?? '0')
      if (fareAmount > 0) {
        await creditCashback(rideId, BigInt(rideData.user_id), fareAmount)
      }
    })
    .catch((err: unknown) => {
      console.error(`Payment post-processing failed for ride ${rideId}:`, err)
    })

  return { success: true, rideId: rideId.toString() }
}
