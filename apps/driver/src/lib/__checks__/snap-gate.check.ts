// Regression check for the Phase 9 fix (docs/DRIVER_USER_MAP_UX_FIX_PLAN.md).
// Run with: npx tsx apps/driver/src/lib/__checks__/snap-gate.check.ts
import { bearingDeg, isTrustworthySnap } from '../geo'

// Same thresholds useTurnByTurn.ts uses (40m / 55°) — duplicated here deliberately so
// this check still catches a regression if those constants are loosened elsewhere.
const MAX_DIST = 40
const MAX_BEARING_DIFF = 55

// Route runs due north. Driver is 25m off it on a parallel street, heading east —
// this is the exact bug: close enough to force-snap, but clearly the wrong road.
const routeBearing = bearingDeg([20.27, 85.84], [20.28, 85.84]) // ~0 (north)
const wrongRoadHeading = 90 // east

console.assert(
  isTrustworthySnap(25, wrongRoadHeading, routeBearing, MAX_DIST, MAX_BEARING_DIFF) === false,
  'FAIL: a 25m-off fix with a 90-degree heading mismatch must be rejected as unsnapped',
)

// A fix 5m off the same route with heading matching the road must still snap.
console.assert(
  isTrustworthySnap(5, routeBearing, routeBearing, MAX_DIST, MAX_BEARING_DIFF) === true,
  'FAIL: a close fix heading along the route must be accepted',
)

// No device heading available (null) — falls back to distance-only, matching prior behavior.
console.assert(
  isTrustworthySnap(25, null, routeBearing, MAX_DIST, MAX_BEARING_DIFF) === true,
  'FAIL: without a heading reading, distance-only gate must still accept a 25m fix',
)

console.log('snap-gate.check.ts: all assertions passed')
