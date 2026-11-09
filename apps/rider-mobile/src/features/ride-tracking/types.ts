import type { RideDetail } from '@ocar/mobile-shared'

// GET /rides/:id returns the full `rides` row (via RIDE_SELECT_SQL, see
// api/src/modules/rides/rides.repository.ts) plus joins -- a superset of the curated
// RideDetail shape in mobile-shared/src/api/types.ts. These extra fields are only
// needed by this screen (cash collection, live driver position fallback), so they're
// kept local rather than growing the shared type for one consumer.
export type RideDetailExtra = RideDetail & {
  paymentChannel: string | null
  cashCollectedAt: string | null
  cashCollectedAmount: string | null
  driverCurrentLat: number | null
  driverCurrentLng: number | null
  userRatingGiven: number | null
  // The booked vehicle category. The API sends bigint columns as strings, so it may arrive as a numeric string.
  categoryId?: number | string | null
  // The booked route distance in km (fare_snapshots.estimated_km, sent as a number); the trip progress bar's total.
  estimatedKm?: number | null
}

export const SEARCHING_STATUSES = new Set(['requested', 'scheduled'])
export const ASSIGNED_STATUSES = new Set(['accepted', 'driver_arrived'])
export const IN_PROGRESS_STATUSES = new Set(['in_progress', 'returning'])

export type DriverCancelInfo = {
  reasonCode: string | null
}
