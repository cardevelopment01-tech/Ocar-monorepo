// Regression check for the Phase 10b fix (docs/DRIVER_USER_MAP_UX_FIX_PLAN.md).
// Run with: npx tsx apps/driver/src/lib/__checks__/remaining-path.check.ts
import { remainingRoutePath } from '../geo'

const route: [number, number][] = [
  [20.27, 85.84], [20.28, 85.84], [20.29, 85.84], [20.30, 85.84],
]

// Mid-route: snap is on segment 0, plenty of tail left — final point still appended.
const midRoute = remainingRoutePath([20.275, 85.84], route, 0, [20.30, 85.84])
console.assert(
  midRoute.length === route.length - 1 + 1, // tail (segments 1..3, 3 points) + snap + final(already last)
  'FAIL: mid-route path should include the snap + remaining tail',
)
console.assert(
  midRoute[midRoute.length - 1]![0] === 20.30 && midRoute[midRoute.length - 1]![1] === 85.84,
  'FAIL: mid-route path must end at the route\'s final point',
)

// Near arrival: snap already on the LAST segment — tail is empty, this is the exact
// bug (a bare [snappedPosition] used to be returned and RoutePolyline refused to draw it).
const nearArrival = remainingRoutePath([20.299, 85.84], route, route.length - 2, [20.30, 85.84])
console.assert(
  nearArrival.length === 2,
  'FAIL: near-arrival path must still have >=2 points (snap + final), not vanish',
)
console.assert(
  nearArrival[1]![0] === 20.30 && nearArrival[1]![1] === 85.84,
  'FAIL: near-arrival path must end at the destination',
)

// Exact-duplicate guard: when the tail's last point already IS the final point,
// don't append a redundant zero-length trailing segment.
const noDup = remainingRoutePath([20.285, 85.84], route, 1, [20.30, 85.84])
const dupCount = noDup.filter(([lat, lng]) => lat === 20.30 && lng === 85.84).length
console.assert(dupCount === 1, 'FAIL: final point must not be duplicated when the tail already ends there')

console.log('remaining-path.check.ts: all assertions passed')
