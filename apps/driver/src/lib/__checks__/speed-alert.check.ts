// Regression check for the over-speed alert timing: a lone GPS spike must not
// alert, a sustained violation must alert exactly once, and it must stay quiet
// through the cooldown before re-alerting while still over.
// Run with: npx tsx apps/driver/src/lib/__checks__/speed-alert.check.ts
import { stepSpeedAlert, type SpeedAlertState } from '../useSpeedAlert'

const LIMIT = 50 // trigger = 55 (limit + 5 margin); sustain 5s; cooldown 45s
const t0 = 2_000_000 // large base so the initial lastAlertAt:0 always reads as cooled

// 1. A single over-limit spike that drops back must NOT alert.
const s: SpeedAlertState = { overSince: null, lastAlertAt: 0 }
let r = stepSpeedAlert(s, 80, LIMIT, t0)
console.assert(!r.alert, 'FAIL: first over-sample should not alert (not yet sustained)')
r = stepSpeedAlert(r.state, 40, LIMIT, t0 + 1_000)
console.assert(!r.alert && r.state.overSince === null, 'FAIL: dropping below trigger must clear and not alert')

// 2. Sustained over-limit must alert once, only after the 5s sustain window.
r = stepSpeedAlert({ overSince: null, lastAlertAt: 0 }, 60, LIMIT, t0)
console.assert(!r.alert, 'FAIL: t+0s should not alert yet')
r = stepSpeedAlert(r.state, 60, LIMIT, t0 + 3_000)
console.assert(!r.alert, 'FAIL: t+3s (<5s sustain) should not alert')
r = stepSpeedAlert(r.state, 60, LIMIT, t0 + 6_000)
console.assert(r.alert, 'FAIL: t+6s sustained over limit should alert')

// 3. While still over, it must stay quiet through the cooldown, then re-alert.
const afterAlert = r.state
r = stepSpeedAlert(afterAlert, 60, LIMIT, t0 + 10_000)
console.assert(!r.alert, 'FAIL: must not re-alert within the 45s cooldown')
r = stepSpeedAlert(r.state, 60, LIMIT, t0 + 52_000)
console.assert(r.alert, 'FAIL: must re-alert once cooldown elapses and still over')

// 4. Within the +5 margin (54 km/h at a 50 limit) must never alert.
r = stepSpeedAlert({ overSince: null, lastAlertAt: 0 }, 54, LIMIT, t0)
console.assert(!r.alert && r.state.overSince === null, 'FAIL: within margin must not arm or alert')

// 5. A null speed sample (GPS lost) holds prior state and never alerts.
const held: SpeedAlertState = { overSince: 123, lastAlertAt: 456 }
r = stepSpeedAlert(held, null, LIMIT, t0)
console.assert(!r.alert && r.state === held, 'FAIL: null speed must hold state unchanged')

console.log('speed-alert.check.ts: all assertions passed')
