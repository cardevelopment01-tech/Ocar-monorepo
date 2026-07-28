# P1 Driver-Side Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 of the 8 driver-side P1 findings from `docs/superpowers/research/2026-07-28-ride-flow-ux-audit.md`. Scope is driver-app-only (no user-app changes) per explicit instruction.

**Descoped (documented, not built — see "Descoped items" below):**
- Pickup-note field — requires the *rider* to type a note in the user app; out of scope.
- Cancellation-rate consequence disclosure — no cancellation-rate/acceptance-rate tracking exists anywhere in the codebase (verified via full grep); showing a consequence message with no real number behind it would be fabricated UI. Needs a tracking feature first, not a UI fix.
- Rider-phone masked calling — telephony masking service isn't provisioned yet (per instruction); the raw-`tel:`-link finding stays as-is until that infra exists.

**Architecture:** All five fixes are small, self-contained, and reuse data or components that already exist:
- **CollectCash sanity check**: add a same-screen soft-confirm step when the typed amount deviates from the fare by more than 20% — no new component, just a second state in the existing sheet.
- **SwipeToConfirm error surfacing**: the component already detects "didn't advance" (stays mounted past the reset timer) — it just doesn't tell the driver why. Add an inline message on that existing path, no change to any caller.
- **Home offline-toggle guard**: one added condition in the existing `handleToggle`.
- **Toast/incoming-request occlusion**: `NotificationToast`'s auto-dismiss timer doesn't know about `incomingRequest` state. Gate the existing timer on it.
- **Live fare visibility**: `markStopStatus`'s API response already returns `stop_charge_applied`/`wait_charge` per stop (computed server-side) — the Zustand store's `updateStop`/`arriveStop` actions just discard them. Thread them through and sum wait charges already accrued on completed stops into a new line in the trip sheet. This is exposing already-computed data, not building a live meter.

**Tech Stack:** Vite + React 19 + Zustand + Framer Motion (apps/driver). No backend changes in this plan — everything needed already exists server-side.

**Design system:** Ocar driver app — Inter, primary `#4F46E5`, product register (see `PRODUCT.md`/`DESIGN.md` via the `impeccable` skill). Product UI rules apply: no decorative motion, standard component vocabulary, 150–250ms transitions, WCAG AA (44×44 touch targets, 4.5:1 text contrast), color never the sole state indicator.

---

## Task 1: CollectCash — sanity-check the custom collected amount

**Files:**
- Modify: `apps/driver/src/pages/ActiveRide/CollectCash.tsx`

**Problem:** `confirmCustomAmount` (lines 37-41) accepts any non-negative float and submits immediately — a fat-fingered ₹500000 goes straight to the server with zero friction.

- [ ] **Step 1: Add deviation state and a threshold constant**

Add near the top of the file, after the existing `fmt` helper:

```typescript
const DEVIATION_CONFIRM_THRESHOLD = 0.2 // 20% off the quoted fare needs a second tap
```

Add state alongside the existing `customAmount`/`submitting`/`error`:

```typescript
  const [pendingConfirm, setPendingConfirm] = useState(false)
```

- [ ] **Step 2: Rewrite `confirmCustomAmount` to require a second tap on large deviations**

Replace:

```typescript
  function confirmCustomAmount() {
    const parsed = parseFloat(customAmount)
    if (!Number.isFinite(parsed) || parsed < 0) return
    void submit({ collectedAmount: parsed })
  }
```

with:

```typescript
  function confirmCustomAmount() {
    const parsed = parseFloat(customAmount)
    if (!Number.isFinite(parsed) || parsed < 0) return
    const deviates = fare > 0 && Math.abs(parsed - fare) / fare > DEVIATION_CONFIRM_THRESHOLD
    if (deviates && !pendingConfirm) {
      setPendingConfirm(true)
      return
    }
    void submit({ collectedAmount: parsed })
  }
```

- [ ] **Step 3: Reset `pendingConfirm` whenever the typed amount changes, and update the button copy**

Find the amount `<input>`'s `onChange` (currently `onChange={(e) => setCustomAmount(e.target.value)}`) and change it to also clear the pending state:

