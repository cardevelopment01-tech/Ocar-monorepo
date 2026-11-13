// The three home tiles (owner decision D8). Outstation holds One way and Round trip, chosen on the next screens; City Ride is the
// metered in-city mode; Rental is the hourly mode (it opens its own screen).
export type TripTileId = 'outstation' | 'city' | 'rental'

export const TRIP_TILES: ReadonlyArray<{ id: TripTileId; label: string; sub: string }> = [
  { id: 'outstation', label: 'Outstation', sub: 'One way or round trip' },
  { id: 'city',       label: 'City Ride',  sub: 'Within the city' },
  { id: 'rental',     label: 'Rental',     sub: 'By the hour' },
]

/** The /search URL parameters a tile starts a trip with. Outstation declares no ride type, so the route is classified first. */
export function searchParamsForTile(
  tile: 'outstation' | 'city',
  origin: { lat: number; lng: number; address: string } | null,
): URLSearchParams {
  const params = new URLSearchParams()
  if (tile === 'city') { params.set('rideType', 'one_way'); params.set('tripMode', 'city') }
  if (origin) {
    params.set('originLat', String(origin.lat))
    params.set('originLng', String(origin.lng))
    params.set('originAddress', origin.address)
  }
  return params
}
