/** Compass bearing (0-360°) from point `a` to point `b`. */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const lat1 = a[0] * Math.PI / 180
  const lat2 = b[0] * Math.PI / 180
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/** Great-circle distance in metres between two [lat, lng] points. */
export function haversineMetres(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

/** Smallest angle (0-180°) between two compass bearings. */
export function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * Whether a GPS-to-route snap should be trusted: within `maxDistMetres` AND, when a
 * device heading is available, pointing roughly along the matched segment's bearing.
 * A fix can be close to the polyline yet on a different real road (parallel streets) —
 * the bearing check is what rejects that case instead of force-snapping onto it.
 */
export function isTrustworthySnap(
  distMetres: number,
  heading: number | null,
  segBearing: number | null,
  maxDistMetres: number,
  maxBearingDiffDeg: number,
): boolean {
  if (distMetres > maxDistMetres) return false
  if (heading != null && segBearing != null
      && angularDiffDeg(heading, segBearing) > maxBearingDiffDeg) return false
  return true
}

export interface NearestPointResult {
  point: [number, number]
  distMetres: number
  segmentIndex: number
}

/**
 * Projects `p` onto the nearest point of a polyline (ordered [lat,lng] list), using a
 * local equirectangular (flat-plane) approximation centred on `p` — accurate to well
 * under a metre at city/highway scale, so a full geodesic library isn't needed here.
 */
export function nearestPointOnPolyline(
  p: [number, number],
  polyline: [number, number][],
): NearestPointResult | null {
  if (polyline.length === 0) return null
  if (polyline.length === 1) {
    return { point: polyline[0]!, distMetres: haversineMetres(p, polyline[0]!), segmentIndex: 0 }
  }

  const R = 6_371_000
  const lat0 = p[0] * Math.PI / 180
  const toXY = ([lat, lng]: [number, number]): [number, number] => [
    (lng * Math.PI / 180) * R * Math.cos(lat0),
    (lat * Math.PI / 180) * R,
  ]
  const fromXY = ([x, y]: [number, number]): [number, number] => [
    (y / R) * 180 / Math.PI,
    (x / (R * Math.cos(lat0))) * 180 / Math.PI,
  ]

  const px = toXY(p)
  let best: NearestPointResult | null = null

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = toXY(polyline[i]!)
    const b = toXY(polyline[i + 1]!)
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const lenSq = abx * abx + aby * aby
    let t = lenSq === 0 ? 0 : ((px[0] - a[0]) * abx + (px[1] - a[1]) * aby) / lenSq
    t = Math.max(0, Math.min(1, t))
    const projX = a[0] + abx * t
    const projY = a[1] + aby * t
    const dist = Math.hypot(px[0] - projX, px[1] - projY)
    if (!best || dist < best.distMetres) {
      best = { point: fromXY([projX, projY]), distMetres: dist, segmentIndex: i }
    }
  }

  return best
}

/**
 * True distance remaining along the route geometry — from a point snapped onto
 * `segmentIndex` up to `polyline[targetIndex]` — as opposed to a straight-line
 * distance to that target. Straight-line distance to a maneuver's endpoint can tick
 * UP while the driver is genuinely making progress along a curving road (a highway
 * bend inside a single "continue straight" step), since the chord to a fixed point
 * shortens and lengthens as you move around the curve. Summing the polyline's own
 * segments instead is monotonically non-increasing as the driver advances, because
 * it's measuring the same path the driver is actually on.
 */
export function distanceAlongPolyline(
  point: [number, number],
  segmentIndex: number,
  polyline: [number, number][],
  targetIndex: number,
): number {
  if (targetIndex <= segmentIndex) return 0
  const next = polyline[segmentIndex + 1]
  let dist = next ? haversineMetres(point, next) : 0
  for (let i = segmentIndex + 1; i < targetIndex; i++) {
    const a = polyline[i]
    const b = polyline[i + 1]
    if (a && b) dist += haversineMetres(a, b)
  }
  return dist
}

/**
 * Builds the "remaining route" path for display: the current snapped position
 * followed by whatever route points are still ahead, always ending at the route's
 * true final point. Without appending that final point, the tail runs dry near
 * arrival (the snap reaches the route's last segment) and the caller is left with
 * a single-point path that RoutePolyline correctly refuses to draw — reading as
 * the line vanishing early instead of shrinking to the destination (see
 * docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 10b).
 */
export function remainingRoutePath(
  snappedPosition: [number, number],
  routePoints: [number, number][],
  segmentIndex: number,
  fallbackFinal: [number, number],
): [number, number][] {
  const tail = routePoints.slice(segmentIndex + 1)
  const finalPoint = routePoints[routePoints.length - 1] ?? fallbackFinal
  const lastTailPoint = tail[tail.length - 1]
  const alreadyEndsThere = !!lastTailPoint
    && lastTailPoint[0] === finalPoint[0] && lastTailPoint[1] === finalPoint[1]
  return alreadyEndsThere ? [snappedPosition, ...tail] : [snappedPosition, ...tail, finalPoint]
}
