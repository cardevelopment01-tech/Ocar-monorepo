# Multi-stop CTA Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the user app's three ride-type flows (one-way, round-trip, rental) present consistent, honest CTA copy and stop-in-flight hint text so multi-stop booking no longer reads as "half-wired" across screens.

**Architecture:** All three changes live in `apps/user/app/(main)/` (Next.js 16 App Router, client components). Change 1 is a string-literal swap in a ternary that already computes `/round-trip`'s button label. Change 2 extends an existing hint ternary on `/select-ride` with one more branch, reusing the `loading` and `rideType` state already in scope — no new state, no logic change to the Book button's `disabled` condition. Change 3 was scoped by the design doc against a "Add stops" pill that, per investigation below, does not exist in the current `/search` page — that task is a no-op with a documented finding, not a code change.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `'use client'` components, Tailwind, framer-motion.

---

## Investigation notes (read before starting)

Verified directly against the current repo state (all three target files read in full/relevant part before writing this plan):

- `apps/user/app/(main)/round-trip/page.tsx:145-151` — confirmed current `buttonLabel` ternary matches the design doc exactly.
- `apps/user/app/(main)/select-ride/page.tsx:388` — confirmed current stop-row hint ternary matches the design doc exactly. `loading` is declared via `useState` and set inside `loadEstimates` (lines 229-273); `rideType` is read from search params earlier in the component. Both are already in scope at line 388, inside the same `SelectRideContent` function component.
- `apps/user/app/(main)/select-ride/page.tsx:833-840` — confirmed the Book button's `disabled` expression already includes `loading` and does **not** need a round-trip branch added, per the design doc's explicit call-out. This plan does not touch it.
- `apps/user/app/(main)/search/page.tsx` — grepped for `stop`, `pill`, and `hint` (case-insensitive) across the whole file. The only stop-related matches are unrelated (`e.stopPropagation()` calls at lines 470 and 500, and a code comment at line 451 that says "read-only while adding a stop" describing the FROM-row lock state, not a UI pill). The file's two "Pinned action pills" (line 536-553) are **"Select on map"** (`goToMapPicker`, line 538-545) and `PickupTimeChip` (line 546-552) — neither mentions stops. **There is no "Add stops" pill, and no "set destination, add stops next" copy, anywhere in this file.** The design doc's premise for Change 3 does not match current code. Task 3 below is written as a no-op per the plan's own instructions for this case.

No unit/component test harness exists for these pages (verified: no `.test.tsx` files alongside `select-ride/page.tsx`, `round-trip/page.tsx`, `search/page.tsx`). All verification steps below are manual, using `pnpm dev` and exact UI states to check.

---

### Task 1: `/round-trip` CTA label — drop "book/schedule your cab" wording

**Files:**
- Modify: `apps/user/app/(main)/round-trip/page.tsx:145-151`

- [ ] **Step 1: Replace the `buttonLabel` ternary's last two branches**

Current code (lines 145-151):
```tsx
  const buttonLabel = !hasDestination
    ? 'Set a destination first'
    : selectedHours === null
    ? 'Choose how many hours'
    : scheduledFor
    ? `Schedule your cab · ${selectedHours}h round trip`
    : `Choose your cab · ${selectedHours}h round trip`
```

New code:
```tsx
  const buttonLabel = !hasDestination
    ? 'Set a destination first'
    : selectedHours === null
    ? 'Choose how many hours'
    : scheduledFor
    ? `Continue scheduling · ${selectedHours}h round trip`
    : `Continue · ${selectedHours}h round trip`
```

- [ ] **Step 2: Verify manually** (this repo has no component/UI test harness for these pages — see Investigation notes above)

1. Run `cd apps/user && pnpm dev` (leave it running).
2. In a browser, navigate to `http://localhost:3000/round-trip` with no destination set yet. Confirm the primary button reads exactly **"Set a destination first"**.
3. Set a destination (search and pick a place). Do not pick an hour option yet. Confirm the button now reads exactly **"Choose how many hours"**.
4. Tap one of the hour chips (e.g. `4`). Do not set a scheduled time. Confirm the button reads exactly **"Continue · 4h round trip"** (substitute whichever hour value you picked).
5. Open the schedule picker on this page and set a future pickup time. Confirm the button now reads exactly **"Continue scheduling · 4h round trip"**.
6. Confirm the button no longer contains the words "Choose your cab" or "Schedule your cab" in any state.

