import { socketEvents } from '@/websocket/socket.server'
import * as repo from '@/modules/rides/rides.repository'
import { BROADCAST_WINDOW_SECONDS, BROADCAST_MAX_DRIVERS, BACKGROUND_ACCEPT_WINDOW_SECONDS } from '@/constants/limits'
import { rideAckKey } from '@/constants/redis-keys'
import { client as redis } from '@/db/redis'
import { queues, QUEUE_NAMES } from '@/jobs/queues'
import { getMinWalletBalance } from '@/modules/payments/payments.service'
import { sendRideRequestPushOnce } from '@/modules/notifications/notifications.service'
import type { AckCheckJobData } from './ack-check.processor'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'broadcast-processor' })

const MAX_DRIVERS = BROADCAST_MAX_DRIVERS

// Expanding search radius per round — generous for intercity context (Bhubaneswar city ~20km dia)
const ROUND_RADII: Record<number, number> = { 1: 5000, 2: 10000, 3: 20000 }

export interface BroadcastJobData {
  rideId: string
  categoryId: string
  originLat: number
  originLng: number
  rideType: string
  isReturnCab: boolean
  destinationLat?: number
  destinationLng?: number
  broadcastRound: number
  radiusMetres?: number
  returnAt?: string
  tripHours?: number
}

