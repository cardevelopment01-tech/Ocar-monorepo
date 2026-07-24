import * as repo from '@/modules/rides/rides.repository'
import { queues, QUEUE_NAMES } from '@/jobs/queues'
import { getFareEstimate } from '@/modules/pricing/pricing.service'
import type { FareEstimateRequest } from '@/modules/pricing/pricing.types'
import { socketEvents } from '@/websocket/socket.server'
import type { BroadcastJobData } from './broadcast.processor'

const FARE_DRIFT_DISCLOSURE_THRESHOLD = 0.10

export interface DispatchScheduledJobData {
  rideId: string
}

// Flips a 'scheduled' ride to 'requested' once it enters its dispatch buffer
// window, then hands off to the existing (unmodified) broadcast pipeline.
// Triggered by both the per-ride delayed job (optimization) and the
// repeatable sweep (source of truth) — the CAS update makes double-firing safe.
export async function processDispatchScheduled(data: DispatchScheduledJobData): Promise<void> {
  const rideId = BigInt(data.rideId)

  const cas = await repo.updateRideStatusCAS(rideId, 'scheduled', 'requested')
  if (!cas) return // already dispatched, cancelled, or rescheduled by someone else — no-op

  // RETURNING * from the CAS gives raw geography columns, not the ST_Y/ST_X
  // lat/lng the broadcast pipeline needs — re-fetch through the same query
  // every other ride route uses so this can't drift from that shape.
  const ride = await repo.getRideById(rideId)
  if (!ride) return

  await repo.logStatusHistory({
    rideId,
    fromStatus: 'scheduled',
    toStatus:   'requested',
    actor:      'system',
    note:       'Advance booking dispatch buffer reached',
  })
  await repo.updateAdvanceMetaStatus(rideId, 'dispatched')

  // Fare is deliberately never locked at booking time (§7 of the advance-booking
  // plan) — recompute against the current rate card / surge now, and disclose the
  // delta to the rider if it's material. Silently keeping the stale quote would
  // undercharge; silently upcharging would violate the disclosure requirement.
  const recomputeInput = await repo.getFareRecomputeInput(rideId)
  if (recomputeInput) {
    const fareReq: FareEstimateRequest = {
      category_id:   recomputeInput.category_id,
      ride_type:     recomputeInput.ride_type as FareEstimateRequest['ride_type'],
      is_return_cab: recomputeInput.is_return_cab,
      distance_km:   recomputeInput.estimated_km,
      duration_min:  recomputeInput.estimated_min,
      stop_count:    recomputeInput.stop_count,
      trip_hours:    recomputeInput.trip_hours,
    }
    if (recomputeInput.rental_package_id != null) fareReq.rental_package_id = recomputeInput.rental_package_id
    if (recomputeInput.origin_city_id    != null) fareReq.city_id           = recomputeInput.origin_city_id

    const freshEstimate = await getFareEstimate(fareReq)
    await repo.updateFareSnapshotEstimate(rideId, freshEstimate)

    const oldTotal = recomputeInput.total_estimated
    const newTotal = freshEstimate.breakdown.total
    if (oldTotal > 0 && Math.abs(newTotal - oldTotal) / oldTotal > FARE_DRIFT_DISCLOSURE_THRESHOLD) {
      socketEvents.sendRideStatusUpdate(data.rideId, {
        status: 'requested',
        fareDrift: { previousFare: oldTotal, currentFare: newTotal },
      })
    }
  }

  const jobData: BroadcastJobData = {
    rideId:         data.rideId,
    categoryId:     ride.category_id.toString(),
    originLat:      ride.origin_lat,
    originLng:      ride.origin_lng,
    rideType:       ride.ride_type,
    isReturnCab:    ride.is_return_cab,
    broadcastRound: 1,
  }
  if (ride.dest_lat  != null) jobData.destinationLat = ride.dest_lat
  if (ride.dest_lng  != null) jobData.destinationLng = ride.dest_lng
  if (ride.trip_hours != null) jobData.tripHours = Number(ride.trip_hours)

  // Same 3-round broadcast schedule createBooking uses for immediate rides.
  await Promise.all([
    queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride', { ...jobData, broadcastRound: 1 },
      { delay: 0, attempts: 2, removeOnComplete: true }
    ),
    queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride', { ...jobData, broadcastRound: 2 },
      { delay: 25_000, attempts: 1, removeOnComplete: true }
    ),
    queues[QUEUE_NAMES.DISPATCH].add(
      'broadcast_ride', { ...jobData, broadcastRound: 3 },
      { delay: 50_000, attempts: 1, removeOnComplete: true }
    ),
  ])
}
