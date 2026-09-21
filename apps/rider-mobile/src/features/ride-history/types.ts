// Matches GET /rides/me/upcoming's row shape (api/src/modules/rides/rides.repository.ts's
// getUpcomingRides) after camelizeKeys.
export type UpcomingRide = {
  id: string
  rideType: string
  originAddress: string | null
  destinationAddress: string | null
  scheduledFor: string
  fare: string | null
}

export type HistoryTab = 'upcoming' | 'all' | 'completed' | 'cancelled'
