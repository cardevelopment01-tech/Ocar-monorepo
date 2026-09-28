// Deep-imported from mobile-shared's own file, not the package barrel
// (`@ocar/mobile-shared`) -- the barrel's index.ts re-exports RN/Expo-touching
// modules (theme/useAppFonts, ui/*), which vitest's Node/Rollup transform
// can't parse (Flow syntax in transitive RN deps). This file must stay
// importable from plain-Node test runs (see vitest.config.ts's "pure-logic
// files only" scope) as well as from the real Metro-bundled app.
import { haversineMetres } from '@ocar/mobile-shared/src/utils/polyline'

/**
 * Clamps `point` to within `radiusMetres` of `origin`, scaling back along the
 * origin->point line rather than snapping to the nearest edge point on some
 * other bearing -- matches the server's own bounded-radius guard (see
 * api/src/modules/rides/rides.service.ts's updateRidePickup), so a rider who
 * drags past the edge sees exactly the point the API would have accepted.
 */
export function clampToRadius(
  origin: [number, number],
  point: [number, number],
  radiusMetres: number
): [number, number] {
  const dist = haversineMetres(origin, point)
  if (dist <= radiusMetres) return point
  const t = radiusMetres / dist
  return [
    origin[0] + (point[0] - origin[0]) * t,
    origin[1] + (point[1] - origin[1]) * t,
  ]
}
