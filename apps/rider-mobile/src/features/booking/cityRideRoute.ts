import type { RideType } from './api'

export type TripMode = 'standard' | 'city'

/** What the server says about a pickup and drop. `cityRideAvailable` is absent on an older server (treated as off). */
export type TripClassification =
  | { scope: 'in_city'; cityId: number; cityName: string; cityRideAvailable?: boolean }
  | { scope: 'outstation' }

export type RouteToast = 'to_city' | 'to_rental' | 'to_outstation' | null

export type InCityRoute = {
  path: '/booking/fare' | '/booking/rental' | '/booking/trip-type' | '/booking/round-trip'
  rideType: RideType
  rideTypeDeclared: boolean
  tripMode: TripMode
  toast: RouteToast
}

const route = (path: InCityRoute['path'], rideType: RideType, rideTypeDeclared: boolean, tripMode: TripMode, toast: RouteToast): InCityRoute =>
  ({ path, rideType, rideTypeDeclared, tripMode, toast })

/**
 * Where a picked pickup and drop go next (owner decision D8: Outstation, City Ride and Rental). Inside one city boundary a trip is a city
 * ride when the server says City ride is on, otherwise exactly what the app did before city rides: Rental. Outside the city it is Outstation.
 * A server that does not send `cityRideAvailable` (older, or the switch off) therefore gets today's routes.
 */
export function resolveInCityRoute(args: {
  rideTypeDeclared: boolean
  rideType: RideType
  tripMode: TripMode
  classification: TripClassification | null
}): InCityRoute {
  const { rideTypeDeclared, rideType, tripMode, classification } = args
  const inCity = classification?.scope === 'in_city'
  const cityOn = classification?.scope === 'in_city' && classification.cityRideAvailable === true

  // The City Ride tile.
  if (tripMode === 'city') {
    // Classification failed (a flaky network): stay on City Ride rather than claim the trip leaves the city; the server judges it.
    if (classification === null) return route('/booking/fare', 'one_way', true, 'city', null)
    if (inCity && cityOn) return route('/booking/fare', 'one_way', true, 'city', null)
    if (inCity) return route('/booking/rental', 'rental', true, 'standard', 'to_rental')
    return route('/booking/trip-type', 'one_way', false, 'standard', 'to_outstation')
  }

  // The Outstation tile, or a search with no declared ride type.
  if (!rideTypeDeclared) {
    if (inCity) return cityOn ? route('/booking/fare', 'one_way', true, 'city', 'to_city') : route('/booking/rental', 'rental', true, 'standard', 'to_rental')
    return route('/booking/trip-type', 'one_way', false, 'standard', null)
  }

  // A declared one-way or round trip that turns out to be inside the city.
  if ((rideType === 'one_way' || rideType === 'round_trip') && inCity) {
    return cityOn && rideType === 'one_way'
      ? route('/booking/fare', 'one_way', true, 'city', 'to_city')
      : route('/booking/rental', 'rental', true, 'standard', 'to_rental')
  }
  // Rental cannot serve a trip that leaves the city: it becomes an Outstation trip, so the rider chooses One way or Round trip
  // (the same as the web search page) instead of being put on a one-way fare without being asked.
  if (rideType === 'rental' && !inCity) return route('/booking/trip-type', 'one_way', false, 'standard', 'to_outstation')

  return route(rideType === 'round_trip' ? '/booking/round-trip' : rideType === 'rental' ? '/booking/rental' : '/booking/fare', rideType, true, 'standard', null)
}
