// Ported from apps/driver/src/lib/useSpeedAlert.ts + speedLimit.ts -- same
// thresholds, same decision logic. Kept driver-mobile-local (not
// mobile-shared) since speed alerts are explicitly driver-facing only, never
// surfaced to the rider (locked during /plan-design-review on the hardening
// doc) -- rider-mobile has no use for this file.
import { haversineMetres } from './geo'

// Alert only above limit + margin, sustained, then stay quiet for a cooldown.
// The sustain window kills GPS spikes without smoothing; the cooldown stops
// nagging (research: Uber/Ola alert on limit+margin with a mute window, not
// the bare limit) -- identical constants to the web driver app so the two
// don't disagree about when a driver is "speeding".
const MARGIN_KMPH = 5
const SUSTAIN_MS = 5_000
const COOLDOWN_MS = 45_000

export interface SpeedAlertState {
  overSince: number | null
  lastAlertAt: number
}

/** Pure decision step -- unchanged from web's stepSpeedAlert, testable without React. */
export function stepSpeedAlert(
  prev: SpeedAlertState,
  speedKmph: number | null,
  limitKmph: number,
  now: number
): { state: SpeedAlertState; alert: boolean } {
  if (speedKmph == null) return { state: prev, alert: false }
  const trigger = limitKmph + MARGIN_KMPH
  if (speedKmph < trigger) return { state: { ...prev, overSince: null }, alert: false }

  const overSince = prev.overSince ?? now
  const sustained = now - overSince >= SUSTAIN_MS
  const cooled = now - prev.lastAlertAt >= COOLDOWN_MS
  if (sustained && cooled) return { state: { overSince, lastAlertAt: now }, alert: true }
  return { state: { ...prev, overSince }, alert: false }
}

// Odisha is an intercity corridor (Bhubaneswar <-> Cuttack <-> Puri): inside a
// city's radius the posted city limit applies; otherwise the vehicle is on
// the NH corridor between cities -> highway limit. Same heuristic + constant
// as web's speedLimit.ts.
// ponytail: radius heuristic misclassifies dense NH-16 roadside towns as
// highway; upgrade path = OSM trunk/motorway proximity or the city_zones
// polygons stubbed in migration 005_m3_geo.sql (same ceiling web already has).
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
    if (d < nearestM) {
      nearestM = d
      nearest = c
    }
  }
  return nearest && nearestM <= CITY_RADIUS_METRES ? nearest.default_speed_limit_kmph : HIGHWAY_SPEED_LIMIT_KMPH
}