export async function processBroadcast(data: BroadcastJobData): Promise<void> {
  const rideId     = BigInt(data.rideId)
  const categoryId = BigInt(data.categoryId)

  const ride = await repo.getRideById(rideId)
  if (!ride || ride.status !== 'requested') {
    log.info({ rideId: data.rideId }, 'broadcast skipped: ride no longer active')
    return
  }

  const stops = await repo.getRideStops(rideId)
  const minWalletBalance = await getMinWalletBalance()

  // Round 1 stays exact-category only, so native-tier drivers get first crack
  // at their own tier's fare. Rounds 2+ widen to fallback-tier drivers
  // (category_fallback_rules) once the ride has gone unaccepted past round 1.
  const categoryIds = data.broadcastRound === 1
    ? [categoryId]
    : await repo.getEligibleDriverCategoryIds(categoryId)
  const categoryName = await repo.getCategoryDisplayName(categoryId)

  let drivers: Array<{
    driver_id: bigint
    session_id: bigint
    lat: number
    lng: number
    distance_metres: number
    // A driver whose tab backgrounded recently (findNearbyDrivers' grace-window
    // relaxation) rather than one with a live socket — gets an immediate push
    // instead of waiting on the socket emit + ack-check fallback, and a longer
    // per-assignment response window. Always false for return-cab matches,
    // which don't select is_available (unaffected by this feature).
    isBackgrounded: boolean
  }> = []

  if (data.isReturnCab && data.destinationLat != null && data.destinationLng != null) {
    const returnDrivers = await repo.findReturnCabDrivers({
      pickupLat: data.originLat,
      pickupLng: data.originLng,
      dropLat:   data.destinationLat,
      dropLng:   data.destinationLng,
      categoryIds,
      minWalletBalance,
    })
    drivers = returnDrivers.map(d => ({
      driver_id:        BigInt(d.driver_id),
      session_id:       BigInt(d.session_id),
      lat:              d.lat ?? data.originLat,
      lng:              d.lng ?? data.originLng,
      distance_metres:  d.distance_metres ?? 0,
      isBackgrounded:   false,
    }))
  }

  if (drivers.length < MAX_DRIVERS) {
    const radiusMetres = data.radiusMetres ?? ROUND_RADII[data.broadcastRound] ?? 8000
    const standardDrivers = await repo.findNearbyDrivers({
      lat: data.originLat,
      lng: data.originLng,
      categoryIds,
      maxDrivers: MAX_DRIVERS - drivers.length,
      radiusMetres,
      minWalletBalance,
    })
    const included = new Set(drivers.map(d => d.driver_id.toString()))
    for (const sd of standardDrivers) {
      if (!included.has(sd.driver_id.toString())) {
        drivers.push({
          driver_id:       BigInt(sd.driver_id),
          session_id:      BigInt(sd.session_id),
          lat:             sd.lat,
          lng:             sd.lng,
          distance_metres: sd.distance_metres,
          isBackgrounded:  sd.is_available === false,
        })
      }
    }
  }

  if (!drivers.length) {
    if (data.broadcastRound >= 3) {
      await repo.updateRideStatus(rideId, 'no_drivers')
      await repo.logStatusHistory({
        rideId,
        fromStatus: 'requested',
        toStatus:   'no_drivers',
        actor:      'system',
        note:       'No drivers available after 3 broadcast rounds',
      })
      log.info({ rideId: data.rideId }, 'no drivers available after max broadcast rounds')
    }
    return
  }

  // Per-driver window: a backgrounded match gets longer to notice a push, tap
  // it, and let the app reconnect than a live-socket driver gets to ack.
  const driversWithWindow = drivers.map(driver => {
    const windowSeconds = driver.isBackgrounded ? BACKGROUND_ACCEPT_WINDOW_SECONDS : BROADCAST_WINDOW_SECONDS
    return { ...driver, windowSeconds, expiresAt: new Date(Date.now() + windowSeconds * 1000) }
  })

  // Create all assignments in parallel — sequential awaits here were the source of
  // stacking delay (driver N had to wait for N-1 DB round-trips before getting the socket).
  await Promise.all(driversWithWindow.map(driver =>
    repo.createRideAssignment({
      rideId,
      driverId:       driver.driver_id,
      sessionId:      driver.session_id,
      expiresAt:      driver.expiresAt,
      broadcastRound: data.broadcastRound,
      driverLat:      driver.lat,
      driverLng:      driver.lng,
    })
  ))

  // Set ACK keys and queue retry jobs BEFORE emitting the socket.
  // If the key is set after the emit, a fast ACK from the driver deletes a
  // non-existent key (no-op), the key is then set, and the ack-check loop
  // re-fires indefinitely thinking the driver never received the notification.
  await Promise.all(driversWithWindow.map(async (driver) => {
    const driverIdStr = driver.driver_id.toString()
    await redis.set(rideAckKey(data.rideId, driverIdStr), '1', 'EX', driver.windowSeconds + 30)

    const jobData: AckCheckJobData = {
      rideId:           data.rideId,
      driverId:         driverIdStr,
      expiresAt:        driver.expiresAt.toISOString(),
      pickup:           ride.origin_address   ?? 'Pickup location',
      drop:             ride.destination_address ?? 'Destination',
      pickupLat:        data.originLat,
      pickupLng:        data.originLng,
      distanceToPickup: Math.round(driver.distance_metres),
      estimatedFare:    ride.total_estimated != null ? parseFloat(ride.total_estimated) : 0,
      rideType:         data.rideType,
      isReturnCab:      data.isReturnCab,
    }
    if (data.destinationLat !== undefined) jobData.destinationLat = data.destinationLat
    if (data.destinationLng !== undefined) jobData.destinationLng = data.destinationLng

    await queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride_ack_check',
      jobData,
      { delay: 4_000, attempts: 1, removeOnComplete: true, removeOnFail: true }
    )
  }))

  const pickup = ride.origin_address ?? 'Pickup location'
  const drop   = ride.destination_address ?? 'Destination'

  for (const driver of driversWithWindow) {
    const requestPayload: Record<string, unknown> = {
      rideId:            data.rideId,
      pickup,
      drop,
      pickupLat:         data.originLat,
      pickupLng:         data.originLng,
      destinationLat:    ride.dest_lat ?? undefined,
      destinationLng:    ride.dest_lng ?? undefined,
      distanceToPickup:  Math.round(driver.distance_metres),
      estimatedFare:     ride.total_estimated != null ? parseFloat(ride.total_estimated) : 0,
      rideType:          data.rideType,
      isReturnCab:       data.isReturnCab,
      expiresAt:         driver.expiresAt.toISOString(),
      timeoutSeconds:    driver.windowSeconds,
      stopCount:         stops.length,
    }
    if (ride.return_at)   requestPayload['returnAt']  = ride.return_at
    if (ride.trip_hours)  requestPayload['tripHours'] = Number(ride.trip_hours)
    if (categoryName)     requestPayload['rideCategoryName'] = categoryName
    socketEvents.sendRideRequest(driver.driver_id.toString(), requestPayload)

    // A backgrounded driver's socket is very likely dead — don't wait for
    // ack-check's 4s-later fallback, push immediately. Guarded internally so
    // ack-check's own fallback (if it still fires) is a no-op for this driver.
    if (driver.isBackgrounded) {
      void sendRideRequestPushOnce(data.rideId, driver.driver_id.toString(), pickup, drop, driver.windowSeconds)
        .catch((err: unknown) => log.error({ err, rideId: data.rideId, driverId: driver.driver_id.toString() }, 'immediate background push failed'))
    }
  }

  log.info(
    { rideId: data.rideId, broadcastRound: data.broadcastRound, driverCount: drivers.length },
    'broadcast round sent'
  )
}
