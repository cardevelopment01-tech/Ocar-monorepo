import { socketEvents } from '@/websocket/socket.server'
import * as repo from '@/modules/rides/rides.repository'

const BROADCAST_WINDOW_SECONDS = 20
const MAX_DRIVERS = 5

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
}

export async function processBroadcast(data: BroadcastJobData): Promise<void> {
  const rideId     = BigInt(data.rideId)
  const categoryId = BigInt(data.categoryId)

  const ride = await repo.getRideById(rideId)
  if (!ride || ride.status !== 'requested') {
    console.log(`Broadcast skipped: ride ${data.rideId} no longer active`)
    return
  }

  let drivers: Array<{
    driver_id: bigint
    session_id: bigint
    lat: number
    lng: number
    distance_metres: number
  }> = []

  if (data.isReturnCab && data.destinationLat != null && data.destinationLng != null) {
    const returnDrivers = await repo.findReturnCabDrivers({
      pickupLat: data.originLat,
      pickupLng: data.originLng,
      dropLat:   data.destinationLat,
      dropLng:   data.destinationLng,
      categoryId,
    })
    drivers = returnDrivers.map(d => ({
      driver_id:        BigInt(d.driver_id),
      session_id:       BigInt(d.session_id),
      lat:              d.lat ?? data.originLat,
      lng:              d.lng ?? data.originLng,
      distance_metres:  d.distance_metres ?? 0,
    }))
  }

  if (drivers.length < MAX_DRIVERS) {
    const standardDrivers = await repo.findNearbyDrivers({
      lat: data.originLat,
      lng: data.originLng,
      categoryId,
      maxDrivers: MAX_DRIVERS - drivers.length,
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
      console.log(`Ride ${data.rideId}: no_drivers`)
    }
    return
  }

  const expiresAt = new Date(Date.now() + BROADCAST_WINDOW_SECONDS * 1000)

  for (const driver of drivers) {
    await repo.createRideAssignment({
      rideId,
      driverId:       driver.driver_id,
      sessionId:      driver.session_id,
      expiresAt,
      broadcastRound: data.broadcastRound,
      driverLat:      driver.lat,
      driverLng:      driver.lng,
    })

    socketEvents.sendRideRequest(driver.driver_id.toString(), {
      rideId:            data.rideId,
      pickup:            ride.origin_address   ?? 'Pickup location',
      drop:              ride.destination_address ?? 'Destination',
      pickupLat:         data.originLat,
      pickupLng:         data.originLng,
      destinationLat:    ride.dest_lat ?? undefined,
      destinationLng:    ride.dest_lng ?? undefined,
      distanceToPickup:  Math.round(driver.distance_metres),
      estimatedFare:     ride.total_estimated != null ? parseFloat(ride.total_estimated) : 0,
      rideType:          data.rideType,
      isReturnCab:       data.isReturnCab,
      expiresAt:         expiresAt.toISOString(),
      timeoutSeconds:    BROADCAST_WINDOW_SECONDS,
    })
  }

  console.log(
    `Broadcast round ${data.broadcastRound}: sent to ${drivers.length} drivers for ride ${data.rideId}`
  )
}
