// What the public tracking page may see, and when a link is dead. Pure functions: the service wires them to the database.
//
// The response is an ALLOW-LIST: toPublicTrip() names every field it returns. Nothing is copied wholesale from a database row,
// so a column added to the ride query later can never reach this unauthenticated page (api/tests/unit/ride-shares/public-trip.test.ts
// asserts the exact key set).

import type { PublicStopRow, PublicTripRow, ShareLookup } from './ride-shares.repository'

export type TripPhase = 'driver_on_way' | 'in_trip' | 'completed' | 'cancelled' | 'finding_driver' | 'inactive'

/** After the trip ends the page keeps saying so for this long, then the link is dead. */
export const POST_TRIP_GRACE_MS = 30 * 60 * 1000
/** A link never lives longer than this after it was created (a long rental or round trip fits well inside). */
export const MAX_LINK_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** A driver position older than this is shown as stale, never as live. */
export const STALE_AFTER_MS = 60 * 1000

/** Rides a rider may share: a driver is assigned and the trip has not ended. */
export const SHAREABLE_STATUSES: ReadonlySet<string> = new Set(['accepted', 'driver_arrived', 'in_progress', 'returning'])

// One place for the ride_status -> phase decision (002_enums.sql + 075_ride_status_returning.sql). A ride that goes back to
// 'requested' (its driver cancelled and dispatch is looking again) is NOT a dead link: the link follows the ride, so the page says
// a new driver is being found and comes back to life when one accepts. Any status not listed (one added later) reads as inactive
// rather than guessing.
const PHASE_BY_STATUS: Record<string, TripPhase> = {
  accepted: 'driver_on_way',
  driver_arrived: 'driver_on_way',
  in_progress: 'in_trip',
  returning: 'in_trip',
  completed: 'completed',
  cancelled: 'cancelled',
  no_drivers: 'cancelled',
  requested: 'finding_driver',
}

export function phaseForStatus(status: string): TripPhase {
  return Object.prototype.hasOwnProperty.call(PHASE_BY_STATUS, status) ? PHASE_BY_STATUS[status]! : 'inactive'
}

export function isShareExpired(share: Pick<ShareLookup, 'created_at' | 'completed_at' | 'cancelled_at' | 'status'>, now: Date): boolean {
  if (now.getTime() - share.created_at.getTime() > MAX_LINK_AGE_MS) return true
  const ended = share.completed_at ?? share.cancelled_at
  if (ended && now.getTime() - ended.getTime() > POST_TRIP_GRACE_MS) return true
  // An unknown status (one added later) must not serve a page we cannot describe.
  return phaseForStatus(share.status) === 'inactive'
}

export interface TripEta {
  etaMin: number
  route: string
}

export interface PublicTripDto {
  phase: TripPhase
  riderFirstName: string | null
  driverFirstName: string | null
  vehicle: { color: string | null; brand: string | null; model: string | null; plate: string | null }
  pickup: { label: string | null; lat: number; lng: number }
  /** Null when the ride has no fixed drop (a rental): the page then shows only the car and the pickup. */
  drop: { label: string | null; lat: number; lng: number } | null
  stops: Array<{ label: string | null; lat: number; lng: number; status: string }>
  driver: { lat: number; lng: number; heading: number | null; updatedAt: string; stale: boolean } | null
  etaMin: number | null
  route: string | null
  completedAt: string | null
  serverTime: string
}

/** The exact keys of the response, in one list, so a test can compare. `isSos` is added per share by the service. */
export const PUBLIC_TRIP_KEYS = [
  'phase', 'riderFirstName', 'driverFirstName', 'vehicle', 'pickup', 'drop', 'stops', 'driver', 'etaMin', 'route', 'completedAt', 'serverTime',
] as const

export function toPublicTrip(row: PublicTripRow, stops: PublicStopRow[], eta: TripEta | null, now: Date): PublicTripDto {
  const phase = phaseForStatus(row.status)
  const hasDriver = row.driver_lat != null && row.driver_lng != null && row.driver_updated_at != null
  const live = phase === 'driver_on_way' || phase === 'in_trip'
  return {
    phase,
    riderFirstName: row.rider_first_name,
    driverFirstName: row.driver_first_name,
    vehicle: { color: row.vehicle_color, brand: row.vehicle_brand, model: row.vehicle_model, plate: row.vehicle_plate },
    pickup: { label: row.origin_address, lat: row.origin_lat, lng: row.origin_lng },
    drop: row.destination_lat != null && row.destination_lng != null ? { label: row.destination_address, lat: row.destination_lat, lng: row.destination_lng } : null,
    stops: stops.map((s) => ({ label: s.address, lat: s.lat, lng: s.lng, status: s.status })),
    // The car is only drawn while the trip is live; after the end the page shows the drop pin, not where the driver went next.
    driver: live && hasDriver
      ? {
          lat: row.driver_lat!,
          lng: row.driver_lng!,
          heading: row.driver_heading,
          updatedAt: row.driver_updated_at!.toISOString(),
          stale: now.getTime() - row.driver_updated_at!.getTime() > STALE_AFTER_MS,
        }
      : null,
    etaMin: live && eta ? eta.etaMin : null,
    route: live && eta ? eta.route : null,
    completedAt: phase === 'completed' && row.completed_at ? row.completed_at.toISOString() : null,
    serverTime: now.toISOString(),
  }
}
