// A rate card is told apart by its ride type AND its trip mode: a City Ride card is a one-way card with trip mode 'city' (the ride type
// stays one_way on the wire, so old driver apps keep working). The rate card screen groups, labels and matches cards by this "mode".

type CardLike = { ride_type: string; trip_mode?: string | null }

export function cardMode(c: CardLike): string {
  return c.ride_type === 'one_way' && c.trip_mode === 'city' ? 'city' : c.ride_type
}

export const MODE_LABEL: Record<string, string> = {
  one_way: 'One Way', round_trip: 'Round Trip', city: 'City Ride', rental: 'Rental',
}

// Rental is not listed: a rental is priced from its Rental Package (stop charge and cancellation fee included).
export const MODE_ORDER = ['one_way', 'round_trip', 'city']

export function isRentalCard(c: CardLike): boolean {
  return c.ride_type === 'rental'
}

export function modeToCardFields(mode: string): { ride_type: string; trip_mode: 'standard' | 'city' } {
  return mode === 'city' ? { ride_type: 'one_way', trip_mode: 'city' } : { ride_type: mode, trip_mode: 'standard' }
}

/** Two cards (or a history row and a card) are versions of the same card: same category, same city, same mode. */
export function sameCard(
  a: CardLike & { category_name: string; city_id: number | null },
  b: CardLike & { category_name: string; city_id: number | null },
): boolean {
  return a.category_name === b.category_name && a.city_id === b.city_id && cardMode(a) === cardMode(b)
}
