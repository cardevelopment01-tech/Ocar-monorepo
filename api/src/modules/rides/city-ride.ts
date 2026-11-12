import { httpError } from '@/lib/errors'
import type { BookingRequest } from './rides.types'

export type TripMode = 'standard' | 'city'

/** The trip mode of a request: 'city' only when asked for explicitly; absent (every old client) is standard. Anything else is refused. */
export function parseTripMode(raw: unknown): TripMode {
  if (raw === undefined || raw === null || raw === 'standard') return 'standard'
  if (raw === 'city') return 'city'
  throw httpError(422, 'Unknown trip mode', 'VALIDATION_ERROR')
}

/**
 * The rules of a city ride booking (owner decisions D3 and D8): a point-to-point one-way inside one city boundary, no distance cap,
 * not a return cab, switched on by city_rides_enabled. The stop limit is the existing one for every ride type.
 */
export function assertCityRideAllowed(
  data: Pick<BookingRequest, 'rideType' | 'isReturnCab' | 'destinationLat' | 'destinationLng'>,
  ctx: { flagOn: boolean; scope: 'in_city' | 'outstation' },
): void {
  if (!ctx.flagOn) throw httpError(422, 'City ride is not available right now', 'CITY_RIDE_DISABLED')
  if (data.rideType !== 'one_way') throw httpError(422, 'A city ride is a one-way trip', 'VALIDATION_ERROR')
  if (data.isReturnCab) throw httpError(422, 'A return cab is not available for a city ride', 'VALIDATION_ERROR')
  if (data.destinationLat === undefined || data.destinationLng === undefined) {
    throw httpError(422, 'Please add a drop-off location for a city ride', 'VALIDATION_ERROR')
  }
  if (ctx.scope !== 'in_city') throw httpError(422, 'This trip leaves the city, so it cannot be a city ride', 'CITY_RIDE_NOT_IN_CITY')
}
