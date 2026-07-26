import { haversineMetres } from './geo'

// Odisha is an intercity corridor (Bhubaneswar ↔ Cuttack ↔ Puri): inside a
// city's radius the posted city limit applies (comes from the city row, 50);
// otherwise the vehicle is on the NH corridor between cities → highway limit.
// ponytail: radius heuristic misclassifies dense NH-16 roadside towns as
// highway; upgrade path = OSM trunk/motorway proximity or the city_zones
// polygons stubbed in migration 005_m3_geo.sql.
export const HIGHWAY_SPEED_LIMIT_KMPH = 70
const CITY_RADIUS_METRES = 8_000

export interface SpeedLimitCity {
  centroid_lat: number
  centroid_lng: number
  default_speed_limit_kmph: number
}

/** Posted speed limit (km/h) at a GPS point given the active city list. */
export function classifyLimit(position: [number, number], cities: SpeedLimitCity[]): number {
  let nearest: SpeedLimitCity | null = null
  let nearestM = Infinity
  for (const c of cities) {
    const d = haversineMetres(position, [c.centroid_lat, c.centroid_lng])
    if (d < nearestM) { nearestM = d; nearest = c }
  }
  return nearest && nearestM <= CITY_RADIUS_METRES
    ? nearest.default_speed_limit_kmph
    : HIGHWAY_SPEED_LIMIT_KMPH
}