- [ ] **Step 3: Commit**
```bash
git add apps/user/app/\(main\)/round-trip/page.tsx
git commit -m "fix(user-app): round-trip CTA says Continue, not Book, before fare exists"
```

---

### Task 2: `/select-ride` stop-row hint parity for round-trip

**Files:**
- Modify: `apps/user/app/(main)/select-ride/page.tsx:388`

- [ ] **Step 1: Extend the stop-row hint ternary with a round-trip in-flight branch**

Current code (line 388, inside the `stopNodes` array construction at lines 376-391):
```tsx
          hint: routingStops ? 'Updating fare…' : detourPriced ? 'Fare covers the detour' : `${stops.length} on the way`,
```

New code:
```tsx
          hint: routingStops
            ? 'Updating fare…'
            : detourPriced
            ? 'Fare covers the detour'
            : rideType === 'round_trip' && loading
            ? 'Updating fare…'
            : `${stops.length} on the way`,
```

This uses `rideType` and `loading`, both already declared earlier in the same `SelectRideContent` function component (`loading` is set by `loadEstimates`, lines 229-273; `rideType` comes from the search params parsed near the top of the component) — no new imports, no new state.

Do **not** touch the Book button's `disabled` condition at lines 833-840. It already includes `loading` and is correct for round-trip as-is (confirmed in Investigation notes above) — this task is a hint-text-only change.

- [ ] **Step 2: Verify manually** (this repo has no component/UI test harness for these pages — see Investigation notes above)

1. With `pnpm dev` still running from Task 1, navigate to `/round-trip`, set an origin and destination, pick an hour option, and tap "Continue" to reach `/select-ride?rideType=round_trip&...`.
2. Confirm the stop row at the bottom of the route timeline shows the "+" add-stop affordance with no hint text (0 stops).
3. Tap "+" and add one stop via the `AddStopSheet`. Immediately after confirming the stop (while the page is refetching fare estimates), open React DevTools and inspect the `SelectRideContent` component's `loading` state — confirm it is briefly `true` and that during this window the stop-row hint renders **"Updating fare…"**. (If network is fast enough that you can't catch this by eye, throttle network speed in browser devtools to "Slow 3G" and repeat, or confirm the code path directly: `rideType === 'round_trip' && loading` evaluates to `true` while `loadEstimates` is in flight, per its `setLoading(true)` at line 230 and `setLoading(false)` at line 272.)
4. Once the fetch settles, confirm the hint changes to **"1 on the way"**.
5. Now navigate to a fresh one-way flow: `/search` → pick origin/destination → `/select-ride` (no `rideType=round_trip` param, or `rideType=one_way`). Add a stop the same way. Confirm the existing one-way behavior is unchanged: hint shows **"Updating fare…"** while `routingStops` is true (the route/detour is recomputing), then settles to **"Fare covers the detour"** once `detourPriced` is true. This confirms the new round-trip branch did not affect the one-way branches ahead of it in the ternary.

- [ ] **Step 3: Commit**
```bash
git add apps/user/app/\(main\)/select-ride/page.tsx
git commit -m "fix(user-app): show 'Updating fare…' hint for round-trip stop changes too"
```

---

### Task 3: `/search` "Add stops" pill copy — not applicable, no such pill exists

**Files:**
- None modified.

> **Note:** The design doc (`docs/superpowers/specs/2026-08-01-multistop-cta-consistency-design.md`, section "3. `/search` pill copy") describes a pill on `/search` that hints "set destination, add stops next" and asks for its copy to be corrected to something like "Add stops on the next screen". Investigation for this plan (see "Investigation notes" above) grepped `apps/user/app/(main)/search/page.tsx` for `stop`, `pill`, and `hint` (case-insensitive, whole file) and found:
> - The only two "Pinned action pills" in this file (lines 536-553) are **"Select on map"** and a `PickupTimeChip` (pickup time scheduling) — neither mentions stops.
> - The only other `stop`-adjacent text in the file is unrelated: `e.stopPropagation()` event calls (lines 470, 500) and a code *comment* (line 451) reading "read-only while adding a stop" that describes the FROM-row's lock state while search mode is active on the TO field — it is not user-facing copy and does not mention "add stops next" or imply stop-adding is available on this screen.
>
> No misleading "Add stops" copy currently exists on `/search` to fix. Per this plan's own instructions for this scenario, no code change is made in this task — it is recorded as not applicable. If a future audit finds a genuinely misleading stops-related pill on `/search` (e.g. reintroduced by a later change), open a fresh task against the actual code found at that time rather than reusing this one.

