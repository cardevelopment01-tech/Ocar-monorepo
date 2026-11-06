// Pure helpers for the "cars near you" layer on the searching map: which cars to frame, which way each one is heading,
// and whether a new position should glide or snap. No React Native imports, so every rule is unit-tested.

export type LatLng = [number, number]
/** `heading` is the compass bearing the driver's phone reported, when the live feed carried one. */
export type NearbyCar = { driverId: string; lat: number; lng: number; heading?: number; categoryId?: number }

/** The nearest cars are framed with the pickup; the rest stay on the map but never stretch the camera out. */
export const FRAME_MAX_CARS = 5
export const FRAME_WITHIN_METRES = 3000
/** A move smaller than this is GPS jitter: no glide, no turning the car. */
export const MIN_MOVE_METRES = 3
/** Below this a move is too short to give the car a reliable heading (it would spin on noise). */
export const MIN_HEADING_METRES = 8
/** A jump longer than this is not driving (a driver switched on elsewhere, a stale snapshot): snap, do not glide. */
export const MAX_GLIDE_METRES = 1500

const EARTH_M = 6_371_000
const rad = (d: number) => (d * Math.PI) / 180

export function metresBetween(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0])
  const dLng = rad(b[1] - a[1])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return EARTH_M * 2 * Math.asin(Math.sqrt(s))
}

/** Compass bearing from `from` to `to`, degrees clockwise from north, 0 <= result < 360. */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const phi1 = rad(from[0])
  const phi2 = rad(to[0])
  const dLng = rad(to[1] - from[1])
  const y = Math.sin(dLng) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

/** The coordinates to frame with the pickup: the nearest cars within range, capped. Empty when none are close. */
export function carsToFrame(pickup: LatLng, cars: readonly NearbyCar[], max = FRAME_MAX_CARS, within = FRAME_WITHIN_METRES): LatLng[] {
  return cars
    .map((c) => ({ at: [c.lat, c.lng] as LatLng, d: metresBetween(pickup, [c.lat, c.lng]) }))
    .filter((c) => c.d <= within)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((c) => c.at)
}

export type CarStep =
  | { kind: 'stay' }
  | { kind: 'glide'; heading: number | null }
  | { kind: 'snap' }

/** What a car should do when its reported position changes from `prev` to `next`. */
export function carStep(prev: LatLng, next: LatLng): CarStep {
  const d = metresBetween(prev, next)
  if (d < MIN_MOVE_METRES) return { kind: 'stay' }
  if (d > MAX_GLIDE_METRES) return { kind: 'snap' }
  return { kind: 'glide', heading: d >= MIN_HEADING_METRES ? bearingDegrees(prev, next) : null }
}