```typescript
                onChange={(e) => { setCustomAmount(e.target.value); setPendingConfirm(false) }}
```

Find the confirm button:

```tsx
              <button
                type="button"
                onClick={confirmCustomAmount}
                disabled={submitting || customAmount === ''}
                className="w-full py-3 rounded-2xl bg-primary text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 mb-3"
              >
                {submitting ? 'Saving…' : `Confirm ₹${customAmount || '0'} collected`}
              </button>
```

Replace with a version that shows a warning line and changes its own label when a large deviation is pending confirmation:

```tsx
              {pendingConfirm && (
                <p className="text-status-error text-xs text-center mb-2">
                  That's well off the ₹{fmt(fare)} fare — tap again to confirm ₹{customAmount}.
                </p>
              )}
              <button
                type="button"
                onClick={confirmCustomAmount}
                disabled={submitting || customAmount === ''}
                className="w-full py-3 rounded-2xl bg-primary text-white text-sm font-semibold active:scale-95 transition-transform disabled:opacity-60 mb-3"
              >
                {submitting
                  ? 'Saving…'
                  : pendingConfirm
                  ? `Yes, confirm ₹${customAmount || '0'}`
                  : `Confirm ₹${customAmount || '0'} collected`}
              </button>
```

- [ ] **Step 4: Also reset `pendingConfirm` when the sheet is dismissed and reopened**

Find `onClick={() => setSheetOpen(true)}` (the "Different amount / not collected" button) and change it to also clear stale state from a prior open:

```typescript
        onClick={() => { setSheetOpen(true); setPendingConfirm(false) }}
```

- [ ] **Step 5: Verify**

Run `cd apps/driver && npx tsc --noEmit` — must be clean.

Manual check (no test framework in this app): with the dev server running, open the cash-collection screen, type an amount more than 20% off the shown fare, tap "Confirm" — expect the warning line + button label change, no submission yet. Tap again — expect it submits. Type an amount within 20% — expect it submits on the first tap, no warning.

- [ ] **Step 6: Commit**

```bash
git add apps/driver/src/pages/ActiveRide/CollectCash.tsx
git commit -m "fix(driver): require a second tap when collected cash deviates >20% from the fare"
```

---

## Task 2: SwipeToConfirm — surface an error when a confirm silently fails to advance

**Files:**
- Modify: `apps/driver/src/components/ui/SwipeToConfirm.tsx`

**Problem:** When `onConfirm()` fires but the screen doesn't advance (the network call inside failed and the caller swallowed the error — every current caller does this, e.g. `handleStopAction`'s `catch { /* stays pending, driver can retry */ }`), the handle silently springs back to start after 1800ms with zero explanation. The driver has no idea anything went wrong.

**Design note:** don't change the `onConfirm: () => void` contract — every existing caller (`TripInProgress.tsx`, `CollectCash.tsx`) already handles its own errors internally and just doesn't re-throw. The only observable signal available to this component is "did I get unmounted/reset before the reset timer fired." Use that.

- [ ] **Step 1: Add a "showError" state and render an inline message on the reset-without-advance path**

Replace:

```typescript
export default function SwipeToConfirm({ label, onConfirm, disabled = false, color = '#4F46E5' }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [maxX, setMaxX] = useState(0)
  const [done, setDone] = useState(false)
```

with:

```typescript
export default function SwipeToConfirm({ label, onConfirm, disabled = false, color = '#4F46E5' }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [maxX, setMaxX] = useState(0)
  const [done, setDone] = useState(false)
  const [showError, setShowError] = useState(false)
```

Replace the `handleDragEnd` reset branch:

```typescript
      // If the trip didn't advance (this component still mounted), let the driver retry.
      resetTimer.current = setTimeout(() => {
        setDone(false)
        animate(x, 0, { type: 'spring', stiffness: 500, damping: 44 })
      }, 1800)
```

with:

```typescript
      // If the trip didn't advance (this component still mounted), let the driver
      // retry — and say why, instead of silently reverting with no explanation.
      resetTimer.current = setTimeout(() => {
        setDone(false)
        setShowError(true)
        animate(x, 0, { type: 'spring', stiffness: 500, damping: 44 })
      }, 1800)
```

