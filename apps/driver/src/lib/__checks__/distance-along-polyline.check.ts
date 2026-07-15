// Regression check for the curving-step distance bug (distanceToManeuver ticking UP
// on a long "continue straight" step over a bend — see useTurnByTurn.ts).
// Run with: npx tsx apps/driver/src/lib/__checks__/distance-along-polyline.check.ts
import { distanceAlongPolyline } from '../geo'

// A right-angle bend: driving along it, the straight-line chord to the endpoint
// shortens then LENGTHENS again past the midpoint, but distance-along-route must
// only ever decrease.
const bend: [number, number][] = [
  [20.30, 85.80], [20.30, 85.82], [20.30, 85.84], [20.28, 85.84], [20.26, 85.84],
]
const endIdx = bend.length - 1

const d0 = distanceAlongPolyline(bend[0]!, 0, bend, endIdx)
const d1 = distanceAlongPolyline(bend[1]!, 1, bend, endIdx)
const d2 = distanceAlongPolyline(bend[2]!, 2, bend, endIdx) // right at the bend's corner
const d3 = distanceAlongPolyline(bend[3]!, 3, bend, endIdx)

console.assert(d0 > d1 && d1 > d2 && d2 > d3, 'FAIL: distance-along-route must strictly decrease around a bend')

// Already at/past the target: no negative distances.
console.assert(distanceAlongPolyline(bend[4]!, 4, bend, endIdx) === 0, 'FAIL: at-target distance must be 0, not negative')
console.assert(distanceAlongPolyline(bend[4]!, 5, bend, 2) === 0, 'FAIL: segmentIndex past targetIndex must clamp to 0')

console.log('distance-along-polyline.check.ts: all assertions passed')
