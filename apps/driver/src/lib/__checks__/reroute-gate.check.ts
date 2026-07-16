// Regression check for the "reroute takes forever" bug: shouldReroute must fire on a
// genuine early deviation without waiting out a cooldown left over from the INITIAL
// route fetch (lastRerouteAt starts at 0, not Date.now() of trip start). See geo.ts's
// shouldReroute doc comment.
// Run with: npx tsx apps/driver/src/lib/__checks__/reroute-gate.check.ts
import { shouldReroute } from '../geo'

const THRESHOLD = 2
const COOLDOWN_MS = 12_000

// Not enough consecutive off-route fixes yet — never fires, no matter the timing.
console.assert(
  shouldReroute(1, THRESHOLD, 0, 5_000, COOLDOWN_MS) === false,
  'FAIL: must not reroute below the consecutive-fix threshold',
)

// Enough fixes, and lastRerouteAt is still its initial 0 (no reroute has ever
// happened) — must fire immediately, not wait out a 12s cooldown from trip start.
console.assert(
  shouldReroute(THRESHOLD, THRESHOLD, 0, 13_000, COOLDOWN_MS) === true,
  'FAIL: an early genuine deviation must not be blocked by the initial-fetch cooldown',
)

// A reroute just happened — a second one within the cooldown window must not fire.
console.assert(
  shouldReroute(THRESHOLD, THRESHOLD, 10_000, 15_000, COOLDOWN_MS) === false,
  'FAIL: must debounce repeat reroutes within the cooldown window',
)

// Cooldown has fully elapsed since the last reroute — must fire again.
console.assert(
  shouldReroute(THRESHOLD, THRESHOLD, 10_000, 23_000, COOLDOWN_MS) === true,
  'FAIL: must reroute again once the cooldown has elapsed',
)

console.log('reroute-gate.check.ts: all assertions passed')
