// Where a vehicle is along a stored route, and the ETA that follows from it (docs/superpowers/plans/2026-11-10-google-maps-cost.md,
// phase B "shadow ETA"). Pure functions: no Redis, no database, no clock, so every rule is unit tested.

export type LatLng = [number, number]

/** Decodes a Google encoded polyline (precision 1e5). A truncated string yields the points decoded so far. */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let i = 0, lat = 0, lng = 0
  const next = (): number | null => {
    let shift = 0, result = 0, b: number
    do {
      if (i >= encoded.length) return null
      b = encoded.charCodeAt(i++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (i < encoded.length) {
    const dLat = next(); if (dLat === null) break
    const dLng = next(); if (dLng === null) break
    lat += dLat; lng += dLng
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

const R = 6_371_000
const rad = (d: number): number => (d * Math.PI) / 180

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export type BuiltRoute = { points: LatLng[]; cumM: number[]; totalM: number }

/** `cumM[i]` is the distance along the route from the first point to point i. */
export function buildRoute(points: LatLng[]): BuiltRoute {
  const cumM: number[] = [0]
  for (let i = 1; i < points.length; i++) cumM.push(cumM[i - 1]! + haversineM(points[i - 1]!, points[i]!))
  return { points, cumM, totalM: cumM[cumM.length - 1] ?? 0 }
}

export const OFF_ROUTE_M = 100
/** How far back along the route a position may appear to be and still count as the same trip (GPS jitter), before it is read as a new place. */
const BACKWARD_SLACK_M = 150

export type Progress = {
  /** Distance travelled along the route to the nearest point on it. */
  alongM: number
  /** How far the position is from the route line. */
  distM: number
  offRoute: boolean
}

// Distance from P to segment AB and where along AB the nearest point is (0..1), on a local flat approximation (accurate to well under a
// metre over the length of a route segment).
function toSegment(p: LatLng, a: LatLng, b: LatLng): { distM: number; t: number } {
  const kx = Math.cos(rad(p[0])) * 111_320, ky = 110_540
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
  return { distM: Math.hypot(ax + t * dx, ay + t * dy), t }
}

/**
 * Places a position on the route. Forward progress is preferred: only parts of the route no more than BACKWARD_SLACK_M behind the last
 * known progress, and no more than `maxForwardM` ahead of it, are considered first, so a route that loops back near itself, or passes the
 * same street twice, cannot pull the position to the wrong pass. If nothing within OFF_ROUTE_M is found there, the whole route is
 * searched, and the result is flagged off-route when it is still farther than that.
 */
export function projectOnRoute(route: BuiltRoute, lat: number, lng: number, lastAlongM = 0, maxForwardM = Infinity): Progress | null {
  const n = route.points.length
  if (n < 2) return null
  const p: LatLng = [lat, lng]
  const search = (minEndM: number, maxStartM = Infinity): Progress | null => {
    let best: Progress | null = null
    for (let i = 0; i < n - 1; i++) {
      if (route.cumM[i + 1]! < minEndM || route.cumM[i]! > maxStartM) continue
      const { distM, t } = toSegment(p, route.points[i]!, route.points[i + 1]!)
      if (best === null || distM < best.distM) {
        best = { alongM: route.cumM[i]! + t * (route.cumM[i + 1]! - route.cumM[i]!), distM, offRoute: false }
      }
    }
    return best
  }
  let best = search(lastAlongM - BACKWARD_SLACK_M, lastAlongM + maxForwardM)
  if (best === null || best.distM > OFF_ROUTE_M) {
    const anywhere = search(-Infinity)
    if (anywhere !== null && (best === null || anywhere.distM < best.distM)) best = anywhere
  }
  if (best === null) return null
  best.offRoute = best.distM > OFF_ROUTE_M
  return best
}

export type EtaState = { prevAlongM: number | null; prevAtMs: number | null; emaSpeedMps: number | null }
export const FRESH_ETA_STATE: EtaState = { prevAlongM: null, prevAtMs: null, emaSpeedMps: null }

export type EtaInput = {
  totalM: number
  /** Google's own duration for the whole route when it was fetched. */
  baselineSec: number
  alongM: number
  nowMs: number
  state: EtaState
}

export type EtaResult = {
  remainingM: number
  /** Remaining distance at the speed Google's route implied: "snap and trim". */
  etaBaseSec: number
  /** Remaining distance at a speed blended with the vehicle's observed progress, kept within 0.5x-1.5x of the baseline. */
  etaBlendSec: number
  state: EtaState
}

const EMA_WEIGHT = 0.4          // weight of the newest observed speed
const BLEND_OBSERVED = 0.5      // share of the observed speed in the blended speed
const MIN_FACTOR = 0.5          // a stopped car must not give an endless ETA
const MAX_FACTOR = 1.5
const MIN_SPEED_DT_S = 10       // closer samples are too noisy to give a speed

export function etaFromProgress(input: EtaInput): EtaResult | null {
  const { totalM, baselineSec, alongM, nowMs, state } = input
  if (!(totalM > 0) || !(baselineSec > 0) || !Number.isFinite(alongM)) return null
  const baselineMps = totalM / baselineSec
  const remainingM = Math.max(0, totalM - alongM)

  let ema = state.emaSpeedMps
  if (state.prevAlongM !== null && state.prevAtMs !== null) {
    const dt = (nowMs - state.prevAtMs) / 1000
    const dAlong = alongM - state.prevAlongM
    // Going backwards or a jump from a re-projection is not a speed: keep what we had.
    if (dt >= MIN_SPEED_DT_S && dAlong >= 0) {
      const v = dAlong / dt
      ema = ema === null ? v : EMA_WEIGHT * v + (1 - EMA_WEIGHT) * ema
    }
  }
  const blended = BLEND_OBSERVED * (ema ?? baselineMps) + (1 - BLEND_OBSERVED) * baselineMps
  const effective = Math.min(MAX_FACTOR * baselineMps, Math.max(MIN_FACTOR * baselineMps, blended))
  return {
    remainingM,
    etaBaseSec: remainingM / baselineMps,
    etaBlendSec: remainingM / effective,
    state: { prevAlongM: alongM, prevAtMs: nowMs, emaSpeedMps: ema },
  }
}
