# Select-Ride Stop Timeline Visibility Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add their first stop to a round-trip ride directly on `/select-ride`, even when they arrived via `/round-trip` with zero stops already set — currently the entire stop-adding UI is hidden in that specific case.

**Architecture:** Single conditional change in `apps/user/app/(main)/select-ride/page.tsx`. The `RouteTimeline` component (which renders the stop list and the "+" add-stop row) is currently gated behind `stops.length > 0 || rideType === 'one_way' || !fromRoundTripPage` in addition to `!isReturnCab`. Dropping that extra gate makes `RouteTimeline` always render unless Return Cab is active — matching one-way's behavior and round-trip-with-existing-stops' behavior, for round-trip-with-zero-stops too.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `'use client'` components.

---

## Investigation notes (read before starting)

Verified directly against current repo state:

- `apps/user/app/(main)/select-ride/page.tsx:584` — current condition:
  ```tsx
  {!isReturnCab && (stops.length > 0 || rideType === 'one_way' || !fromRoundTripPage) && (
    <div className="mx-4 mt-2 mb-1">
      <RouteTimeline nodes={stopNodes} />
    </div>
  )}
  ```
  `fromRoundTripPage` (line 66) is `true` only when arriving from `/round-trip` with `tripHoursFromUrl` set and `rideType=round_trip` in the URL. In that exact case, with `stops.length === 0`, all three OR-branches are false and `RouteTimeline` — and therefore the only "+" add-stop affordance on this page — never renders. There is currently no way to add a first stop to a round-trip ride from `/select-ride` in this flow; the user must go back to `/round-trip`'s own (separate) stop UI first.
- `apps/user/app/(main)/select-ride/page.tsx:524-563` — the compact "Round Trip · {n}h · Driver stays with you" summary card renders in a separate, non-scrolling section above the stop timeline (which lives in the scrollable list starting at line 580). Confirmed no visual duplication risk from always showing `RouteTimeline` — they occupy different, non-overlapping areas of the page.
- No unit/component test harness exists for this page (no `.test.tsx` alongside `select-ride/page.tsx`). Verification is manual via `pnpm dev`.

---

### Task 1: Always show the stop timeline unless Return Cab is active

**Files:**
- Modify: `apps/user/app/(main)/select-ride/page.tsx:584`

- [ ] **Step 1: Simplify the RouteTimeline visibility condition**

Current code (line 584):
```tsx
          {!isReturnCab && (stops.length > 0 || rideType === 'one_way' || !fromRoundTripPage) && (
```

New code:
```tsx
          {!isReturnCab && (
```

No other lines in this block change — the `<div className="mx-4 mt-2 mb-1"><RouteTimeline nodes={stopNodes} /></div>` body and closing `)}` stay exactly as they are.

- [ ] **Step 2: Verify manually**

This repo has no component/UI test harness for this page. Verify by reading the file after your edit to confirm line 584 now reads exactly `{!isReturnCab && (`, and that the JSX still balances (the `<RouteTimeline>` block's closing `)}` at line 588 is unchanged and still matches this opening).

Then, with `pnpm dev` running (`cd apps/user && pnpm dev`):
1. Start a round-trip booking via `/round-trip`: set an origin, a destination, and pick an hour option (do not add any stops on this page), then tap Continue to land on `/select-ride`.
2. Confirm the stop timeline (origin → destination with a "+" add-stop row) is now visible in the scrollable ride list, below the "Round Trip · Nh · Driver stays with you" card. Previously this section was completely absent.
3. Tap the "+" row and add a stop via the `AddStopSheet`. Confirm it's added to the timeline and the fare/hint updates as expected (per the round-trip hint behavior already shipped in the prior CTA-consistency fix).
4. Confirm one-way is unaffected: `/search` → pick a one-way route → `/select-ride`, confirm the stop timeline still renders exactly as before (it always did, since `rideType === 'one_way'` was already one of the OR-branches).
5. Confirm round-trip-with-existing-stops is unaffected: repeat step 1 but add a stop on `/round-trip` itself before tapping Continue. Confirm `/select-ride` still shows the timeline with that stop present (it always did, since `stops.length > 0` was already one of the OR-branches).
6. Confirm Return Cab still correctly hides the timeline: select a one-way ride with Return Cab active (no stops), confirm the stop timeline does NOT render (unchanged — `!isReturnCab` still gates everything).

- [ ] **Step 3: Commit**
```bash
git add "apps/user/app/(main)/select-ride/page.tsx"
git commit -m "fix(user-app): allow adding first stop to round-trip on select-ride"
```
