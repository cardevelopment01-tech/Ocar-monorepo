# Multi-Stop for Round Trip & Rental — Product, UX & Technical Plan

**Ocar — Issue 4 (client feedback), planning deliverable · 2026-07-09 · no code changed**

---

## 1. Industry research: how the majors do multi-stop

| App | Max extra stops | Add interaction | Reorder | Wait policy per stop | Fare communication | Driver-side |
|---|---|---|---|---|---|---|
| **Uber** | 2 (3 legs total) | "+" button beside destination field in trip planner; also editable mid-trip | Yes — drag handles in the stop list (planner only) | 3 min included; after that per-minute wait fee accrues; driver may end trip if rider absconds | Upfront fare recomputes instantly on stop add/remove; no per-stop line item shown to rider | Sequential waypoint nav; "stop 1 of 2" banner; single end-trip OTP-less flow (no per-stop OTP anywhere in industry) |
| **Lyft** | 1 stop (US) + "round trip back to pickup" preset | "+" in the destination row | No | Rider asked to keep stops < ~10 min; driver gets a $1 stop bonus; driver may cancel after ~5 min | Upfront recompute | Waypoint list, tap-to-advance |
| **Grab** | **1** extra stop (most SEA markets) | "Add extra stop" row under destination | No | 3 min (MY) / 5 min (MM); driver may complete ride at full fare if exceeded | Flat multi-stop fee + distance included upfront | Stop shown as intermediate pin; driver taps "arrived at stop" |
| **Bolt** | 2 | "+" in route card | No | Small included wait, then per-minute | Upfront recompute | Sequential nav |
| **Ola** | Effectively none for intercity/rental; rentals are "go anywhere, tell the driver" | — | — | Rentals: waiting is *inside* the hourly package, never billed per stop | Package overage (extra km / extra hr) billed at end | Driver just follows rider verbally |
| **Rapido / InDrive** | None (InDrive riders type stops into the free-text comment during bidding) | — | — | — | — | — |

**Patterns worth stealing:**

1. **Stops live in the route card**, directly under the destination row — never behind a separate screen or settings sheet. The route card *is* the itinerary.
2. **Sequential add, not free-form drag** at 1–3 stops. Uber only offers drag because it allows editing mid-trip; every app capped at 1–2 stops skips reordering entirely. Below 4 waypoints, "remove and re-add in the right order" costs the user less than learning a drag interaction on a phone.
3. **No per-stop OTP.** Nobody does it. OTP guards trip start/end (fraud boundary); intermediate stops are guarded by GPS + driver tap.
4. **Wait time is the real product question**, not routing. On per-km ride types the majors cap wait at ~3 min then meter it. **On hourly products (Ola Rentals) stops are free-form and waiting is simply consumed from the package clock.** This is the key insight for Ocar: *both* target ride types (Round Trip, Rental) are hourly products, so Ocar dodges the hardest part of Uber-style multi-stop — per-stop wait metering — entirely.
5. **Fare updates are silent and instant**: the total recomputes; at most a one-line "includes multi-stop fee" disclosure. No modal, no confirmation.

Sources: Uber Help — request a ride with multiple stops; Uber — How to add stops; Uber Help — driver-side multiple stops; Grab MY multi-stop; Grab MM add extra stop; Ridesharing Driver — Lyft stops/round trip; Ridesharing Driver — Uber round trip.

---

## 2. Product decision (the opinionated part)

### 2.1 Round Trip → **priced outbound waypoints**

Stops are ordered waypoints **on the outbound leg only** (origin → S1 → S2 → S3 → destination; return leg is destination → origin, no stops v1). Each stop:

- adds the flat per-category `charge_per_stop` (₹20–35, already seeded, already supported by `fare.ts`),
- is persisted in `ride_stops` and shown to the driver as a sequenced itinerary,
- carries **no wait meter** — the "what's included" card already promises "fare covers travel, waiting time, and the return," and the 4–12h package clock absorbs waiting. This is Ola-Rentals economics with Uber-style declared stops, and it's *simpler and more honest* than Uber's 3-minute rule.

