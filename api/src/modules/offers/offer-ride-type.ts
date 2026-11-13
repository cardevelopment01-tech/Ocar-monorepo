import type { RideType } from './offers.types'

/**
 * The ride type offers are matched on. A city ride is a one-way on the wire (old driver apps depend on that) but its offers are
 * separate from intercity one-way and rental ones (owner decision D5), so a one-way booked with trip mode 'city' is 'city' here.
 * Used by BOTH the offers preview and the booking-time resolution, so the two can never disagree.
 */
export function offerRideType(rideType: 'one_way' | 'round_trip' | 'rental', tripMode?: 'standard' | 'city'): RideType {
  return rideType === 'one_way' && tripMode === 'city' ? 'city' : rideType
}
