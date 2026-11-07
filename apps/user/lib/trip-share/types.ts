// The public live-trip response (GET /api/v1/public/trips/:token). Mirrors api/src/modules/ride-shares/public-trip.ts.
// Everything here is already allow-listed by the server: no phones, fares or OTPs ever arrive.

export type TripPhase = 'driver_on_way' | 'in_trip' | 'completed' | 'cancelled' | 'finding_driver' | 'inactive'

export interface PublicTrip {
  phase: TripPhase
  isSos: boolean
  riderFirstName: string | null
  driverFirstName: string | null
  vehicle: { color: string | null; brand: string | null; model: string | null; plate: string | null }
  pickup: { label: string | null; lat: number; lng: number }
  /** Null for a ride with no fixed drop (a rental). */
  drop: { label: string | null; lat: number; lng: number } | null
  stops: Array<{ label: string | null; lat: number; lng: number; status: string }>
  driver: { lat: number; lng: number; heading: number | null; updatedAt: string; stale: boolean } | null
  etaMin: number | null
  /** Encoded polyline of the planned route (driver to pickup, or driver to drop). */
  route: string | null
  completedAt: string | null
  serverTime: string
}

export type FetchResult =
  | { kind: 'ok'; trip: PublicTrip }
  /** 404 (unknown, revoked, malformed) or 410 (expired): one calm "no longer active" screen for both. */
  | { kind: 'inactive' }
  /** Network failure or a 5xx/429: keep what is on screen and retry. */
  | { kind: 'error' }
