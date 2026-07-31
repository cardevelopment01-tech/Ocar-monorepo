# Multi-stop ride flow: CTA consistency

## Problem

The user app's three ride-type flows (one-way, round-trip, rental) each implement
stop-adding independently, and their primary CTA buttons diverged over time:

1. **Label vocabulary differs for the same action.** `/round-trip` says
   "Choose your cab · {n}h round trip" / "Schedule your cab · …" while
   `/select-ride` (one-way and round-trip) and `/rental` say
   "Book {category} · ₹{fare}" / "Schedule {category} · ₹{fare}". These read as
   two different products.
2. **Stop-in-flight gating is inconsistent.** One-way disables the Book button
   on `/select-ride` while the detour route recomputes after a stop change
   (`detourPriced && (routingStops || routedDistanceKm == null)`). Round-trip's
   per-stop fee recompute never gates the button — it relies only on the
   generic `loading` flag, which isn't specifically tied to stop changes.
   Rental never gates on stops at all (by design — rental stops don't affect
   fare).
3. **`/search`'s "Add stops" pill is misleading.** It hints "set destination,
   add stops next" but there is no stop-adding UI on `/search` at all — stops
   are only addable later, per ride-type, on `/select-ride`, `/round-trip`, or
   `/rental`. A user acting on the pill's promise on `/search` finds nothing.

Together these read as "the flow isn't perfectly wired" when stops are
involved, even though the underlying fare/routing recompute logic is correct
in all three flows.

## Root cause

`/round-trip`'s CTA is not actually a "commit and book" action — no cab
category or fare exists yet at that point in the flow (those are chosen one
screen later, on `/select-ride`). Its button was labeled to *sound* like a
booking action ("Choose/Schedule your cab") when it functionally performs a
"continue to the next step" action. That mismatch is why forcing identical
copy onto all three screens doesn't work: `/select-ride` and `/rental` show a
real fare at CTA-time, `/round-trip` does not.

## Design

### 1. CTA label vocabulary

- `/select-ride` (both one-way and round-trip-via-select-ride) and `/rental`
  keep their existing pattern unchanged: `Book {category} · ₹{fare}` /
  `Schedule {category} · ₹{fare}`. These two are already consistent with each
  other.
- `/round-trip`'s CTA drops the "your cab" booking language and becomes an
  honest "proceed" label:
  `Set a destination first` → `Choose how many hours` →
  `Continue · {n}h round trip` (or `Continue scheduling · {n}h round trip` if
  a schedule time is set — exact scheduled-state copy to match whatever
  distinction `/select-ride` already draws between immediate and scheduled
  labels).
- Net effect: exactly one label vocabulary — `Book/Schedule {category} ·
  ₹fare` — is used for the actual booking commitment, on the one screen
  (`/select-ride`) where category and fare exist for every ride type.
  `/round-trip` no longer promises a booking action it can't yet fulfill.

### 2. Stop-in-flight CTA gating on `/select-ride`

Closer read of `select-ride/page.tsx` during planning found the Book button's
*disabled* state is already correct for round-trip: `loadEstimates`
(`select-ride/page.tsx:229-273`) depends on `stops.length` and sets the
shared `loading` flag around the fetch, and `loading` already appears in the
disabled condition (`select-ride/page.tsx:836`). One-way needs its extra
`detourPriced && (routingStops || routedDistanceKm == null)` clause only
because its fare depends on a second, separate async route computation
(`routedDistanceKm`) that can resolve *after* `loading` has already gone
back to `false` with a stale straight-line estimate — round-trip's fare has
no such second stage (it's a direct `stopCount`), so `loading` alone already
gates it correctly. **No disabled-condition change is needed.**

What *is* missing is messaging parity: the stop-row hint text at
`select-ride/page.tsx:388` (`routingStops ? 'Updating fare…' : detourPriced
? 'Fare covers the detour' : '${stops.length} on the way'`) only ever shows
"Updating fare…" for one-way, because `routingStops`/`detourPriced` are both
one-way-only signals. For round-trip, the hint stays on `'{n} on the way'`
even while `loading` is true right after a stop add/remove. Fix: extend the
hint's ternary so round-trip shows "Updating fare…" while `loading` is true
too, giving the same in-flight feedback one-way already has.
- Rental is untouched — its stops don't affect fare (see
  `rental/page.tsx:367`), so there is nothing to gate or message here.

### 3. `/search` pill copy

- Replace the current "Add stops" pill hint with copy that doesn't imply
  stops are addable on `/search` itself, e.g. "Add stops on the next screen"
  — or drop the stop-hint from the pill entirely. Exact final copy is an
  implementation-time call, not a design decision that needs to be locked
  here.

## Out of scope (considered, deferred)

- **Return Cab silent disappearance.** Adding a stop currently hides Return
  Cab availability with no toast/banner explaining why. Not fixed here;
  flagged for a future pass since it's a separate UX gap, not a CTA
  consistency issue.
- **Wait timer extension.** The live stop-wait timer (`StopWaitBadge`,
  `ride/[id]/page.tsx`) is one-way-only today. Extending it to round-trip/
  rental is out of scope for this change.
- **Collapsing round-trip's dual stop-editing surfaces** (`/round-trip` and
  `/select-ride` both allow editing stops for a round-trip booking). Kept
  as two surfaces, kept in sync via URL params, per explicit decision — not
  a defect, not touched.

## Files touched

- `apps/user/app/(main)/round-trip/page.tsx` — CTA label logic (~lines
  322-359).
- `apps/user/app/(main)/select-ride/page.tsx` — disabled condition (~line
  839) gains round-trip branch.
- `apps/user/app/(main)/search/page.tsx` — "Add stops" pill copy.

## Testing

No new business logic — this is copy + an additional boolean branch in an
existing disabled-state expression. Manual verification: exercise all three
ride types with 0, 1, and 2+ stops, confirm CTA label and enabled/disabled
state at each step matches this doc.
