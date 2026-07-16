// Regression check for the "route line spikes at a turn" bug: nearestPointOnPolyline
// must prefer the occurrence of a nearby point NEAR the last matched segment over a
// geometrically-closer-but-far-away occurrence elsewhere in a self-intersecting route
// (a rental "Flexible route" doubling back, or a dense junction). See geo.ts's window
// constants doc comment.
// Run with: npx tsx apps/driver/src/lib/__checks__/nearest-locality.check.ts
import { nearestPointOnPolyline } from '../geo'

// A route that goes out along one road and doubles back near its own start —
// point 0 and point 20 are near-identical coordinates (the double-back), far apart
// in array index.
const route: [number, number][] = []
for (let i = 0; i <= 10; i++) route.push([20.30 + i * 0.001, 85.80]) // out: 0..10
for (let i = 9; i >= 0; i--) route.push([20.30 + i * 0.001, 85.80005]) // back: 11..20, ~5.5m west of the out leg

// Driver is actually near the START of the route (early index), right where the
// out-leg and the doubled-back leg pass within ~5.5m of each other.
const driverPos: [number, number] = [20.3005, 85.80002]

// Without locality bias (cold start, nearIndex = null): whichever occurrence wins is
// whatever the raw distances say — not asserted here, this is the baseline.
const cold = nearestPointOnPolyline(driverPos, route, null)
console.assert(cold != null, 'FAIL: cold search should find a match')

// With locality bias toward where we actually last were (segment ~4, early in the
// out-leg), the match must stay on the EARLY occurrence, not jump to the far
// doubled-back occurrence (index >= 11) — that jump is the spike bug.
const biased = nearestPointOnPolyline(driverPos, route, 4)
console.assert(biased != null && biased.segmentIndex < 11,
  'FAIL: locality-biased search must prefer the near occurrence over the far doubled-back one')

// Genuine off-route (driver 200m from every windowed segment) must still fall back to
// a global search and re-acquire, not get stuck rejecting real relocation.
const farAway: [number, number] = [20.50, 85.80]
const reacquired = nearestPointOnPolyline(farAway, route, 4)
console.assert(reacquired != null, 'FAIL: must still find a global match when nothing is in the window')

console.log('nearest-locality.check.ts: all assertions passed')
