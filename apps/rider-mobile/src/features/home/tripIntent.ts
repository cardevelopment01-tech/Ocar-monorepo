import type { RideType } from '@/features/booking/api'
import type { TripMode } from '@/features/booking/cityRideRoute'

export type TripIntent = 'outstation' | 'city' | 'rental'

/** The three home tiles (owner decision D8). Outstation holds One way and Round trip, chosen on the next screens. */
export const TRIP_INTENTS: ReadonlyArray<{ intent: TripIntent; title: string; sub: string }> = [
  { intent: 'outstation', title: 'Outstation', sub: 'City to city' },
  { intent: 'city', title: 'City Ride', sub: 'Within the city' },
  { intent: 'rental', title: 'Rental', sub: 'By the hour' },
]

/** What the booking draft starts as for a tile. Outstation declares no ride type, so the route is classified first. */
export function draftForIntent(intent: TripIntent): { rideType: RideType; declared: boolean; tripMode: TripMode } {
  if (intent === 'city') return { rideType: 'one_way', declared: true, tripMode: 'city' }
  if (intent === 'rental') return { rideType: 'rental', declared: true, tripMode: 'standard' }
  return { rideType: 'one_way', declared: false, tripMode: 'standard' }
}
