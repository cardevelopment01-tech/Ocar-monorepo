import type { AssignCandidate } from './admin-api'
import type { Bounds } from './live-map-cluster'

// Dispatching from the map: while someone is choosing a driver for a ride nobody has taken, the nearest drivers who could take it are
// marked on the map (1, 2, 3 ...) with a line from the pickup and their distance, so the choice is made by looking at the map as well as the list.

/** How many nearest drivers are marked. The panel lists everyone (up to 50); the map shows the few worth looking at. */
export const MARKED_DRIVERS = 5

export interface MarkedDriver { driverId: string; rank: number; distanceMetres: number; label: string }

/** Kilometres with one decimal, the same as the driver list beside the map ("0.5 km"), so one driver reads the same in both places. */
export function fmtDistance(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`
}

// Only drivers who can take the ride as it stands (online, right category, enough balance) and whose position is known, nearest first.
// The panel's own order is by distance already, but it also lists drivers who fail a check, so they are filtered out here.
export function markedDrivers(candidates: AssignCandidate[], limit = MARKED_DRIVERS): MarkedDriver[] {
  return candidates
    .filter((c) => c.is_online && c.eligible && c.distance_metres != null)
    .sort((a, b) => a.distance_metres! - b.distance_metres!)
    .slice(0, limit)
    .map((c, i) => ({ driverId: c.driver_id, rank: i + 1, distanceMetres: c.distance_metres!, label: fmtDistance(c.distance_metres!) }))
}

export interface Point { lat: number; lng: number }

/** The box that holds the pickup and every given point (nothing if there are none). */
export function boundsAround(pickup: Point, points: Point[]): Bounds {
  const b: Bounds = { north: pickup.lat, south: pickup.lat, east: pickup.lng, west: pickup.lng }
  for (const p of points) {
    b.north = Math.max(b.north, p.lat); b.south = Math.min(b.south, p.lat)
    b.east = Math.max(b.east, p.lng); b.west = Math.min(b.west, p.lng)
  }
  return b
}
