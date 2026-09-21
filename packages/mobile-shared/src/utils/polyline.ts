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

function haversineMetres(a: [number, number], b: [number, number]): number {
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
  return kept
}