Add a reset of `showError` at the start of a fresh drag — in `handleDragEnd`, right after the existing `if (done || maxX === 0) return` guard is where the threshold check happens; instead, clear it where a new drag begins. This component doesn't currently have a drag-start handler, so clear it at the top of `handleDragEnd` before the threshold check:

```typescript
  function handleDragEnd() {
    if (done || maxX === 0) return
    setShowError(false)
    if (x.get() >= maxX * THRESHOLD) {
```

- [ ] **Step 2: Render the message below the track**

The component currently returns a single `<div ref={trackRef} ...>`. Wrap it so an error line can render underneath without changing the track's own layout:

Replace the final `return (...)` block's outer structure — currently:

```tsx
  return (
    <div
      ref={trackRef}
      className="relative w-full rounded-full overflow-hidden select-none"
      style={{ height: HANDLE, background: '#EEF2FF', opacity: disabled ? 0.5 : 1, padding: PAD }}
    >
```
… (existing children) …
```tsx
    </div>
  )
}
```

with (wrap in a fragment, add the message after the existing track div, keep every existing child of the track div exactly as-is):

```tsx
  return (
    <>
      <div
        ref={trackRef}
        className="relative w-full rounded-full overflow-hidden select-none"
        style={{ height: HANDLE, background: '#EEF2FF', opacity: disabled ? 0.5 : 1, padding: PAD }}
      >
        {/* ...existing children unchanged... */}
      </div>
      {showError && (
        <p className="text-status-error text-xs text-center mt-1.5">
          Couldn't confirm — check your connection and try again.
        </p>
      )}
    </>
  )
}
```

- [ ] **Step 3: Verify**

Run `cd apps/driver && npx tsc --noEmit` — must be clean.

