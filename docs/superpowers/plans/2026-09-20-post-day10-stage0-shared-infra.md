# Post-Day-10 Stage 0: Shared Ride-Flow Infra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared infrastructure (SOSButton, CancelSheet, reducer widening, driver-position store, component test harness) that Stages 1-5 of the ride-flow hardening effort all depend on, so those later stages only wire already-tested pieces into screens rather than building shared logic piecemeal.

**Architecture:** Two new components (`SOSButton`, `CancelSheet`) live in `packages/mobile-shared/src/ui/` and are pure UI — they take injected callbacks (`onTrigger`, `onConfirm`) and know nothing about ride domain types, matching the existing `createApiClient`/`createSocket` injected-callback convention. `features/active-ride/reducer.ts` (driver-mobile) is widened to add the `returning` status and thread `rideType`. A new driver-position store (zustand, matching `useDriverSessionStore`'s shape) becomes the single source of truth for the driver's live GPS position, fed by the existing `backgroundTask.ts`.

**Tech Stack:** React Native 0.86.3, Expo 57, TypeScript, Zustand (state), Vitest (pure-logic tests, existing), Jest + `jest-expo` + `@testing-library/react-native` (new — component tests, scoped to `packages/mobile-shared` only, since that's where Stage 0's only RN-rendering components live).

**Spec:** `docs/superpowers/specs/2026-09-19-post-day10-ride-flow-hardening-design.md` — this plan implements that spec's "Stage 0" section in full, plus the two components' locked visual/a11y specs from that doc's `/plan-design-review` pass. Read both; this plan does not repeat the spec's rationale, only the concrete steps.

## Global Constraints

- No hardcoded hex/pixel values in `SOSButton.tsx`/`CancelSheet.tsx` — every color, spacing, radius, and shadow value comes from `packages/mobile-shared/src/theme/tokens.ts` (`colors`, `spacing`, `radii`, `shadows`, `typography`, `buttonRadius`, `gradientPrimary`).
- No new dependency where a core module already covers it — the `tel:` capability check uses React Native's own `Linking.canOpenURL`, not a new package.
- `RideStatus` in `reducer.ts` is a plain string union with no exhaustive `switch` on it today — adding `'returning'` is additive and cannot silently break existing callers (verified: the only `switch` in that file dispatches on `action.type`, not on `RideStatus`).
- Every new function/component gets a test in the same commit — no "add tests later" step.
- Match existing project conventions: injected-callback props (not context/hooks) for anything crossing the `mobile-shared` ↔ app boundary; zustand for any new client-side store, matching `useDriverSessionStore`'s `create<State>()((set) => ({...}))` shape.

---

## File Structure

```
packages/mobile-shared/
  jest.config.js                          [NEW] — jest-expo preset, scoped to src/**/*.test.tsx
  package.json                            [MODIFY] — add jest/jest-expo/RTL devDeps + test:ui script
  src/ui/
    SOSButton.tsx                         [NEW]
    SOSButton.test.tsx                    [NEW]
    CancelSheet.tsx                       [NEW]
    CancelSheet.test.tsx                  [NEW]
    Button.test.tsx                       [NEW] — smoke test proving the harness works, using the
                                            existing Button.tsx (no changes to Button.tsx itself)
    index.ts                              [MODIFY] — export the two new components

apps/driver-mobile/src/
  features/active-ride/
    reducer.ts                            [MODIFY] — widen RideStatus, thread rideType
    reducer.test.ts                       [NEW] — regression test (existing vitest, no RN needed)
    safety-api.ts                         [MODIFY] — add triggerSos()
  services/location/
    driverPositionStore.ts                [NEW] — zustand store, stale-signal detection
    driverPositionStore.test.ts           [NEW] — existing vitest, fake timers
    backgroundTask.ts                     [MODIFY] — write each tick into the new store

apps/rider-mobile/src/
  features/safety/
    api.ts                                [MODIFY] — add triggerSos()
```

---

### Task 1: Component test harness (`jest-expo` + React Native Testing Library, `packages/mobile-shared`)

**Files:**
- Create: `packages/mobile-shared/jest.config.js`
- Modify: `packages/mobile-shared/package.json`
- Create: `packages/mobile-shared/src/ui/Button.test.tsx`

**Interfaces:**
- Consumes: nothing (uses the existing, unmodified `Button` component to prove the harness).
- Produces: a working `pnpm --filter @ocar/mobile-shared test:ui` command that Tasks 4 and 5 rely on for `SOSButton.test.tsx`/`CancelSheet.test.tsx`.

- [ ] **Step 1: Add the test dependencies**

Run from the repo root:
```bash
pnpm --filter @ocar/mobile-shared add -D jest@^29.7.0 jest-expo@~57.0.5 @testing-library/react-native@^14.0.1
```
**Correction (found during Task 1's first dispatch — do NOT install `react-test-renderer`):**
the original draft of this step also listed `react-test-renderer@19.2.3`. Expo's own
current unit-testing docs are explicit: *"`@testing-library/react-native` now replaces
the deprecated `react-test-renderer` because `react-test-renderer` does not support
React 19 and above... do not install `react-test-renderer` if using React 19+; remove
it if already present."* Installing it alongside RTL 14 on React 19 is what caused
`render()` to hang as a pending Promise in the first implementation attempt — RTL 14
targets React 19 directly and brings its own renderer; a co-installed legacy
`react-test-renderer` conflicts with it. (`jest-expo@57.0.5` is still correct — verified
as the latest 57.x release matching this project's Expo 57 pin; `@testing-library/react-native@14.0.1`'s
peer deps require `react>=19.0.0`/`react-native>=0.78`, both satisfied without
`react-test-renderer` in the mix.)
(`react-test-renderer` version must match the `react` version already in `packages/mobile-shared/package.json`'s peer deps — `19.2.3` — or RTL's renderer mismatches and every test fails with a version-conflict error, not a useful assertion failure.)

- [ ] **Step 2: Add `jest.config.js`**

```javascript
// packages/mobile-shared/jest.config.js
module.exports = {
  preset: 'jest-expo',
  // Scoped to *.test.tsx only -- *.test.ts (pure logic) stays on the
  // existing vitest.config.ts. Two runners, split by file extension, so
  // neither config has to special-case the other's files.
  testMatch: ['**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
}
```

- [ ] **Step 3: Add the `test:ui` script**

Edit `packages/mobile-shared/package.json`'s `"scripts"` block:
```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:ui": "jest"
  }
}
```

- [ ] **Step 4: Write the smoke test against the existing `Button` component**

**Correction (found while debugging Task 1's first two dispatch attempts):**
`@testing-library/react-native` v14 made `render()`, `fireEvent()`, and
`renderHook()` async by default — each now returns a `Promise` and MUST be
awaited (confirmed via RTL's own v14 migration guide and release notes).
Confirmed directly: a bare `render(<Text>hello</Text>)` in this exact setup
returns `Promise { <pending> }`, which is why `screen.getByText()` failed
with `` `render` function has not been called `` — the render had not
actually resolved yet. Every test in this plan (Task 1, 4, 5) uses `await`
for this reason — this is not optional stylistic `await`, it is required by
RTL 14's API.

```tsx
// packages/mobile-shared/src/ui/Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react-native'
import { Button } from './Button'

describe('Button (harness smoke test)', () => {
  it('renders its label and calls onPress', async () => {
    const onPress = jest.fn()
    await render(<Button label="Go online" onPress={onPress} />)
    expect(screen.getByText('Go online')).toBeTruthy()
    await fireEvent.press(screen.getByText('Go online'))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn()
    await render(<Button label="Go online" onPress={onPress} disabled />)
    await fireEvent.press(screen.getByText('Go online'))
    expect(onPress).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run it and verify it passes**

Run: `pnpm --filter @ocar/mobile-shared test:ui`
Expected: both tests PASS. If `transformIgnorePatterns` is wrong, the failure mode is a syntax error from an untranspiled ESM package (e.g. `Unexpected token 'export'`) — the fix is adding the failing package's name to that regex, not touching the test itself.

- [ ] **Step 6: Commit**

```bash
git add packages/mobile-shared/jest.config.js packages/mobile-shared/package.json packages/mobile-shared/src/ui/Button.test.tsx pnpm-lock.yaml
git commit -m "test(mobile-shared): add jest-expo + RTL harness, smoke-tested against Button"
```

---

### Task 2: Widen `reducer.ts` to add `returning` status and thread `rideType`

**Files:**
- Modify: `apps/driver-mobile/src/features/active-ride/reducer.ts`
- Modify: `apps/driver-mobile/src/features/active-ride/reducer.test.ts` (this file
  already exists with 4 passing tests against the current 2-field state shape —
  **do not overwrite it.** Its existing `initial` constant and one `toEqual`
  assertion (currently `{ confirmedStatus: 'driver_arrived', pendingOptimisticStatus: null }`,
  missing `rideType`) will fail the moment `rideType` is added to the state
  shape. Update the existing `initial` to include `rideType: 'one_way'`, update
  that one `toEqual` to include `rideType: 'one_way'`, then add the new
  `returning`-status tests below the existing ones in the same file/`describe`
  structure it already uses.)

**Interfaces:**
- Consumes: nothing new — `RideDetail.rideType: string` already exists in `packages/mobile-shared/src/api/types.ts:74` and is already returned by `fetchRide()` (`apps/driver-mobile/src/features/active-ride/api.ts`); this task just starts reading a field that's already there.
- Produces: `RideStatus` now includes `'returning'`; `ActiveRideReducerState` gains a `rideType: string` field that `useActiveRide.ts` (a later stage's task, not this one) will read when it initializes the reducer from the fetched `RideDetail`.

- [ ] **Step 1: Update the existing regression test FIRST (IRON RULE — this widening modifies existing behavior), then add new coverage**

`reducer.test.ts` already exists with 4 passing tests. Make exactly these
changes to it — do not replace the file:

1. Change line 4 from:
   ```typescript
   const initial: ActiveRideReducerState = { confirmedStatus: 'accepted', pendingOptimisticStatus: null }
   ```
   to:
   ```typescript
   const initial: ActiveRideReducerState = { confirmedStatus: 'accepted', pendingOptimisticStatus: null, rideType: 'one_way' }
   ```

2. Change the `toEqual` in the second test (currently
   `{ confirmedStatus: 'driver_arrived', pendingOptimisticStatus: null }`) to
   `{ confirmedStatus: 'driver_arrived', pendingOptimisticStatus: null, rideType: 'one_way' }`.

3. Append this new `describe` block after the existing one, in the same file:

```typescript
describe('activeRideReducer: new round_trip returning status', () => {
  it('walks in_progress -> returning -> completed for a round_trip ride', () => {
    let state: ActiveRideReducerState = { confirmedStatus: 'in_progress', pendingOptimisticStatus: null, rideType: 'round_trip' }
    state = activeRideReducer(state, { type: 'confirmed', status: 'returning' })
    expect(displayStatus(state)).toBe('returning')
    state = activeRideReducer(state, { type: 'confirmed', status: 'completed' })
    expect(displayStatus(state)).toBe('completed')
  })

  it('rideType is preserved unchanged across every transition', () => {
    let state: ActiveRideReducerState = { confirmedStatus: 'accepted', pendingOptimisticStatus: null, rideType: 'rental' }
    state = activeRideReducer(state, { type: 'optimistic_advance', to: 'driver_arrived' })
    expect(state.rideType).toBe('rental')
    state = activeRideReducer(state, { type: 'reverted' })
    expect(state.rideType).toBe('rental')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter driver-mobile test reducer.test.ts`
Expected: FAIL — `'returning'` is not assignable to `RideStatus`, and `rideType` doesn't exist on `ActiveRideReducerState` (TypeScript error, since `RideStatus`/state shape don't include either yet).

- [ ] **Step 3: Widen the reducer**

```typescript
// apps/driver-mobile/src/features/active-ride/reducer.ts
// One reducer keyed by server-confirmed ride status, with a single pending-
// optimistic overlay field -- replaces what would otherwise be four independent
// ad-hoc booleans for arrived/start-otp/end-otp/collect-cash (Eng review
// hidden-complexity finding). On any lifecycle POST rejection, the caller
// dispatches 'reverted', which clears the overlay and falls back to rendering
// confirmedStatus -- the UI never shows an unconfirmed state indefinitely.
//
//   accepted --markArrived--> driver_arrived --startOtp--> in_progress
//                                                                |
//                                        one_way/rental ---------+--------- round_trip
//                                              |                             |
//                                            endOtp                     returning --endOtp--> completed
//                                              |                             |
//                                              v                             v
//                                          completed                    (endOtp above)
//
// 'returning' added post-Day-10 (round-trip return leg) -- see
// docs/superpowers/specs/2026-09-19-post-day10-ride-flow-hardening-design.md.
export type RideStatus = 'accepted' | 'driver_arrived' | 'in_progress' | 'returning' | 'completed'

export type ActiveRideReducerState = {
  confirmedStatus: RideStatus
  pendingOptimisticStatus: RideStatus | null
  // Threaded from RideDetail.rideType (already fetched, never read until now).
  // 'one_way' | 'round_trip' | 'rental' in practice; kept as `string` here
  // to match RideDetail's own field type rather than re-declaring a union
  // that could drift from the shared type.
  rideType: string
}

export type ActiveRideReducerAction =
  | { type: 'optimistic_advance'; to: RideStatus }
  | { type: 'confirmed'; status: RideStatus }
  | { type: 'reverted' }

export function activeRideReducer(
  state: ActiveRideReducerState,
  action: ActiveRideReducerAction
): ActiveRideReducerState {
  switch (action.type) {
    case 'optimistic_advance':
      return { ...state, pendingOptimisticStatus: action.to }
    case 'confirmed':
      return { ...state, confirmedStatus: action.status, pendingOptimisticStatus: null }
    case 'reverted':
      return { ...state, pendingOptimisticStatus: null }
  }
}

export function displayStatus(state: ActiveRideReducerState): RideStatus {
  return state.pendingOptimisticStatus ?? state.confirmedStatus
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter driver-mobile test reducer.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/driver-mobile/src/features/active-ride/reducer.ts apps/driver-mobile/src/features/active-ride/reducer.test.ts
git commit -m "feat(driver-mobile): widen RideStatus with returning, thread rideType through reducer"
```

---

### Task 3: Driver-position store with stale-signal detection

**Files:**
- Create: `apps/driver-mobile/src/services/location/driverPositionStore.ts`
- Create: `apps/driver-mobile/src/services/location/driverPositionStore.test.ts`
- Modify: `apps/driver-mobile/src/services/location/backgroundTask.ts:32` (add one call alongside the existing `emitLocationTick`)

**Interfaces:**
- Consumes: the same `latest.coords`/`latest.timestamp` values `backgroundTask.ts` already extracts for `emitLocationTick`.
- Produces: `useDriverPositionStore()` — a zustand hook stages 2/4's map screens (a later task) subscribe to instead of opening their own `watchPositionAsync`. Shape: `{ position: { lat, lng, heading?, speed? } | null, lastUpdatedAt: number | null, isStale: boolean }`.

- [ ] **Step 1: Write the failing test (fake timers, since staleness is time-based)**

```typescript
// apps/driver-mobile/src/services/location/driverPositionStore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDriverPositionStore, STALE_AFTER_MS } from './driverPositionStore'

describe('useDriverPositionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useDriverPositionStore.getState().reset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with no position and not stale', () => {
    const state = useDriverPositionStore.getState()
    expect(state.position).toBeNull()
    expect(state.isStale).toBe(false)
  })

  it('setPosition records the position and lastUpdatedAt, and clears staleness', () => {
    useDriverPositionStore.getState().setPosition({ lat: 20.29, lng: 85.82 })
    const state = useDriverPositionStore.getState()
    expect(state.position).toEqual({ lat: 20.29, lng: 85.82 })
    expect(state.lastUpdatedAt).toBe(Date.now())
    expect(state.isStale).toBe(false)
  })

  it('flips isStale to true after STALE_AFTER_MS with no new position', () => {
    useDriverPositionStore.getState().setPosition({ lat: 20.29, lng: 85.82 })
    useDriverPositionStore.getState().startStaleWatch()
    vi.advanceTimersByTime(STALE_AFTER_MS + 1000)
    expect(useDriverPositionStore.getState().isStale).toBe(true)
  })

  it('a fresh setPosition after going stale clears isStale again', () => {
    useDriverPositionStore.getState().setPosition({ lat: 20.29, lng: 85.82 })
    useDriverPositionStore.getState().startStaleWatch()
    vi.advanceTimersByTime(STALE_AFTER_MS + 1000)
    expect(useDriverPositionStore.getState().isStale).toBe(true)
    useDriverPositionStore.getState().setPosition({ lat: 20.3, lng: 85.83 })
    expect(useDriverPositionStore.getState().isStale).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter driver-mobile test driverPositionStore.test.ts`
Expected: FAIL — the module doesn't exist yet (`Cannot find module './driverPositionStore'`).

- [ ] **Step 3: Implement the store**

```typescript
// apps/driver-mobile/src/services/location/driverPositionStore.ts
import { create } from 'zustand'

export type DriverPosition = { lat: number; lng: number; heading?: number; speed?: number }

// Locked during /plan-design-review: a frozen marker that still LOOKS live
// is more misleading than one that visibly says "signal lost" -- 15s chosen
// as long enough to absorb normal GPS jitter/tunnel dropouts on the existing
// 3s-interval background task (backgroundTask.ts's timeInterval), short
// enough that a rider/driver isn't staring at a stale pin for a minute.
export const STALE_AFTER_MS = 15_000

interface DriverPositionState {
  position: DriverPosition | null
  lastUpdatedAt: number | null
  isStale: boolean
  _staleTimer: ReturnType<typeof setTimeout> | null
  setPosition: (position: DriverPosition) => void
  // Locked during follow-up /plan-eng-review: the staleness check lives in
  // ONE timer here, not duplicated per subscribing map screen (stages 2/4).
  startStaleWatch: () => void
  stopStaleWatch: () => void
  reset: () => void
}

export const useDriverPositionStore = create<DriverPositionState>()((set, get) => ({
  position: null,
  lastUpdatedAt: null,
  isStale: false,
  _staleTimer: null,

  setPosition: (position) => {
    const { _staleTimer } = get()
    if (_staleTimer) clearTimeout(_staleTimer)
    set({ position, lastUpdatedAt: Date.now(), isStale: false, _staleTimer: null })
  },

  startStaleWatch: () => {
    const { _staleTimer } = get()
    if (_staleTimer) clearTimeout(_staleTimer)
    const timer = setTimeout(() => set({ isStale: true }), STALE_AFTER_MS)
    set({ _staleTimer: timer })
  },

  stopStaleWatch: () => {
    const { _staleTimer } = get()
    if (_staleTimer) clearTimeout(_staleTimer)
    set({ _staleTimer: null })
  },

  reset: () => {
    const { _staleTimer } = get()
    if (_staleTimer) clearTimeout(_staleTimer)
    set({ position: null, lastUpdatedAt: null, isStale: false, _staleTimer: null })
  },
}))
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter driver-mobile test driverPositionStore.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Wire it into `backgroundTask.ts` alongside the existing `emitLocationTick`**

```typescript
// apps/driver-mobile/src/services/location/backgroundTask.ts
// Add this import near the top, next to the existing emitLocationTick import:
import { useDriverPositionStore } from './driverPositionStore'

// Inside TaskManager.defineTask's callback, immediately after the existing
// `void emitLocationTick({...})` call (around line 38), add:
useDriverPositionStore.getState().setPosition({
  lat: latest.coords.latitude,
  lng: latest.coords.longitude,
  ...(latest.coords.heading != null ? { heading: latest.coords.heading } : {}),
  ...(latest.coords.speed != null ? { speed: latest.coords.speed } : {}),
})
useDriverPositionStore.getState().startStaleWatch()
```

- [ ] **Step 6: `tsc --noEmit` clean**

Run: `pnpm --filter driver-mobile typecheck`
Expected: no errors. (`useDriverPositionStore` is a plain zustand hook usable outside React components via `.getState()`, same pattern already used for `useDriverSessionStore` calls from non-component code elsewhere in this codebase.)

- [ ] **Step 7: Commit**

```bash
git add apps/driver-mobile/src/services/location/driverPositionStore.ts apps/driver-mobile/src/services/location/driverPositionStore.test.ts apps/driver-mobile/src/services/location/backgroundTask.ts
git commit -m "feat(driver-mobile): add driver-position store with stale-signal detection"
```

---

### Task 4: `SOSButton` component + `triggerSos` API calls (both apps)

**Backend contract (verified directly against `api/src/modules/safety/`, not assumed):**
`POST /api/v1/safety/sos`, auth required, body `{ rideId: string, severity?: 'low'|'medium'|'high', lat?: number, lng?: number }` (`safety.controller.ts:55-74`). Server-side: 404 if ride not found; **400 `RIDE_NOT_ACTIVE` if the ride's status is not `driver_arrived`/`in_progress`/`returning`** (`sos.service.ts:22-24` — this means SOS must never be enabled while status is `accepted`, i.e. before the driver has arrived); a repeat press within 30s dedups into the existing alert and returns 200 (`sos.service.ts:32-39`); **429 `SOS_RATE_LIMITED`** after 5 alerts/hour per principal (`sos.service.ts:48-49`) — a 429 must NOT trigger the automatic retry, since retrying against a rate limit is pointless and the message is specific enough to show directly.

**Files:**
- Create: `packages/mobile-shared/src/ui/SOSButton.tsx`
- Create: `packages/mobile-shared/src/ui/SOSButton.test.tsx`
- Modify: `packages/mobile-shared/src/ui/index.ts`
- Modify: `apps/driver-mobile/src/features/active-ride/safety-api.ts` (add `triggerSos`)
- Modify: `apps/rider-mobile/src/features/safety/api.ts` (add `triggerSos`)

**Interfaces:**
- Consumes: `colors`, `spacing`, `radii`, `shadows`, `typography` from `../theme/tokens` (same directory as `Button.tsx`, same import style).
- Produces: `SOSButton` component with props:
  ```typescript
  export type SOSTriggerResult = { ok: true } | { ok: false; reason: 'rate_limited' | 'error' }
  export type SOSButtonProps = {
    // Caller computes this from ride status -- true only for
    // 'driver_arrived' | 'in_progress' | 'returning', per the backend
    // contract above. Renders nothing when false (e.g. during 'accepted').
    enabled: boolean
    onTrigger: () => Promise<SOSTriggerResult>
    // Optional emergency contact number for the tel: fallback. null/undefined
    // hides that row even if the device can place calls.
    emergencyPhoneNumber?: string | null
  }
  ```
  Later stage-2/4/5 tasks render `<SOSButton enabled={...} onTrigger={...} emergencyPhoneNumber={...} />` on the active-ride/ride-tracking screens.

- [ ] **Step 0: Declare `react-native-reanimated` as a peer dependency of `packages/mobile-shared`**

Self-review catch: `SOSButton.tsx` (Step 5 below) uses `react-native-reanimated` for its pulse animation, but `packages/mobile-shared/package.json` doesn't declare it at all — unlike `react`/`react-native`, which are already peer deps there. Both apps already carry their own pinned copy (`apps/driver-mobile/package.json` has `"react-native-reanimated": "4.6.0"`), so this package should depend on whichever version the consuming app provides, not bundle its own.

Edit `packages/mobile-shared/package.json`'s `"peerDependencies"` block:
```json
{
  "peerDependencies": {
    "react": "*",
    "react-native": "*",
    "react-native-reanimated": "*"
  }
}
```

- [ ] **Step 1: Add `triggerSos` to driver-mobile's safety API**

```typescript
// apps/driver-mobile/src/features/active-ride/safety-api.ts
// Add below the existing rateRider() function -- do not touch rateRider itself.
import type { SOSTriggerResult } from '@ocar/mobile-shared'

export async function triggerSos(rideId: string, lat?: number, lng?: number): Promise<SOSTriggerResult> {
  try {
    const body: Record<string, unknown> = { rideId }
    if (lat !== undefined) body['lat'] = lat
    if (lng !== undefined) body['lng'] = lng
    await api.post('/api/v1/safety/sos', body)
    return { ok: true }
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      return { ok: false, reason: 'rate_limited' }
    }
    return { ok: false, reason: 'error' }
  }
}
```
(Add `import axios from 'axios'` to this file's existing imports if not already present — check the top of the file first; `useActiveRide.ts` already imports axios the same way for its own `isInvalidOtp` check.)

- [ ] **Step 2: Add the identical `triggerSos` to rider-mobile's safety API**

```typescript
// apps/rider-mobile/src/features/safety/api.ts
// Add below the existing submitRating() function.
import axios from 'axios'
import type { SOSTriggerResult } from '@ocar/mobile-shared'

export async function triggerSos(rideId: string, lat?: number, lng?: number): Promise<SOSTriggerResult> {
  try {
    const body: Record<string, unknown> = { rideId }
    if (lat !== undefined) body['lat'] = lat
    if (lng !== undefined) body['lng'] = lng
    await api.post('/api/v1/safety/sos', body)
    return { ok: true }
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      return { ok: false, reason: 'rate_limited' }
    }
    return { ok: false, reason: 'error' }
  }
}
```

- [ ] **Step 3: Write the failing component test**

**Reminder: RTL v14's `render`/`fireEvent` are async — every call is `await`ed
below (see Task 1's correction note for why this is required, not stylistic).**

```tsx
// packages/mobile-shared/src/ui/SOSButton.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { SOSButton, type SOSTriggerResult } from './SOSButton'

describe('SOSButton', () => {
  it('renders nothing when enabled is false', async () => {
    await render(<SOSButton enabled={false} onTrigger={async () => ({ ok: true })} />)
    expect(screen.queryByLabelText('Emergency SOS, double tap to send alert')).toBeNull()
  })

  it('renders the trigger when enabled', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: true })} />)
    expect(screen.getByLabelText('Emergency SOS, double tap to send alert')).toBeTruthy()
  })

  it('on success, shows no failure state', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: true })} />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.queryByText(/not sent/i)).toBeNull())
  })

  it('on error, retries once automatically, then shows the persistent failure state', async () => {
    let calls = 0
    const onTrigger = async (): Promise<SOSTriggerResult> => {
      calls++
      return { ok: false, reason: 'error' }
    }
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByText(/SOS not sent/i)).toBeTruthy())
    expect(calls).toBe(2) // one initial attempt + one automatic retry
  })

  it('on rate_limited, does NOT retry and shows the rate-limit message directly', async () => {
    let calls = 0
    const onTrigger = async (): Promise<SOSTriggerResult> => {
      calls++
      return { ok: false, reason: 'rate_limited' }
    }
    await render(<SOSButton enabled onTrigger={onTrigger} />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByText(/too many/i)).toBeTruthy())
    expect(calls).toBe(1) // no retry against a rate limit
  })

  it('shows the tel: fallback when a phone number is provided and the failure persists', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: false, reason: 'error' })} emergencyPhoneNumber="+911234567890" />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByText(/call emergency/i)).toBeTruthy())
  })

  it('hides the tel: fallback when no phone number is provided', async () => {
    await render(<SOSButton enabled onTrigger={async () => ({ ok: false, reason: 'error' })} />)
    await fireEvent.press(screen.getByLabelText('Emergency SOS, double tap to send alert'))
    await waitFor(() => expect(screen.getByText(/SOS not sent/i)).toBeTruthy())
    expect(screen.queryByText(/call emergency/i)).toBeNull()
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @ocar/mobile-shared test:ui SOSButton`
Expected: FAIL — `./SOSButton` doesn't exist yet.

- [ ] **Step 5: Implement `SOSButton.tsx`**

```tsx
// packages/mobile-shared/src/ui/SOSButton.tsx
import { useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { colors, radii, shadows, spacing, typography } from '../theme/tokens'

export type SOSTriggerResult = { ok: true } | { ok: false; reason: 'rate_limited' | 'error' }

export type SOSButtonProps = {
  enabled: boolean
  onTrigger: () => Promise<SOSTriggerResult>
  emergencyPhoneNumber?: string | null
}

type FailureState = null | { reason: 'rate_limited' | 'error' }

export function SOSButton({ enabled, onTrigger, emergencyPhoneNumber }: SOSButtonProps) {
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<FailureState>(null)
  const [canCall, setCanCall] = useState(false)
  const pulse = useSharedValue(1)

  if (!enabled) return null

  async function handlePress() {
    setSending(true)
    setFailure(null)
    const first = await onTrigger()
    if (first.ok) {
      setSending(false)
      return
    }
    if (first.reason === 'rate_limited') {
      setSending(false)
      setFailure({ reason: 'rate_limited' })
      return
    }
    // One automatic retry, only for a plain error -- never for rate_limited.
    const retry = await onTrigger()
    setSending(false)
    if (retry.ok) return
    setFailure({ reason: retry.reason })
    if (emergencyPhoneNumber) {
      Linking.canOpenURL(`tel:${emergencyPhoneNumber}`).then(setCanCall)
    }
  }

  function handleCall() {
    if (emergencyPhoneNumber) Linking.openURL(`tel:${emergencyPhoneNumber}`)
  }

  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }))

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View style={pulseStyle}>
        <Pressable
          onPress={handlePress}
          disabled={sending}
          hitSlop={8}
          accessible
          accessibilityLabel="Emergency SOS, double tap to send alert"
          accessibilityRole="button"
          style={({ pressed }) => [styles.circle, pressed ? styles.pressed : null]}
          onPressIn={() => {
            pulse.value = withRepeat(withSequence(withTiming(1.02, { duration: 1500 }), withTiming(1, { duration: 1500 })), -1, true)
          }}
        >
          <Text style={styles.icon}>SOS</Text>
        </Pressable>
      </Animated.View>

      {failure ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.failurePill}>
          <Text style={styles.failureText}>
            {failure.reason === 'rate_limited' ? 'Too many alerts sent. Contact support if this is urgent.' : 'SOS not sent — tap to retry'}
          </Text>
          {failure.reason === 'error' ? (
            <Pressable onPress={handlePress} hitSlop={8}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}

      {failure?.reason === 'error' && emergencyPhoneNumber && canCall ? (
        <Pressable onPress={handleCall} style={[styles.callPill, !canCall ? styles.callPillFull : null]}>
          <Text style={styles.callText}>Call emergency contact</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', bottom: spacing.xl, right: spacing.md, zIndex: 10, alignItems: 'flex-end', gap: spacing.xs },
  circle: {
    width: 56,
    height: 56,
    borderRadius: radii.full,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.buttonPrimary,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  icon: { ...typography.label, color: colors.inkInverse, fontWeight: '700' },
  failurePill: {
    backgroundColor: colors.errorLight,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 220,
  },
  failureText: { ...typography.caption, color: colors.error, flexShrink: 1 },
  retryText: { ...typography.label, color: colors.error, fontWeight: '700' },
  callPill: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
  },
  callPillFull: { alignSelf: 'stretch' },
  callText: { ...typography.label, color: colors.ink900 },
})
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @ocar/mobile-shared test:ui SOSButton`
Expected: PASS, all 7 tests. (The `canCall` gating in the test for "hides the tel: fallback when no phone number is provided" already passes since `emergencyPhoneNumber` is undefined and `Linking.canOpenURL` is never called; the "shows the tel: fallback" test needs `Linking.canOpenURL` mocked to resolve `true` — `jest-expo`'s RN mock returns `Promise.resolve(true)` for `Linking.canOpenURL` by default, so no extra mock setup is required, but confirm this by running the test before assuming it.)

- [ ] **Step 7: Export from the package index**

```typescript
// packages/mobile-shared/src/ui/index.ts — add this line:
export * from './SOSButton'
```

- [ ] **Step 8: `tsc --noEmit` clean on all three affected packages**

Run: `pnpm --filter @ocar/mobile-shared typecheck && pnpm --filter driver-mobile typecheck && pnpm --filter rider-mobile typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/mobile-shared/package.json packages/mobile-shared/src/ui/SOSButton.tsx packages/mobile-shared/src/ui/SOSButton.test.tsx packages/mobile-shared/src/ui/index.ts apps/driver-mobile/src/features/active-ride/safety-api.ts apps/rider-mobile/src/features/safety/api.ts
git commit -m "feat(mobile-shared): add SOSButton with retry/rate-limit/tel: fallback handling"
```

---

### Task 5: `CancelSheet` component (shared shell, role-aware reasons)

**Backend contract (verified):** `POST /api/v1/rides/:id/cancel` (rider) and `POST /api/v1/rides/:id/cancel-driver` (driver) are separate existing endpoints (`api/src/modules/rides/rides.routes.ts:214,223`) that already apply fee/penalty/re-broadcast policy server-side — this component sends the reason code and shows whatever the server returns; it has no policy logic of its own.

**Files:**
- Create: `packages/mobile-shared/src/ui/CancelSheet.tsx`
- Create: `packages/mobile-shared/src/ui/CancelSheet.test.tsx`
- Modify: `packages/mobile-shared/src/ui/index.ts`

**Interfaces:**
- Consumes: `colors`, `gradientPrimary`, `buttonRadius`, `radii`, `spacing`, `typography`, `shadows` from `../theme/tokens`.
- Produces:
  ```typescript
  export type CancelReason = { code: string; label: string }
  export type CancelSheetProps = {
    visible: boolean
    reasons: CancelReason[]          // caller supplies role-correct list
    onClose: () => void
    onConfirm: (reasonCode: string) => Promise<void>
  }
  ```
  A later stage-2 task renders this with driver-mobile's reasons (`passenger_not_found`, `passenger_no_show`, `rider_requested`, `vehicle_breakdown`, `wrong_booking`, `emergency`, `other` — confirmed at `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx:691-698`) and calls `cancelRideAsDriver`; rider-mobile keeps its own existing `BEFORE_REASONS`/`AFTER_REASONS` unchanged (this new shared component supersedes rider-mobile's app-local `CancelSheet.tsx` in a later stage's task, not this one).

- [ ] **Step 1: Write the failing test**

**Reminder: RTL v14's `render`/`fireEvent` are async — every call is `await`ed
below (see Task 1's correction note for why this is required, not stylistic).**

```tsx
// packages/mobile-shared/src/ui/CancelSheet.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native'
import { CancelSheet } from './CancelSheet'

const REASONS = [
  { code: 'changed_mind', label: 'Changed my mind' },
  { code: 'emergency', label: 'Emergency' },
]

describe('CancelSheet', () => {
  it('renders nothing when not visible', async () => {
    await render(<CancelSheet visible={false} reasons={REASONS} onClose={jest.fn()} onConfirm={jest.fn()} />)
    expect(screen.queryByText('Changed my mind')).toBeNull()
  })

  it('renders the supplied reasons when visible', async () => {
    await render(<CancelSheet visible reasons={REASONS} onClose={jest.fn()} onConfirm={jest.fn()} />)
    expect(screen.getByText('Changed my mind')).toBeTruthy()
    expect(screen.getByText('Emergency')).toBeTruthy()
  })

  it('confirm button is disabled until a reason is selected', async () => {
    await render(<CancelSheet visible reasons={REASONS} onClose={jest.fn()} onConfirm={jest.fn()} />)
    const confirm = screen.getByText('Confirm cancellation')
    expect(confirm.props.accessibilityState?.disabled ?? confirm.parent?.props.accessibilityState?.disabled).toBeTruthy()
  })

  it('selecting a reason and confirming calls onConfirm with the reason code', async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    await render(<CancelSheet visible reasons={REASONS} onClose={jest.fn()} onConfirm={onConfirm} />)
    await fireEvent.press(screen.getByText('Emergency'))
    await fireEvent.press(screen.getByText('Confirm cancellation'))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('emergency'))
  })

  it('shows a timeout message and re-enables dismiss if the request never resolves within 10s', async () => {
    jest.useFakeTimers()
    const onClose = jest.fn()
    const onConfirm = () => new Promise<void>(() => {}) // never resolves
    await render(<CancelSheet visible reasons={REASONS} onClose={onClose} onConfirm={onConfirm} />)
    await fireEvent.press(screen.getByText('Changed my mind'))
    await fireEvent.press(screen.getByText('Confirm cancellation'))
    jest.advanceTimersByTime(10_500)
    await waitFor(() => expect(screen.getByText(/taking longer than expected/i)).toBeTruthy())
    jest.useRealTimers()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @ocar/mobile-shared test:ui CancelSheet`
Expected: FAIL — `./CancelSheet` doesn't exist.

- [ ] **Step 3: Implement `CancelSheet.tsx`**

```tsx
// packages/mobile-shared/src/ui/CancelSheet.tsx
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { buttonRadius, colors, gradientPrimary, radii, shadows, spacing, typography } from '../theme/tokens'

export type CancelReason = { code: string; label: string }

export type CancelSheetProps = {
  visible: boolean
  reasons: CancelReason[]
  onClose: () => void
  onConfirm: (reasonCode: string) => Promise<void>
}

const SUBMIT_TIMEOUT_MS = 10_000

export function CancelSheet({ visible, reasons, onClose, onConfirm }: CancelSheetProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible) {
      setSelected(null)
      setSubmitting(false)
      setTimedOut(false)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [visible])

  if (!visible) return null

  async function handleConfirm() {
    if (!selected || submitting) return
    setSubmitting(true)
    setTimedOut(false)
    timeoutRef.current = setTimeout(() => {
      setSubmitting(false)
      setTimedOut(true)
    }, SUBMIT_TIMEOUT_MS)
    await onConfirm(selected)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setSubmitting(false)
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => !submitting && onClose()}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !submitting && onClose()} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Why are you cancelling?</Text>

          <View style={styles.reasonList}>
            {reasons.map((r) => {
              const active = selected === r.code
              return (
                <Pressable
                  key={r.code}
                  onPress={() => setSelected(r.code)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[styles.reasonRow, active ? styles.reasonRowActive : null]}
                >
                  <Text style={[styles.reasonLabel, active ? styles.reasonLabelActive : null]}>{r.label}</Text>
                </Pressable>
              )
            })}
          </View>

          {timedOut ? <Text style={styles.timeoutText}>Taking longer than expected — try again.</Text> : null}

          <Pressable onPress={handleConfirm} disabled={!selected || submitting} style={styles.confirmWrap}>
            <LinearGradient colors={gradientPrimary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.confirmBtn, shadows.buttonPrimary, !selected ? styles.disabled : null]}>
              {submitting ? <ActivityIndicator color={colors.inkInverse} /> : <Text style={styles.confirmText}>Confirm cancellation</Text>}
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.4)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    paddingBottom: Math.max(spacing.lg, spacing.md),
  },
  handle: { width: 32, height: 4, borderRadius: radii.full, backgroundColor: colors.border, alignSelf: 'center', marginVertical: spacing.sm },
  title: { ...typography.title, color: colors.ink900, marginBottom: spacing.md },
  reasonList: { gap: spacing.md, marginBottom: spacing.md },
  reasonRow: { minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderLight, justifyContent: 'center', paddingHorizontal: spacing.md },
  reasonRowActive: { borderColor: colors.primary, backgroundColor: colors.primarySubtle },
  reasonLabel: { ...typography.body, color: colors.ink900 },
  reasonLabelActive: { color: colors.primary, fontWeight: '600' },
  timeoutText: { ...typography.caption, color: colors.error, marginBottom: spacing.sm },
  confirmWrap: { borderRadius: buttonRadius, overflow: 'hidden' },
  confirmBtn: { height: 48, borderRadius: buttonRadius, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  confirmText: { ...typography.body, color: colors.inkInverse, fontWeight: '600' },
})
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @ocar/mobile-shared test:ui CancelSheet`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Export from the package index**

```typescript
// packages/mobile-shared/src/ui/index.ts — add this line:
export * from './CancelSheet'
```

- [ ] **Step 6: `tsc --noEmit` clean**

Run: `pnpm --filter @ocar/mobile-shared typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/mobile-shared/src/ui/CancelSheet.tsx packages/mobile-shared/src/ui/CancelSheet.test.tsx packages/mobile-shared/src/ui/index.ts
git commit -m "feat(mobile-shared): add shared CancelSheet with 10s submit timeout"
```

---

## Discovery worth flagging before Stage 2 starts

While writing this plan's real API contract for Task 4, I read `sos.service.ts` directly and found the design doc's "reused across stages 2, 4, and 5" framing needs one correction: **SOS cannot be triggered while ride status is `accepted`** (backend returns 400 `RIDE_NOT_ACTIVE`) — only `driver_arrived`/`in_progress`/`returning`. Stage 2 ("en route to pickup") spans mostly the `accepted` status before the driver arrives. This plan's `SOSButton` already handles this correctly via its `enabled` prop (caller passes `enabled={false}` during `accepted`), but whichever stage-2 task renders the button must compute `enabled` from the live ride status, not just "stage 2 always shows SOS" — that would 400 on every press until the driver arrives.

## Self-Review

**Spec coverage:** Stage 0's five bullet points (test setup, SOSButton, CancelSheet, reducer widening, position store, backend-contract spike) are each covered by a task above. The backend-contract spike itself was already completed during `/plan-eng-review` (verified: `cancel-driver`, `returning` socket push, `stop:added` all live) — no separate task needed, cited inline in Task 4/5 instead.

**Placeholder scan:** No TBD/TODO markers; every step has real code, real file paths, real commands.

**Dependency check:** caught `react-native-reanimated` used in `SOSButton.tsx` but undeclared in `packages/mobile-shared/package.json` — fixed by adding it as a peer dependency (Task 4, Step 0) rather than a direct dependency, since both apps already carry their own pinned copy and this package shouldn't bundle a second one. Also verified all four Task 1 test-dependency versions directly against the npm registry rather than guessing — the first draft's `@testing-library/react-native@^12.5.0` was stale (registry latest is `14.0.1`); corrected before this plan was finalized.

**Type consistency:** `SOSTriggerResult` is defined once in `SOSButton.tsx` and imported by both apps' `safety-api.ts` files (Task 4, Steps 1-2) rather than redefined — checked for drift risk and closed it by importing from `@ocar/mobile-shared` in both places. `ActiveRideReducerState`'s `rideType: string` (Task 2) matches `RideDetail.rideType: string`'s type exactly (both plain `string`, not a narrower union) — confirmed against `packages/mobile-shared/src/api/types.ts:74`.
