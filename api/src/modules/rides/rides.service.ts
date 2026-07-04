import { pool } from '@/db/client'
import * as repo from './rides.repository'
import { getFareEstimate, clampTripHours } from '@/modules/pricing/pricing.service'
import type { FareEstimateRequest } from '@/modules/pricing/pricing.types'
import { queues, QUEUE_NAMES, gpsFlushQueue } from '@/jobs/queues'
import { socketEvents } from '@/websocket/socket.server'
import { generateOtp, hashOtp } from '@/lib/otp'
import type { BroadcastJobData } from '@/jobs/processors/broadcast.processor'
import type { BookingRequest } from './rides.types'
import {
  createPaymentRecord,
  deductCommission,
  creditCashback,
} from '@/modules/payments/payments.service'

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
      throw Object.assign(new Error('Driver has an active ride in progress'), { statusCode: 409 })
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
    throw Object.assign(new Error('Ride no longer available'), { statusCode: 409 })
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

  socketEvents.sendDriverAssigned(rideId.toString(), {
    rideId:      rideId.toString(),
    status:      'accepted',
    driverId:    driverId.toString(),
    driverName:  ride?.driver_name,
    driverPhone: ride?.driver_phone,
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
  const otp  = generateOtp()
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
  if (!ride) throw Object.assign(new Error('Ride not found'), { statusCode: 404 })
  if (ride.status !== 'driver_arrived') {
    throw Object.assign(new Error('Ride not in correct state'), { statusCode: 409 })
  }

  const valid = ride.start_otp_hash != null && hashOtp(otp) === ride.start_otp_hash

  await pool.query(
    `INSERT INTO ride_otp_events
       (ride_id, otp_type, event, actor_role, attempt_number)
     VALUES ($1,'trip_start',$2,'driver',1)`,
    [rideId, valid ? 'verified' : 'failed']
  )

  if (!valid) throw Object.assign(new Error('Invalid OTP'), { statusCode: 422 })

  const endOtp  = generateOtp()
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

const CANCELLABLE_BY_USER   = new Set(['requested', 'accepted', 'driver_arrived'])
const CANCELLABLE_BY_DRIVER = new Set(['accepted', 'driver_arrived'])

function cancelStageFor(status: string): string {
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
  if (!ride) throw Object.assign(new Error('Ride not found'), { statusCode: 404 })
  if (BigInt(ride.user_id) !== userId) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  if (!CANCELLABLE_BY_USER.has(ride.status)) {
    throw Object.assign(new Error('Ride cannot be cancelled at this stage'), { statusCode: 409 })
  }

  const stage = cancelStageFor(ride.status)
  const feeApplicable = stage !== 'before_acceptance'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const upd = await client.query(
      `UPDATE rides SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1 AND status = $2`,
      [rideId, ride.status]
    )
    if ((upd.rowCount ?? 0) === 0) {
      throw Object.assign(new Error('Ride status changed — please refresh'), { statusCode: 409 })
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
  if (!ride) throw Object.assign(new Error('Ride not found'), { statusCode: 404 })
  if (!ride.driver_id || BigInt(ride.driver_id) !== driverId) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
  }
  if (!CANCELLABLE_BY_DRIVER.has(ride.status)) {
    throw Object.assign(new Error('Ride cannot be cancelled at this stage'), { statusCode: 409 })
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
      throw Object.assign(new Error('Ride status changed — please refresh'), { statusCode: 409 })
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

// ── Demo helpers (non-production only) ───────────────────────

export async function demoForceComplete(rideId: bigint, userId: bigint) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { statusCode: 404 })
  if (BigInt(ride.user_id) !== userId) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })

  const completedAt = new Date().toISOString()
  await repo.updateRideStatus(rideId, 'completed', { completed_at: completedAt })
  await repo.logStatusHistory({
    rideId,
    fromStatus: ride.status,
    toStatus:   'completed',
    actor:      'system',
    note:       'demo force-complete',
  })

  if (ride.driver_id) {
    await pool.query(
      `UPDATE driver_sessions
       SET status = 'online', trips_completed = trips_completed + 1
       WHERE driver_id = $1 AND status IN ('online', 'on_trip')`,
      [BigInt(ride.driver_id)]
    )
    await pool.query(
      `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
      [BigInt(ride.driver_id)]
    )
  }

  socketEvents.sendRideStatusUpdate(rideId.toString(), { status: 'completed', completedAt })
  return { success: true }
}

export async function demoForceCancel(rideId: bigint, userId: bigint) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { statusCode: 404 })
  if (BigInt(ride.user_id) !== userId) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })

  await repo.updateRideStatus(rideId, 'cancelled')
  await repo.logStatusHistory({
    rideId,
    fromStatus: ride.status,
    toStatus:   'cancelled',
    actor:      'user',
    note:       'demo force-cancel',
  })

  if (ride.driver_id) {
    await pool.query(
      `UPDATE driver_sessions SET status = 'online'
       WHERE driver_id = $1 AND status IN ('online', 'on_trip')`,
      [BigInt(ride.driver_id)]
    )
    await pool.query(
      `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
      [BigInt(ride.driver_id)]
    )
  }

  socketEvents.sendRideStatusUpdate(rideId.toString(), { status: 'cancelled' })
  return { success: true }
}

export async function verifyEndOTP(
  driverId: bigint,
  rideId: bigint,
  otp: string,
  actualDistanceKm?: number,
  actualDurationMin?: number
) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { statusCode: 404 })
  if (ride.status !== 'in_progress') {
    throw Object.assign(new Error('Ride not in progress'), { statusCode: 409 })
  }

  const valid = ride.end_otp_hash != null && hashOtp(otp) === ride.end_otp_hash

  await pool.query(
    `INSERT INTO ride_otp_events
       (ride_id, otp_type, event, actor_role, attempt_number)
     VALUES ($1,'trip_end',$2,'driver',1)`,
    [rideId, valid ? 'verified' : 'failed']
  )

  if (!valid) throw Object.assign(new Error('Invalid OTP'), { statusCode: 422 })

  const completedAt = new Date().toISOString()

  await repo.updateRideStatus(rideId, 'completed', {
    completed_at:        completedAt,
    actual_distance_km:  actualDistanceKm  ?? null,
    actual_duration_min: actualDurationMin ?? null,
  })

  await repo.logStatusHistory({
    rideId,
    fromStatus: 'in_progress',
    toStatus:   'completed',
    actor:      'ride_completion',
  })

  if (actualDistanceKm != null && actualDurationMin != null) {
    await pool.query(
      `UPDATE fare_snapshots
       SET actual_km    = $2,
           actual_min   = $3,
           total_final  = total_estimated,
           status       = 'final',
           finalised_at = now()
       WHERE ride_id = $1`,
      [rideId, actualDistanceKm, actualDurationMin]
    )
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

  socketEvents.sendRideStatusUpdate(rideId.toString(), {
    status:      'completed',
    completedAt,
  })

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
