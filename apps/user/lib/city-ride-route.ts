// Where the search page sends a picked pickup and drop (owner decisions D3 and D8: Outstation, City Ride and Rental).
// With City ride off, or an older server that sends no `city_ride_available`, every answer is exactly what the page did before
// city rides existed (pinned by __tests__/city-ride-route.test.ts).

export type Classification = {
  scope: 'in_city' | 'outstation'
  cityId: number | null
  cityName: string | null
  /** Present only when the server knows City ride; absent on an older server (treated as off). */
  city_ride_available?: boolean
}

export type RoutePath = '/select-ride' | '/rental' | '/trip-type' | '/round-trip'
export type RouteToast = 'to_city' | 'to_rental' | 'to_outstation' | null
export type SearchRoute = { path: RoutePath; tripMode?: 'city'; toast: RouteToast }

const route = (path: RoutePath, toast: RouteToast, city = false): SearchRoute =>
  city ? { path, tripMode: 'city', toast } : { path, toast }

export function resolveSearchRoute(a: {
  rideType?: string | undefined
  backTo?: string | undefined
  tripMode?: 'city' | undefined
  classification: Classification | null
}): SearchRoute {
  const { rideType, backTo, tripMode, classification: c } = a
  const inCity = c?.scope === 'in_city'
  const cityOn = c?.scope === 'in_city' && c.city_ride_available === true

  // The City Ride tile.
  if (tripMode === 'city') {
    // Classification failed: stay on City Ride and let the server judge the trip at quote and booking.
    if (c === null || (inCity && cityOn)) return route('/select-ride', null, true)
    if (inCity) return route('/rental', 'to_rental')
    return route('/trip-type', 'to_outstation')
  }

  // Editing pickup or drop from the ride list.
  if (backTo === 'select-ride') {
    if ((rideType === 'one_way' || rideType === 'round_trip') && inCity) {
      return cityOn && rideType === 'one_way' ? route('/select-ride', 'to_city', true) : route('/rental', 'to_rental')
    }
    return route('/select-ride', null)
  }

  // Return-cab destination picker (round trip): cannot be inside the city.
  if (backTo === 'round_trip') return inCity ? route('/rental', 'to_rental') : route('/round-trip', null)

  // Rental's own destination picker: an outstation destination cannot be a rental.
  if (backTo === 'rental') return inCity ? route('/rental', null) : route('/trip-type', 'to_outstation')

  // A declared one-way that turns out to be inside the city.
  if (rideType === 'one_way') {
    if (inCity) return cityOn ? route('/select-ride', 'to_city', true) : route('/rental', 'to_rental')
    return route('/select-ride', null)
  }

  // No declared intent (search bar, saved places, "Go again", popular routes): classify and route.
  if (inCity) return cityOn ? route('/select-ride', 'to_city', true) : route('/rental', null)
  return route('/trip-type', null)
}
