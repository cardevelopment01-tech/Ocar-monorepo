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
 * not a return cab, switched on by city_rides_enabled. Stops: at most city_ride_max_stops (2), all inside the same city boundary (see stopLimitFor and pointsShareACity).
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

/** Most stops a city ride may have when system_config city_ride_max_stops is missing or unreadable (the client's rule: 2). */
export const CITY_RIDE_MAX_STOPS_DEFAULT = 2

/** Reads the configured city stop limit: a whole number from 0 up to the global ceiling, else the default. */
export function parseCityStopLimit(raw: string | null | undefined, globalMax: number): number {
  const n = Number((raw ?? '').trim())
  return raw != null && raw.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= globalMax ? n : Math.min(CITY_RIDE_MAX_STOPS_DEFAULT, globalMax)
}

/** The most stops this ride may carry: a city ride has its own (lower) limit, every other ride the global one. */
export function stopLimitFor(tripMode: TripMode | undefined, cityLimit: number, globalMax: number): number {
  return tripMode === 'city' ? Math.min(cityLimit, globalMax) : globalMax
}

/** The refusal for a city ride that has (or would have) more stops than allowed, in words the rider app can show. */
export function cityStopLimitError(limit: number) {
  return httpError(422, limit === 0 ? 'A city ride cannot have stops' : `A city ride can have at most ${limit} ${limit === 1 ? 'stop' : 'stops'}`, 'CITY_RIDE_STOP_LIMIT')
}

export const cityStopOutsideError = () => httpError(422, 'A stop on a city ride must be inside the city', 'CITY_RIDE_STOP_OUTSIDE_CITY')
