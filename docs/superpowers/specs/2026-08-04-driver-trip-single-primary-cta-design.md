# Driver active-ride screen: single dynamic primary swipe

## Problem

`TripInProgress.tsx` (driver app) shows two live swipe-to-confirm controls at
once whenever a multi-stop ride has pending stops:

1. **"Slide to complete trip"** — pinned above the sheet's collapse anchor
   (`TripInProgress.tsx:601-613`), so it's *always visible*, even mid-route
   with stops still pending.
2. **The actual per-stop swipe** ("Slide to confirm stop N" / "Slide to start
   wait clock" at `764-775`, or "Slide to start next leg" inside the waiting
   meter at `663-669`) — sits *below* the collapse anchor, inside the
   fade-away region. If the driver collapses the sheet to see more map (the
   documented purpose of that gesture), this control disappears entirely and
   "Slide to complete trip" is the only swipe left on screen.

This violates the industry-standard pattern (Uber driver app: exactly one
live swipe control at a time — "Confirm Stop" mid-route, auto-advances nav,
then "Complete"/"End Trip" only at the final destination) and creates a real
risk: a driver could swipe "complete trip" while stops remain un-visited.

**This is not just a UX ambiguity.** `verifyEndOTP` (`api/src/modules/rides/
rides.service.ts:1310`) only checks `ride.status === 'in_progress'` — it has
no check for pending stops. Nothing in the backend today prevents a ride from
being marked `completed` while a stop still has `status = 'pending'`.

## Design

### 1. Collapse to one state-driven swipe (frontend)

The swipe control currently pinned above the fold (`601-613`) becomes the
**only** primary action for the whole screen. Its label and `onConfirm`
branch on the same `currentStop` / `waitingStop` values already computed in
the component (`194-219`) — no new state:

| Condition | Label | Action |
|---|---|---|
| `currentStop` exists, one-way and not yet arrived, or non-one-way | `"Slide to confirm stop {n}"` (one-way: `"Slide to start wait clock"`) | `handleStopAction(seq, 'reached')` / `handleStopArrived(seq)` |
| `waitingStop` set (one-way, arrived, waiting out the free window) | `"Slide to start next leg"` | `handleStopAction(seq, 'reached')` |
| Neither (`currentStop == null`) | `"Slide to complete trip"` | opens end-OTP sheet (unchanged) |

The two swipes this replaces (`663-669` inside the waiting-meter card, and
`764-775` in the below-fold section) are deleted — their actions are now
served by the one control above. The waiting meter's live countdown
(`640-670`) stays below the fold as read-only info; only the actionable
swipe moves.

Per-stop **Skip** stays exactly where it is today — a secondary text control
in the itinerary checklist, below the fold. It's a deliberate, infrequent
action; keeping it a slight reach (expand sheet → tap Skip) is intentional,
not a regression, and matches how "End trip early" is already gated behind
extra confirmation.

Pulsing highlight (`animate={{ scale: [1, 1.03, 1] }}` at `601-604`) carries
over unchanged, but its trigger condition drops the `!currentStop` guard
since the control it decorates is now always the "current true action," not
specifically the complete-trip variant — it should still only pulse when
`nearTarget` is true (driver has physically arrived at whatever `dropPos`
currently represents: next stop or final drop).

### 2. Backend guard against premature completion

`verifyEndOTP` gains one check, immediately after the existing
`ride.status !== 'in_progress'` guard: if any row in `ride_stops` for this
ride has `status = 'pending'`, reject with 409 (same pattern as the existing
"Ride not in progress" throw). Reached and skipped stops don't block —
only stops the driver never acted on at all.

This makes the guarantee hold regardless of what the frontend renders: a
trip with unresolved stops cannot be completed, full stop.

## Out of scope (considered, deferred)

- **Promoting the itinerary checklist (with all stops + Skip) above the
  fold.** Discussed and declined — the single primary swipe already
  surfaces the one action that matters at any moment; the full itinerary is
  reference info, correctly tucked below the fold.
- **Changing `handleStopAction`/`handleStopArrived`/`markStopStatus` API
  contracts.** Unchanged — this is a render-branch consolidation, not a data
  flow change.
- **Rental/round-trip specific wait-timer treatment.** Out of scope; those
  ride types don't have a wait clock at all today (one-way only), unchanged
  by this design.

## Files touched

- `apps/driver/src/pages/ActiveRide/TripInProgress.tsx` — collapse three
  swipe render branches into one state-driven control (~lines 598-775).
- `api/src/modules/rides/rides.service.ts` — add pending-stops guard to
  `verifyEndOTP` (~line 1321-1323).

## Testing

No new business logic beyond one added guard clause. Manual verification:
- One-way ride, 2 stops: confirm the single swipe reads "Slide to confirm
  stop 1" → after arriving, "Slide to start wait clock" → after wait starts,
  "Slide to start next leg" → after stop 2 confirmed → "Slide to complete
  trip", at every point with the sheet both expanded and collapsed.
- Round-trip/rental ride with stops: same single-swipe progression minus the
  wait-clock states (they go straight `pending` → `reached`).
- Attempt to call the end-OTP endpoint directly (e.g. via API client) while a
  stop is still `pending` — confirm 409 rejection.
- Zero-stop ride: swipe reads "Slide to complete trip" from the start, same
  as today (regression check).