Max **3 stops** (matches RIDE_TYPES_PLAN, matches Uber's ceiling +1, and keeps the route card readable on a 360px screen).

### 2.2 Rental → **planned stops (itinerary), zero fare impact, v1.5**

**Recommendation: waypoints, emphatically not a hard drop — and not even priced waypoints.**

Justification against the hourly-package model:

- A rental package sells **time + a km allowance**. A hard drop converts it into a one-way product, which cannibalizes One Way/Round Trip pricing and breaks the "end anywhere, overage billed at end" contract. Reject it.
- A *priced* waypoint is also wrong: the customer already paid for the hours; charging ₹25 to pause at a temple mid-package would be perceived as double-billing (no major charges stop fees on hourly rentals — Ola doesn't).
- But the client's underlying need is real and cheap to serve: riders want to **tell the driver the itinerary up front** so the driver can plan fuel/route/parking, and ops wants the itinerary on record for disputes. So Rental gets an optional **"Plan your stops"** list: same picker, same chips, max 3, written to `ride_stops` with `stop_charge_applied = 0`, surfaced to the driver — **never touches fare**. Label it "optional — you can change stops anytime during the ride" to preserve the go-anywhere promise.

This gives the client a visible "drop/stops on rental" feature without corrupting the pricing model. Put it in the requirements-clarification email exactly in these terms.

### 2.3 One Way → unchanged in this effort

The `/search` "Add stops" pill keeps its "coming soon" toast for one-way. One-way multi-stop needs detour-aware distance pricing (the fare there *is* per-km), which is v2 work. Scope discipline: the client asked for Rental and Round Trip.

---

## 3. UX flow

### 3.1 Where the affordance lives: **per-flow "Add a stop" row, not the `/search` pill**

Decision: build the RIDE_TYPES_PLAN sketch (dedicated row on `/round-trip` and `/rental`), and leave the `/search` pill toast alone. Why:

1. The `/search` unified card serves the **one-way** flow, where stops are out of scope (2.3). Activating the pill there would ship the feature to the wrong ride type first.
2. On `/round-trip`, the route card (`From` / `To` rows) is already the itinerary surface — stops belong between From and To *visually* and after To *interaction-wise*. Grab/Bolt both anchor "add stop" to the route card.
3. The query-param relay is *simpler* from the flow pages: `/round-trip` already owns the round trip's param state and already round-trips to `/search?backTo=round_trip` for the destination. Stops reuse that exact mechanism with one extra param.

### 3.2 Screen-by-screen

**`/round-trip` (and `/rental`) — the route card grows a stops section:**

1. Initial state unchanged. After destination is set (`hasDestination`), a new row appears inside the route card **between From and To**, animated in with the existing `fadeUp` pattern: a ghost row reading **"+ Add a stop"** (indigo `#4F46E5` text, `Plus` Lucide icon in a dashed-border circle). On Rental (no destination row) it's a separate "Plan your stops (optional)" card below the package selector.
2. Tapping it pushes `/search?backTo=round_trip&stopIndex=0&originLat=…&originLng=…&originAddress=…&rideType=round_trip` **plus all currently-set params** (destination, stops already chosen, tripHours, scheduledFor) so nothing is lost on the bounce — same preservation discipline `goToSearch()` already uses.
3. **`/search` in stop mode:** when `stopIndex` is present, the page header/placeholder swaps to "Add stop 1" and the destination field's amber dot renders as the stop marker (violet, see §4). Selecting a place does **not** run the destination-routing branch; it appends `stops[N][address]/[lat]/[lng]` to the carried params and `router.replace`s back to `backTo`. No distance recompute in v1 (fare is stop-count-based; see §5.3).
4. **Back on `/round-trip`:** each stop renders as a full-width row in the route card (not a floating chip — rows keep the From→stop→stop→To vertical rhythm and the dashed connector line intact). Each row: sequence badge ("1", "2"), truncated address, and an `X` remove button. Below the last stop, "+ Add a stop" persists until 3 stops, then disappears (no disabled state — absence is cleaner).
5. **Removal:** tap `X` → row exits (Framer `AnimatePresence`, height collapse + fade, ~200ms), remaining stops re-sequence silently, params rewritten via `router.replace` (keeps state in the URL, survives refresh — consistent with the app's no-store architecture).
6. **Reordering: none in v1.** Order = order added. A one-line helper under the stops, "Stops are visited in this order," sets expectation. (v2: long-press drag.)
7. **Fare communication:** the route-meta line gains a segment when stops exist: `· 2 stops · +₹50` — computed client-side from a small `GET /pricing/stop-charges?categoryId=` lookup or simply deferred to `/select-ride`, where the real estimate call already runs. On `/select-ride`, each vehicle card's fare silently includes the stop fare; the fare-breakdown sheet gets a "Stops (2 × ₹25)" line. No confirmation dialogs — industry-standard silent recompute.
8. **Book bar:** `handleProceed()` forwards `stops[i][address|lat|lng]` params to `/select-ride`, which forwards `stops` into the booking API call. Button label unchanged.

**Rental variant differences:** card title "Plan your stops · optional"; helper copy "Tell your driver where you plan to go — you can always change your mind during the ride"; no fare segment ever; the `/select-ride` breakdown shows "Planned stops · included" if any.

### 3.3 Param format

Adopt the RIDE_TYPES_PLAN convention verbatim — `stops[0][address]`, `stops[0][lat]`, `stops[0][lng]` — indexed bracket keys, parsed with a loop `while (sp.get(`stops[${i}][lat]`))`. It's grep-able, matches the existing flat-param style, and avoids JSON-in-URL encoding hazards. Hard cap parse at 3.

---

## 4. Visual design direction

All within the established violet/indigo language; a frontend engineer should need nothing further.

- **Stop marker dot:** the route card currently uses emerald (origin) and indigo `#4F46E5` (destination). Stops use a **2.5×2.5 rounded-square (rounded-[3px]) in violet `#7C3AED`** — square-vs-circle distinguishes "waypoint" from "endpoint" at a glance and picks up the gradient's second color. The dashed connector (existing pattern from `/search`) threads through all dots.
- **Stop row anatomy** (inside the white rounded-2xl route card, `border #E8EEFF`, dividers between rows as today): 16px violet square dot → column with `STOP 1` overline (10px, semibold, uppercase, `#94A3B8` — mirrors the FROM/TO overlines) and address (13px semibold `#0F172A`, truncate) → trailing 28×28 tap target with `X` Lucide icon (14px, `#94A3B8`, `active:opacity-60`). Row padding matches From/To rows (`px-4 py-3.5`).
- **"+ Add a stop" ghost row:** 22px circle with 1.5px **dashed** `#C7D2FE` border containing a `Plus` icon (12px, `#4F46E5`); label 13px semibold `#4F46E5`; whole row `active:opacity-60`. Dashed = "slot not yet filled," consistent with the dashed route connector.
- **Motion:** rows mount with the page's `fadeUp` (y:10→0, 0.3s, existing EASE curve); add/remove uses `AnimatePresence` with `initial={{opacity:0, height:0}}` collapse so the card resizes smoothly; the remove `X` gets `whileTap={{scale:0.9}}` like the hour chips. No layout-shift jank: animate `height`, not `margin`.
- **Fare hint chip** on route-meta line: plain text segment in the existing 11px `#94A3B8` style, with the price part bold `#4F46E5` (matches "both legs covered" emphasis).
- **`/search` stop mode:** header title "Add stop N"; selected-result confirmation row uses the violet square dot; everything else identical to destination mode so no new components are needed.
- **Iconography:** `Plus`, `X`, and for the driver app `Flag` (stop pending) / `CheckCircle2` (reached) from Lucide — no new icon set.

---

## 5. Backend plan

### 5.1 Write path (v1)

| Surface | Change |
|---|---|
| `rides.types.ts` | Add `stops?: Array<{ address: string; lat: number; lng: number }>` to the booking request type. **Deprecate client-supplied `stopCount`** — derive it server-side as `stops.length` so count and rows can never diverge. Keep `stopCount` accepted-but-ignored for one release for compat. |
| Zod booking schema | `stops: z.array(z.object({ address: z.string().min(1).max(255), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).max(3).optional()`; refine: only allowed when `rideType ∈ {round_trip, rental}`. |
| `createBooking` service | After the ride INSERT (same transaction): fetch `charge_per_stop` for the chosen category from `stop_charges`; insert one `ride_stops` row per stop with `sequence = i+1`, `status='pending'`, `stop_charge_applied = charge_per_stop` for round_trip and `0` for rental. Pass `stop_count`/`charge_per_stop` into the fare snapshot exactly as `fare.ts` already expects — for rental pass `stop_count: 0` to the engine (itinerary-only). Respect the `exactOptionalPropertyTypes` build-then-assign pattern. |
| `rides.repository.ts` | New: `insertRideStops(client, rideId, stops[])` (single multi-row parameterized INSERT using `ST_SetSRID(ST_MakePoint($lng::float8,$lat::float8),4326)::geography` — lng first, per the invariant); `getRideStops(rideId)` ordered by `sequence`; `markStopStatus(rideId, sequence, status)` setting `reached_at = now()` when `status='reached'`. |
| Routes | `PATCH /api/v1/rides/:id/stops/:sequence` body `{ status: 'reached' \| 'skipped' }`, driver-authenticated, guarded to the assigned driver and `ride.status='in_progress'`; emit `socketEvents` `stop:updated` to `ride:{rideId}` so the user's tracking screen advances. Ride detail responses (user, driver, admin) gain a `stops[]` array from `getRideStops`. |
| Migration | **None needed** — `ride_stops` (007) and `stop_status` enum (`pending/reached/skipped`, 002) already fit this design exactly. That table was clearly built for this; use it as-is. |

### 5.2 Fare: keep it flat for v1 — with justification

Keep `stop_fare = stop_count × charge_per_stop`. Reasons:

1. **Both target ride types are time-boxed.** Round Trip prices on `tripHours` + round-trip distance; detour kilometers to a waypoint are second-order against a 4–12h package, and the existing "end early elsewhere → return distance added" rule already backstops abuse. Rental has a km allowance with end-of-trip overage. Location-aware stop pricing would add a routing dependency (waypointed directions call at estimate time) for pennies of accuracy.
2. The flat fee exists, is admin-tunable per category, is already in the fare engine and snapshot — **zero fare-engine changes** means zero re-testing of the money path.
3. Uber-style wait metering is unnecessary (§2.1): the hourly clock is the wait meter.

**v2 trigger:** when one-way multi-stop ships, compute routed distance through waypoints client-side (the app already gets a polyline/distance from its directions provider on `/search`) and pass true `distanceKm`; the fare engine needs no change even then — only the input distance does. Also v2: honor `applies_to_return_cab` when return-cab routes gain stops.

### 5.3 Estimate path

`/select-ride`'s fare-estimate call gains `stopCount` (round trip only) — the pricing endpoint should accept it and thread to `fare.ts`, which already handles it. This is likely a small addition to the estimate handler/schema.

### 5.4 Driver app

- **ActiveRide / TripInProgress:** render the stop itinerary as a vertical checklist card above the destination: sequence badge, address, and per-stop state. Current target stop is highlighted (indigo left border); a single **"Reached stop N"** button (or swipe-to-confirm matching the existing trip controls) calls the PATCH. Reached rows collapse to a checked single line. A secondary "Skip" affordance (overflow/long-press) sets `skipped` — needed because riders change plans verbally mid-rental.
- **Navigation:** "Navigate" deep-link points at the *current pending stop*, advancing to the next pending stop (or destination) after each `reached`/`skipped`. No multi-waypoint deep link in v1 (Google Maps waypoint intents are flaky on Android); one leg at a time matches how Uber drivers actually navigate.
- **No per-stop OTP.** Industry-consistent, and the OTP invariant (SHA-256, trip_start/trip_end only) stays untouched. GPS + driver tap + `reached_at` timestamp is the audit trail; ops can cross-check against `gps_tracks` in disputes.
- **Ride-offer card:** show "2 stops" as a pill so drivers know before accepting.

### 5.5 User tracking screen

Stop list mirrors driver state via the `stop:updated` socket event: pending → violet square, reached → emerald check, skipped → struck-through gray. No user action required.

---

## 6. Edge cases & rules

| Case | Rule |
|---|---|
| Stop order vs actual route order | v1: visit order = declared order (stated in UI copy). Driver may physically deviate; `reached` events are accepted in any order, sequence is advisory. No route optimization. |
| Rental stop outside service area | Validate each stop at booking: within N km (suggest 50) of `originCityId`'s center via a parameterized PostGIS `ST_DWithin` — same geofence approach as nearest-city. Reject with a safe error code (`STOP_OUT_OF_SERVICE_AREA`); UI surfaces "This stop is outside your rental's service area." Round trip stops: must lie within the operating triangle (any of the 3 cities' radii). |
| Fare recompute on add/remove | Pre-booking only: params change → `/select-ride` estimate re-runs → new upfront fare. `fare_snapshots` written at booking is final. **No post-booking stop editing in v1** (Uber allows it; Ocar shouldn't until fare re-snapshot semantics exist). |
| User removes stop after seeing fare, then books | Harmless by construction: the booked fare is always computed from the params present at booking time; snapshot includes the final `stop_count`. |
| Max stops | 3, enforced in UI (button disappears), URL parser (loop cap), and Zod (`max(3)`) — three layers. |
| Duplicate/degenerate stops | Zod refine: reject a stop within ~100m of origin, destination, or another stop (Haversine server-side) with a friendly error; UI can pre-warn. |
| Driver skips a stop | `skipped` status; **no automatic refund of the ₹20–35 stop fee in v1** (it's a booking-time flat fee; disputes flow via existing M09 disputes if contested). Note this consciously in release notes. |
| Ride cancelled | `ride_stops` rows remain (FK to ride) as historical record; no cleanup needed. |
| Mid-trip verbal extra stops (rental) | Allowed by product ("change anytime") — simply not recorded. The recorded itinerary is a plan, not a contract. |

---

## 7. Phasing

**V1 — ship the client ask (~1 sprint):**
1. Backend: types + Zod + `createBooking` stop insert + repository fns + PATCH stop status + stops in ride detail + estimate `stopCount` (round trip). No migrations, no fare-engine changes.
2. User app: `/round-trip` stop rows + add/remove + param relay; `/search` `stopIndex` mode; `/select-ride` breakdown line; tracking-screen stop checklist.
3. Driver app: itinerary checklist + "Reached stop" + per-leg navigation + offer-card stop pill.
4. Rental: "Plan your stops" itinerary card (charge 0). Can trail by a week as v1.5 if needed — round trip is the higher-value half.

**V2 — later:**
- One-way multi-stop (activate the `/search` pill) with waypoint-routed `distanceKm` feeding the fare engine.
- Drag-to-reorder (long-press, Framer Motion `Reorder`), post-booking stop editing with fare re-snapshot, return-leg stops honoring `applies_to_return_cab`, per-stop wait visibility for ops, multi-waypoint nav deep links, admin ride-detail stop timeline.

**Explicitly rejected:** hard drop on rental (breaks hourly model), per-stop OTP (no industry precedent, adds friction), per-stop wait metering on hourly products (double-billing), stop-distance-aware fare in v1 (routing dependency for negligible accuracy on time-boxed rides).

---

Key files referenced: `apps/user/app/(main)/round-trip/page.tsx`, `apps/user/app/(main)/rental/page.tsx`, `apps/user/app/(main)/search/page.tsx`, `api/src/lib/fare.ts`, `api/src/modules/rides/rides.types.ts` + `rides.repository.ts`, `api/src/db/migrations/002_enums.sql` (stop_status: pending/reached/skipped), `006_m4_pricing.sql` (stop_charges, seeded ₹20/25/35 by category), `007_m5_booking.sql` (ride_stops — usable as-is, no migration needed), `docs/RIDE_TYPES_PLAN.md` (param convention adopted).