- [ ] **Step 1: Confirm the investigation finding still holds** (skip code changes — this is a verification-only step)

Run this from the repo root to re-confirm no stop-adding pill exists on `/search`:
```bash
cd apps/user && grep -ni "stop" "app/(main)/search/page.tsx"
```
Expected output: only the `stopPropagation` calls and the "adding a stop" code comment described above — no user-facing pill copy mentioning stops. If this output has changed (e.g. a pill was added since this plan was written), stop here and re-scope this task against the actual new code instead of applying the design doc's original guess blindly.

- [ ] **Step 2: No commit needed**

This task made no code changes, so there is nothing to stage or commit. Proceed directly to Task 4.

---

### Task 4: Full manual regression pass

**Files:**
- None modified — this is a verification-only task covering the combined effect of Tasks 1-3.

- [ ] **Step 1: Walk all three ride types × {0, 1, 2} stops and confirm CTA/hint copy**

With `pnpm dev` running (`cd apps/user && pnpm dev`), exercise each combination below and confirm the exact copy shown. "CTA" = the primary action button on the relevant screen; "Stop hint" = the small text under the stop row next to the "+" add-stop affordance (n/a where the screen has no such row, e.g. `/round-trip` has no per-stop hint of its own — only `/select-ride` does).

**One-way** (`/search` → pick origin/destination → `/select-ride?rideType=one_way&...` or default `rideType`):
| Stops | CTA on `/select-ride` (unaffected by this plan) | Stop hint on `/select-ride` (unaffected by this plan) |
|---|---|---|
| 0 | `Book {category} · ₹{fare}` (or `Schedule …` if a pickup time is set) | no hint shown (add-stop row has no hint at 0 stops per line 383-390) |
| 1 | same CTA pattern as above | `Updating fare…` while `routingStops` is recomputing the detour route, then `Fare covers the detour` once settled |
| 2 | same CTA pattern as above | same as 1-stop: `Updating fare…` then `Fare covers the detour` (stop row caps the "+" affordance at 3 stops per `stops.length < 3` guard, line 383, so 2 stops still shows the add-stop hint) |

**Round-trip** (`/round-trip` → pick destination + hours → `Continue` → `/select-ride?rideType=round_trip&...`):
| Stops | CTA on `/round-trip` (Task 1 change) | CTA on `/select-ride` (unaffected) | Stop hint on `/select-ride` (Task 2 change) |
|---|---|---|---|
| 0 | `Set a destination first` → `Choose how many hours` → `Continue · {n}h round trip` (or `Continue scheduling · {n}h round trip` if scheduled) | `Book {category} · ₹{fare}` (or `Schedule …`) | no hint shown at 0 stops |
| 1 | same as above (stop count doesn't change `/round-trip`'s own CTA) | same CTA pattern as above | `Updating fare…` while `rideType === 'round_trip' && loading`, then `1 on the way` once settled |
| 2 | same as above | same CTA pattern as above | `Updating fare…` while loading, then `2 on the way` once settled |

**Rental** (`/rental` → ... ) — per the design doc and `rental/page.tsx:367`, rental stops don't affect fare, so this plan makes no CTA or hint change here:
| Stops | CTA | Stop hint |
|---|---|---|
| 0 | unchanged from current — no CTA/hint change applies to rental |
| 1 | unchanged from current — no CTA/hint change applies to rental |
| 2 | unchanged from current — no CTA/hint change applies to rental |

- [ ] **Step 2: Confirm no regressions in wording elsewhere**

Search the diff for stray leftover text to make sure the old copy is fully gone:
```bash
cd apps/user && grep -rn "Choose your cab\|Schedule your cab" "app/(main)/round-trip/page.tsx"
```
Expected: no matches (both phrases were fully replaced in Task 1).

- [ ] **Step 3: Final commit check**

Confirm the working tree is clean (Tasks 1-2 already committed their changes individually, Task 3 made no changes):
```bash
git status
```
Expected: no uncommitted changes to `apps/user/app/(main)/round-trip/page.tsx` or `apps/user/app/(main)/select-ride/page.tsx`. If `git status` shows either file as modified, one of the earlier commit steps was missed — go back and commit it now before considering this plan complete.
