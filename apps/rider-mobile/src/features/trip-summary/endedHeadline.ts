import type { RideDetailExtra } from '@/features/ride-tracking/types'

/**
 * The title of a ride that did not complete. A driver cancel is named as such even when this screen is opened later (from a push or from
 * Trips), because the live "driver cancelled" event is only seen by a rider who had the ride open.
 */
export function endedHeadline(ride: Pick<RideDetailExtra, 'status' | 'cancellationActor'>): string {
  if (ride.status === 'no_drivers') return 'No drivers found'
  if (ride.status === 'cancelled' && ride.cancellationActor === 'driver') return 'Your driver cancelled'
  return 'Ride cancelled'
}
