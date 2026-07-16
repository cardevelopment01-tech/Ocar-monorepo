// Regression check for the "two different polylines, one index" bug: a
// snappedSegmentIndex computed against useTurnByTurn's dense, per-step-concatenated
// routePoints must never be applied to a separately-decoded, sparser overview
// polyline (or vice versa) — the same index means a different physical point in
// each array. See useTurnByTurn.ts's `routePoints` field doc comment.
// Run with: npx tsx apps/driver/src/lib/__checks__/route-points-source.check.ts
import { distanceAlongPolyline } from '../geo'

// Same physical road curve (a turn), represented at two resolutions — exactly
// what Google's per-step polyline (dense, many points at a turn) vs its
// overview_polyline (simplified, few points) look like for the same route.
const dense: [number, number][] = [
  [20.30, 85.80], [20.30, 85.81], [20.30, 85.82], [20.295, 85.825], [20.29, 85.83], [20.28, 85.83],
]
const sparse: [number, number][] = [
  [20.30, 85.80], [20.295, 85.825], [20.28, 85.83],
]

// A snap lands on segment 2 of the DENSE array (near [20.30, 85.82], approaching
// the turn) — this is the real, correct usage: index and array match.
const correct = distanceAlongPolyline(dense[2]!, 2, dense, dense.length - 1)
console.assert(correct > 200, 'FAIL: correct usage should show real distance remaining through the turn')

// Same index (2) misapplied to the SPARSE array — this is the bug: segmentIndex 2
// is already >= the sparse array's last index, so remaining distance collapses to
// 0 even though the driver is genuinely ~250m+ from the destination. This is the
// mechanism that draws a straight line: the "remaining route" gets sliced to
// nothing.
const wrong = distanceAlongPolyline(dense[2]!, 2, sparse, sparse.length - 1)
console.assert(wrong === 0, 'FAIL: mismatched-array usage should demonstrate the collapse-to-zero bug')
console.assert(correct - wrong > 200, 'FAIL: the two must diverge sharply — that divergence IS the bug')

console.log('route-points-source.check.ts: all assertions passed')