Manual check: on a screen using `SwipeToConfirm` (e.g. `NavigateToPickup`'s "Arrived" or a stop confirm in `TripInProgress`), simulate a network failure (devtools offline mode), swipe — expect the handle to revert after ~1.8s AND show "Couldn't confirm — check your connection and try again." beneath the track. Re-enable network, swipe again — expect it advances normally with no error line (component fully unmounts/navigates away before the reset timer, so `showError` never sets in the success path).

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/components/ui/SwipeToConfirm.tsx
git commit -m "fix(driver): SwipeToConfirm shows an error instead of silently reverting on a failed confirm"
```

---

## Task 3: Home — block going offline while a trip is active

**Files:**
- Modify: `apps/driver/src/pages/Home.tsx`

**Problem:** `handleToggle`'s offline branch (lines 146-148) only checks `isOnline`, never `activeRide`. An edge case (session-restore race, rapid double-tap) could let a driver open the offline-confirm sheet — and if confirmed, go offline — mid-trip.

- [ ] **Step 1: Guard the offline branch**

Replace:

```typescript
  const handleToggle = () => {
    if (!isOnline) {
      if (checkingVerification) return // already awaiting a status check from a prior tap
      setCheckingVerification(true)
      driverVerificationApi.getStatus()
        .then((status) => {
          navigate(status.complete ? '/go-online/mode' : '/daily-verification')
        })
        .catch(() => navigate('/go-online/mode')) // status check failed — don't block going online on a network hiccup; goOnline() itself still enforces the gate server-side
        .finally(() => setCheckingVerification(false))
    } else {
      setShowOfflineConfirm(true)
    }
  }
```

with:

```typescript
  const handleToggle = () => {
    if (!isOnline) {
      if (checkingVerification) return // already awaiting a status check from a prior tap
      setCheckingVerification(true)
      driverVerificationApi.getStatus()
        .then((status) => {
          navigate(status.complete ? '/go-online/mode' : '/daily-verification')
        })
        .catch(() => navigate('/go-online/mode')) // status check failed — don't block going online on a network hiccup; goOnline() itself still enforces the gate server-side
        .finally(() => setCheckingVerification(false))
    } else if (activeRide) {
      // A driver mid-fare shouldn't be able to exit the online session at all —
      // resumeRoute's banner is already the priority action on this screen when
      // activeRide is set, so this is a defensive guard for the edge case where
      // the toggle is still reachable (e.g. a session-restore race).
      navigate(resumeRoute ?? '/', { replace: true })
    } else {
      setShowOfflineConfirm(true)
    }
  }
```

`activeRide` and `resumeRoute` are already in scope in this component (`activeRide` from `useRideStore`, `resumeRoute` computed further down from `activeRide.status` — both already exist in the current file, no new imports needed).

- [ ] **Step 2: Verify**

Run `cd apps/driver && npx tsc --noEmit` — must be clean.

Manual check: with an active ride in the store (simulate via the resume-trip banner scenario — refresh mid-trip so `resumeRoute` is set) and the online toggle somehow still tappable, tapping "go offline" should route back into the active ride instead of opening the offline-confirm sheet.

- [ ] **Step 3: Commit**

```bash
git add apps/driver/src/pages/Home.tsx
git commit -m "fix(driver): block going offline while a trip is active"
```

---

## Task 4: NotificationToast — don't let a toast expire unseen behind the incoming-request card

**Files:**
- Modify: `apps/driver/src/components/ui/NotificationToast.tsx`

**Problem:** `TripRequestCard`'s full-screen overlay renders above `NotificationToast` (higher z-index), but `NotificationToast`'s 4-second auto-dismiss timer keeps running underneath, unseen. By the time the request card closes (accepted/declined/expired), the toast may have already dismissed.

- [ ] **Step 1: Read `incomingRequest` from the ride store and gate the auto-dismiss timer on it**

Add the import:

```typescript
import { useRideStore } from '@/store/useRideStore'
```

Replace:

```typescript
export default function NotificationToast() {
  const { toast, dismissToast, openSheet } = useNotificationsStore()
  const prefersReducedMotion = useReducedMotion()
  const navigate = useNavigate()

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismissToast, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [toast, dismissToast])
```

with:

```typescript
export default function NotificationToast() {
  const { toast, dismissToast, openSheet } = useNotificationsStore()
  const incomingRequest = useRideStore(s => s.incomingRequest)
  const prefersReducedMotion = useReducedMotion()
  const navigate = useNavigate()

  // Don't let the toast's countdown run out while it's hidden behind the
  // full-screen incoming-request overlay — restart the dismiss window once
  // the request clears, so the driver gets a real 4s to see it.
  useEffect(() => {
    if (!toast || incomingRequest) return
    const t = setTimeout(dismissToast, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [toast, incomingRequest, dismissToast])
```

- [ ] **Step 2: Verify**

Run `cd apps/driver && npx tsc --noEmit` — must be clean.

Manual check: trigger a notification toast, then immediately trigger an incoming ride request before 4s elapses — expect the toast to still be visible/dismissable once the request card closes, not already gone.

- [ ] **Step 3: Commit**

```bash
git add apps/driver/src/components/ui/NotificationToast.tsx
git commit -m "fix(driver): pause the notification toast's dismiss timer while a ride request overlay is showing"
```

---

## Task 5: Surface accrued wait charges during the trip (data already computed server-side, currently discarded)

**Files:**
- Modify: `apps/driver/src/store/useRideStore.ts`
- Modify: `apps/driver/src/pages/ActiveRide/TripInProgress.tsx`

**Problem:** `markStopStatus`'s API response (`apps/driver/src/lib/ride-api.ts`, `RideStop` type) already includes `stop_charge_applied`/`wait_charge` per stop — computed server-side, from real elapsed-wait timestamps. `useRideStore`'s `RideStop` interface and its `updateStop`/`arriveStop` actions don't have or persist these fields, so this real data is fetched and thrown away. The driver currently has zero visibility into wait charges accruing on stops they've already passed — only the *current* stop being waited at shows a live clock (`waitingStop` banner), and that number resets to invisible the moment they move to the next stop.

**Scope discipline:** this task does NOT attempt to reconstruct a full "live running fare" (base + distance + time + surge) — that would require either trusting unaudited client GPS math or a real backend live-fare endpoint, neither of which exists and both of which are bigger than a P1 UI fix. This task surfaces the one number that's already server-computed and already being fetched: wait charges accrued on completed/current stops.

- [ ] **Step 1: Add the two fields to the store's `RideStop` interface**

In `apps/driver/src/store/useRideStore.ts`, replace:

```typescript
export interface RideStop {
  id: string
  sequence: number
  lat: number
  lng: number
  address: string | null
  status: 'pending' | 'reached' | 'skipped'
  arrived_at: string | null
  reached_at: string | null
}
```

with:

```typescript
export interface RideStop {
  id: string
  sequence: number
  lat: number
  lng: number
  address: string | null
  status: 'pending' | 'reached' | 'skipped'
  arrived_at: string | null
  reached_at: string | null
  stop_charge_applied: string | null
  wait_charge: string | null
}
```

- [ ] **Step 2: Thread the fields through `updateStop` and `arriveStop`**

Replace:

```typescript
  updateRideStatus:  (status: string) => void
  setFare:           (fare: number) => void
  setRideStartedAt:  (ts: string) => void
  arriveStop:        (sequence: number, arrivedAt: string | null) => void
  updateStop:        (sequence: number, status: 'reached' | 'skipped', reachedAt: string | null) => void
```

with:

```typescript
  updateRideStatus:  (status: string) => void
  setFare:           (fare: number) => void
  setRideStartedAt:  (ts: string) => void
  arriveStop:        (sequence: number, arrivedAt: string | null, waitCharge?: string | null) => void
  updateStop:        (sequence: number, status: 'reached' | 'skipped', reachedAt: string | null, waitCharge?: string | null) => void
```

Replace the implementations:

```typescript
      arriveStop: (sequence, arrivedAt) =>
        set((s) => ({
          activeRide: s.activeRide ? {
            ...s.activeRide,
            stops: (s.activeRide.stops ?? []).map(stop =>
              stop.sequence === sequence ? { ...stop, arrived_at: arrivedAt } : stop
            ),
          } : null,
        })),

      updateStop: (sequence, status, reachedAt) =>
        set((s) => ({
          activeRide: s.activeRide ? {
            ...s.activeRide,
            stops: (s.activeRide.stops ?? []).map(stop =>
              stop.sequence === sequence ? { ...stop, status, reached_at: reachedAt } : stop
            ),
          } : null,
        })),
```

with:

```typescript
      arriveStop: (sequence, arrivedAt, waitCharge) =>
        set((s) => ({
          activeRide: s.activeRide ? {
            ...s.activeRide,
            stops: (s.activeRide.stops ?? []).map(stop =>
              stop.sequence === sequence
                ? { ...stop, arrived_at: arrivedAt, ...(waitCharge !== undefined ? { wait_charge: waitCharge } : {}) }
                : stop
            ),
          } : null,
        })),

      updateStop: (sequence, status, reachedAt, waitCharge) =>
        set((s) => ({
          activeRide: s.activeRide ? {
            ...s.activeRide,
            stops: (s.activeRide.stops ?? []).map(stop =>
              stop.sequence === sequence
                ? { ...stop, status, reached_at: reachedAt, ...(waitCharge !== undefined ? { wait_charge: waitCharge } : {}) }
                : stop
            ),
          } : null,
        })),
```

(Optional params so the two other places that call `updateStop`/`arriveStop` without a wait charge — if any — don't need changes. Check for other call sites before assuming; grep `updateStop(` and `arriveStop(` across `apps/driver/src` first.)

- [ ] **Step 3: Pass the real `wait_charge` from the API response at both call sites in `TripInProgress.tsx`**

Find:

```typescript
  async function handleStopAction(sequence: number, status: 'reached' | 'skipped') {
    if (!activeRide || stopActionPending !== null) return
    setStopActionPending(sequence)
    try {
      const res = await driverRideApi.markStopStatus(activeRide.id, sequence, status)
      updateStop(sequence, status, res.stop.reached_at)
    } catch { /* stays pending, driver can retry */ } finally {
      setStopActionPending(null)
    }
  }
```

Change the `updateStop` call to also pass `res.stop.wait_charge`:

```typescript
      updateStop(sequence, status, res.stop.reached_at, res.stop.wait_charge)
```

Find:

```typescript
  async function handleStopArrived(sequence: number) {
    if (!activeRide || stopActionPending !== null) return
    setStopActionPending(sequence)
    try {
      const res = await driverRideApi.markStopStatus(activeRide.id, sequence, 'arrived')
      arriveStop(sequence, res.stop.arrived_at)
    } catch { /* stays pending, driver can retry */ } finally {
      setStopActionPending(null)
    }
  }
```

Change the `arriveStop` call:

```typescript
      arriveStop(sequence, res.stop.arrived_at, res.stop.wait_charge)
```

- [ ] **Step 4: Sum accrued wait charges and show a line in the trip sheet**

In `TripInProgress.tsx`, near the existing `stops`/`currentStop` derivations, add:

```typescript
  const accruedWaitCharge = stops.reduce((sum, s) => sum + parseFloat(s.wait_charge ?? '0'), 0)
```

Find the mini status line (the one showing `activeRide?.fare`):

```tsx
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-text-secondary text-sm font-semibold truncate">
              {currentStop
                ? `Next: Stop ${currentStop.sequence}`
                : activeRide?.rideType === 'rental' ? 'Flexible route' : (activeRide?.drop ?? 'Destination')}
            </p>
            <p className="text-primary font-black text-base flex-shrink-0">₹{activeRide?.fare ?? 0}</p>
          </div>
```

Change to add a small wait-charge note beneath the fare figure when it's non-zero (only relevant for one-way rides — round-trip/rental wait is inside the hours package and never accrues `wait_charge`, matching the existing `isOneWay` convention already used elsewhere in this same file):

```tsx
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-text-secondary text-sm font-semibold truncate">
              {currentStop
                ? `Next: Stop ${currentStop.sequence}`
                : activeRide?.rideType === 'rental' ? 'Flexible route' : (activeRide?.drop ?? 'Destination')}
            </p>
            <div className="text-right flex-shrink-0">
              <p className="text-primary font-black text-base">₹{activeRide?.fare ?? 0}</p>
              {isOneWay && accruedWaitCharge > 0 && (
                <p className="text-[10px] font-semibold text-accent-orange">
                  +₹{accruedWaitCharge.toFixed(0)} wait so far
                </p>
              )}
            </div>
          </div>
```

- [ ] **Step 5: Verify**

Run `cd apps/driver && npx tsc --noEmit` — must be clean. Grep for any other callers of `updateStop`/`arriveStop` in `apps/driver/src` before finishing, to confirm the optional-param change didn't silently break a call site this plan didn't anticipate:

```bash
grep -rn "updateStop(\|arriveStop(" apps/driver/src
```

Manual check: run a one-way trip with a stop, let the free-wait window elapse at that stop (or reduce `STOP_FREE_WAIT_SECONDS` locally for testing), advance past it, then check a second stop or the drop-off leg — expect "+₹X wait so far" to now show next to the fare figure, reflecting the first stop's accrued wait charge.

- [ ] **Step 6: Commit**

```bash
git add apps/driver/src/store/useRideStore.ts apps/driver/src/pages/ActiveRide/TripInProgress.tsx
git commit -m "feat(driver): surface accrued wait charges during the trip instead of discarding server-computed data"
```

---

## Self-Review Notes

- **Spec coverage:** 5 of 8 driver-side P1 findings addressed; 3 explicitly descoped with reasons (pickup note needs user-app work, cancellation-rate has no backend data source, phone masking needs infra not yet provisioned).
- **Type consistency:** `RideStop.wait_charge`/`stop_charge_applied` (Task 5) are typed `string | null` matching the Postgres `NUMERIC` string-serialization convention already used everywhere else in this codebase (e.g. `commission_amount` in the P0 plan). `updateStop`/`arriveStop`'s new optional 4th param is backward-compatible with any caller not yet updated.
- **No placeholders:** every step has runnable code. No new dependencies, no new files, no schema/backend changes.
- **Ponytail check:** every fix is the smallest change that closes the actual gap — no new abstractions, no new components, reuses existing state/props/API responses throughout.
