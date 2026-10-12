// Ported from apps/user/lib/polyline.ts -- same Google encoded-polyline
// algorithm, shared so rider-mobile's live route line decodes it identically.
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0, lat = 0, lng = 0

  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : (result >> 1)

    shift = 0; result = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : (result >> 1)

    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

export function haversineMetres(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(s))
}

// react-native-maps' Android Polyline renders a "beads on a string" artifact
// (distinct round blobs instead of one continuous line) when it's given many
// points that are only a few metres apart relative to a thick strokeWidth --
// exactly what a Google Directions polyline looks like for a short leg (it
// encodes a vertex every few metres). Each near-duplicate-point segment ends
// up short enough that its rounded line-cap dominates the segment instead of
// blending into the next one. Dropping points closer together than
// minDistanceMetres removes the redundant vertices without changing the
// route's actual shape (a route is still just a sequence of joined segments;
// perfectly straight or gently curving stretches don't need a vertex every
// 5 metres to look correct at road scale).
export function simplifyPolyline(points: [number, number][], minDistanceMetres = 12): [number, number][] {
  if (points.length <= 2) return points
  const first = points[0]!
  const last = points[points.length - 1]!
  const kept: [number, number][] = [first]
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i]!
    if (haversineMetres(kept[kept.length - 1]!, point) >= minDistanceMetres) kept.push(point)
  }
  kept.push(last)
  return douglasPeucker(kept, ROUTE_SIMPLIFY_TOLERANCE_M)
}

// Highway stretches are near-straight but Directions still encodes a vertex every few
// metres; every vertex is re-sent to the native map on each polyline update, so dropping
// the ones within a few metres of the chord cuts the payload 80-90% with no visible change.
const ROUTE_SIMPLIFY_TOLERANCE_M = 4

// Local equirectangular projection (metres) around a reference point -- accurate to well
// under a metre over the few-km spans a route segment covers, and far cheaper than haversine.
function toXY(p: [number, number], ref: [number, number]): [number, number] {
  const kLat = 111_320
  return [(p[1] - ref[1]) * kLat * Math.cos((ref[0] * Math.PI) / 180), (p[0] - ref[0]) * kLat]
}

function distToSegmentM(p: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = toXY(p, a)
  const [bx, by] = toXY(b, a)
  const len2 = bx * bx + by * by
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2))
  return Math.hypot(px - t * bx, py - t * by)
}

/** Shortest distance in metres from `point` to the line through `line` (0 if the line is empty). */
export function distanceToPolylineMetres(point: [number, number], line: [number, number][]): number {
  if (line.length === 0) return 0
  if (line.length === 1) return haversineMetres(point, line[0]!)
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const d = distToSegmentM(point, line[i]!, line[i + 1]!)
    if (d < best) best = d
  }
  return best
}

/** Iterative Douglas-Peucker: keeps the first/last point and every point more than `toleranceM` off the chord. */
export function douglasPeucker(points: [number, number][], toleranceM: number): [number, number][] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegmentM(points[i]!, points[lo]!, points[hi]!)
      if (d > maxD) { maxD = d; idx = i }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1
      stack.push([lo, idx], [idx, hi])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}
