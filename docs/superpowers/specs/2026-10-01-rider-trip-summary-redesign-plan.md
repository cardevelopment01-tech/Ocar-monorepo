# Rider app: Trip summary (trip end / ride detail) redesign plan

Status: PLAN, not implemented. Target: `apps/rider-mobile/src/app/ride/[id]/index.tsx`, `completed` branch.
Reviewed against `DESIGN.md` and `PRODUCT.md`. Inspiration: Rapido "Details" screen (user's screenshot), Uber trip receipt.

## 1. What exists today (from code, not emulator)

Note: Docker Desktop was not running and no emulator device was attached, so the flow was traced in code
rather than clicked through. Re-verify visually on a device after build.

When a ride hits `completed`, the rider stays on the live-tracking screen. The full-bleed map and docked
bottom sheet (max 62% height) remain, SOS is disabled, and the sheet shows:

1. `StatusBanner` for `completed`
2. `DriverCard`
3. `RideActions` strip (Trip details toggle)
4. A green row: "Trip complete" + `₹1480` (rounded, tiny)
5. "Rate your driver" row, or "You rated this ride 4/5"
6. `CashCollectionBanner`: a second "Trip complete" title plus "Please pay ₹1480.00 in cash"

Problems, traced to principle:

| # | Problem | Principle broken |
|---|---|---|
| P1 | "Trip complete" appears twice (completeRow and CashCollectionBanner) | Omit needless words, one job per element |
| P2 | Fare is a 14px-icon row, no hierarchy; the number riders care about most is not the biggest thing | Hierarchy as service |
| P3 | No fare breakdown, though the API already returns base/distance/time/stop/surge/overage fare | Trust through transparency (goodwill reservoir) |
| P4 | No distance, duration or trip date/time, though `actual_km` / `actual_min` are already selected | Users want the receipt facts |
| P5 | Cash amount is unformatted (`₹1480.00`) and "pay cash" is the last thing in a scroll, below the rating prompt | Primary action must be unmissable |
| P6 | Map dominates a screen where the trip is over; 62% sheet ceiling forces scroll for the facts | The map is the wrong hero post-trip |
| P7 | Completed-state sheet still shows `RideActions` (Edit pickup / Cancel hidden, but the strip remains) | Dead affordances |
| P8 | Sheet shadow is `rgba(20,23,26,.10)` neutral; DESIGN.md Teal Shadow Rule says teal | System consistency |
| P9 | `rate.tsx` repeats route + fare in a mini card, so two screens show the trip differently | Trust through consistency |

Design completeness today: **3/10**. A 10 has a single calm receipt page: fare first, payment state unmissable,
route, driver + rating, itemised fare, help, and the same page reused for past trips in My Trips.

## 2. Target design: one "Trip summary" screen

The `completed` status stops rendering the map sheet. It renders a full-screen scrolling page. The same page
serves the post-ride moment and any completed trip tapped from My Trips (Rapido's "Details" page is the
history version of this; Uber uses one receipt for both). Cancelled trips reuse it with a slimmer layout.

### Wireframe (390 wide)

```
[<]  Trip summary
-----------------------------------------------------
 Hero (white, 24r, teal shadow, NOT nested)
   Sedan                          [ (v) Completed ]
   1 Oct 2026 . 9:40 PM
   ₹1,480                         <- Space Grotesk 34/700 tabular
   Paid in cash                   <- or "Pay ₹1,480 to driver" state, see 2.2
-----------------------------------------------------
 Route (white, 24r)
   (o) Bhubaneswar Railway Station        <- 2 lines max
    :
   [#] Cuttack, Badambadi Bus Stand
   ---------------------------------------------
   58 min . 28.4 km   . 1 stop
-----------------------------------------------------
 Driver + rating (white, 24r)
   (photo) Ramesh Sahoo   * 4.8        [call]
           Swift Dzire . OD 02 AB 1234
   ---------------------------------------------
   Rate your trip
   [*][*][*][*][*]   big, 44px targets
-----------------------------------------------------
 Fare details (white, 24r)
   Base fare                        ₹120
   Distance . 28.4 km             ₹1,020
   Time . 58 min                    ₹290
   Extra stops                        ₹0   <- hidden when 0
   Surge 1.2x                        ₹..   <- hidden when 1.0x
   -----------------------------------------
   Total                          ₹1,480
-----------------------------------------------------
 Need help?  We're a tap away            (headset)  >
 Ride ID  #RD...1781  (tap to copy)
-----------------------------------------------------
```

Section order follows what a rider asks, in order: what did I pay, did I pay, where did I go, who drove me,
what was I charged for, who do I call.

### 2.1 Hero card
- Left: vehicle category (`assignedCategoryName ?? bookedCategoryName`) in Title, date/time in Label `ink-600`.
- Right: status pill `status-pill-success` with check icon AND the word "Completed" (colour never sole indicator).
- Fare numeral: Display role (Space Grotesk 700, -0.03em), tabular figures, `₹` + Indian grouping via
  `toLocaleString('en-IN')`, whole rupees if `.00`, else 2 decimals. One formatter, reused everywhere
  (hero, invoice, cash banner, rate screen, history list). Kills the `₹1480.00` vs `₹1480` inconsistency.
- No vehicle illustration (Rapido has one; we have no asset and Ocar is not a bike-first app).

### 2.2 Payment state (replaces CashCollectionBanner as a separate card)
A single line inside the hero, directly under the fare:
- Cash, not yet collected: `warning-light` inset strip, icon + "Pay ₹1,480 cash to your driver". This is the
  loudest thing on the page until collected (primary action unmissable).
- Cash collected: plain `success` text with check, "Paid in cash".
- Wallet / online: "Paid via wallet" / "Paid online".
- Collected state is live: the backend emits no rider event on collection (see CashCollectionBanner comment),
  so refetch on screen focus and every 15 s while unpaid. Cheap, no backend change.

### 2.3 Route card
Reuse the dot/line connector from `TripDetailsCard` (green primary dot, ink square). Addresses Body 16px,
up to 2 lines. Stops rendered via existing `StopTimeline` data, between pickup and drop. Footer row:
duration . distance . stop count, from `actual_min` / `actual_km`, falling back to "est." values if actuals null.
Round trip shows "Drop & return", rental shows "N h rental" (same labels as `TripDetailsCard`).

### 2.4 Driver + rating
- Reuse `DriverAvatar` and `driverViewFromRide`. Call button only while within a grace window? Post-trip calling
  is a privacy question: hide it on the summary (driver phone is masked after completion elsewhere?).
  Default: no call button on a completed trip. Flagged as open question Q3.
- Rating lives here, not behind a row that navigates away. Five 44px stars. Tapping a star pushes
  `/ride/[id]/rate?score=N` with that star pre-selected, so tags/comment still use the existing screen.
  After rating: read-only stars + "You rated Ramesh". Matches Rapido's "You rated Md Amir".
- Delete the "Rate your driver" chevron row.

### 2.5 Fare details (the headline gap)
Rows come from `baseFare, distanceFare, timeFare, stopFare, hourSurcharge, overageFare, surgeFare`.
- Render only rows with value > 0, each with its quantity in the label ("Distance . 28.4 km").
- Total row: Title weight, top hairline in `border` (solid, not dashed).
- Numbers right-aligned, Mono role with tabular figures so columns align.
- Do NOT invent "Booking fees & convenience" or GST rows (Rapido has them, our schema has no such fields).
  If totals ever differ from the row sum, show a single "Adjustments" row rather than hide the gap.
- Collapsed by default? No. On a receipt page the breakdown is the content; collapsing adds a tap for no gain.
  Rapido collapses it because its page is taller.
- Estimated vs final: if `totalFinal` is null, label the page total "Estimated fare".

### 2.6 Help + ride ID
- "Need help?" row: headset icon in `primary-subtle` circle, 56px tall, chevron. Routes to existing dispute/
  support entry (`safety` module disputes). Uses `surface`, not Rapido's heavy blue fill (Route Rule).
- Ride ID: Caption, `ink-400`, tap to copy with a 1.5 s "Copied" toast.

### 2.7 Explicitly cut
- Email invoice / "Get receipt": needs a backend endpoint and template. Cut from v1. Add when asked.
- Vehicle illustration, promo banner, tip prompt, "share trip".
- "INVOICE" all-caps header from the Rapido shot: DESIGN.md No Eyebrow Rule. Use sentence-case "Fare details".

## 3. Design-system compliance (DESIGN.md)

| Rule | How this plan complies |
|---|---|
| Teal Shadow Rule | Cards use Card shadow `0 2px 16px rgba(14,143,163,.07)`; replaces the neutral sheet shadow |
| Route Rule (teal <= 25%) | Teal only on pickup dot, call/help icon tint, focus; fare is ink-900 |
| Orange Boundary | No orange. Cash-due strip uses `warning-light`/`warning` |
| Two Font Rule | Space Grotesk fare numeral + Headline; Plus Jakarta everything else; Mono only for invoice figures |
| No Eyebrow Rule | No caps labels |
| No nested cards | Four sibling cards on the page background; dividers inside, never a card in a card |
| Pill buttons on user app | The only buttons are pill (Go home). Rows are not buttons |
| Touch targets 44px | Stars, help row, ride ID, back |
| Colour not sole indicator | Pill = icon + word; cash strip = icon + words |
| Type >= 12px, body 16px | Caption only for ride ID |
| Reduced motion | Only a 200 ms opacity fade on mount; none under reduced motion |

Card radius 24 (`2xl`). Page gutter 16. Section gap 12. Card inner padding 16 (20 for hero).
Bottom: pill "Back to home" with Button Primary shadow, pinned, only on the post-ride entry (not from My Trips).

## 4. States and edge cases

| State | Behaviour |
|---|---|
| Loading | Skeleton: hero block 120, three 96 blocks (existing `Skeleton`) |
| Load error | Existing `ErrorState` with retry |
| `totalFinal` null | Hero shows estimate with "Estimated" word; invoice uses estimate rows |
| Cancelled / no_drivers (via history) | Hero with `error-light` pill "Cancelled" + icon, fare only if a cancellation fee exists, route card, help row; no driver/rating/invoice |
| Zero-value rows | Hidden |
| Surge 1.0x | Hidden; > 1.0 shows "Surge 1.2x" |
| 40+ char address | 2-line clamp, ellipsis |
| 47-char driver name | 1 line, ellipsis, rating stays visible |
| No driver photo | Existing initials avatar |
| Already rated | Read-only stars |
| Rating submit fails | Stay on summary, inline error under stars, stars keep selection |
| Offline | Show cached ride from last fetch, hide live cash refetch spinner |
| Large font scale | Fare numeral scales with `maxFontSizeMultiplier=1.3`, invoice rows wrap label, never truncate amounts |
| Screen reader | Hero reads "Completed. Fare 1,480 rupees. Paid in cash." Stars are a radiogroup, "Rate 4 of 5" |

## 5. Implementation plan (smallest diff that delivers this)

Data, no migration and no new endpoint (fields already selected in `RIDE_SELECT_SQL`):
1. `packages/mobile-shared/src/api/types.ts` `RideDetail`: add `actualKm`, `actualMin`, `surgeMultiplier`,
   `completedAt`, `requestedAt`, `paymentStatus`. Confirm `r.*` includes `requested_at` / `completed_at`.

UI, all in `apps/rider-mobile/src`:
2. New `features/trip-summary/` with `TripSummary.tsx`, `FareDetails.tsx`, `RouteCard.tsx`, `RatingRow.tsx`,
   and `formatMoney.ts`. Reuse `DriverAvatar`, `StopTimeline`, `Skeleton`, `ErrorState`, `Button`.
3. `app/ride/[id]/index.tsx`: when `isCompleted || isCancelled`, `return <TripSummary ride={ride} />` before the
   map/sheet branch. Delete the completed-only JSX (completeRow, rateBtn, ratedRow, CashCollectionBanner use).
   `CashCollectionBanner` becomes the hero payment strip or is deleted.
4. `rate.tsx`: accept `score` param as initial rating; swap its ad-hoc trip card for `formatMoney`.
5. `RideHistoryList` row tap already targets `/ride/[id]`; confirm, and use `formatMoney` for its fare too.
6. Tests: unit test `formatMoney` and `buildInvoiceRows` (hides zeros, surge, sums to total). One RN render
   test per state in the table above that changes layout (paid, cash-due, cancelled, estimate-only).

Verification gates before calling it done: `pnpm --filter rider-mobile tsc`, tests, then a real ride on the
emulator (user app + driver app) through completion, plus opening the same ride from My Trips.

## 6. Decisions (2026-10-01)

Q1 cut email receipt from v1. Q2 inline stars hand off to `rate.tsx`. Q4 full page. Q3 defaulted to hidden.
Still open below only if you want to revisit.

## 7. Original questions

- Q1 Receipt by email/PDF: cut from v1 (recommended) or build endpoint + template?
- Q2 Rating: tapping a star hands off to existing `rate.tsx` with score pre-filled (recommended, smallest),
  or rebuild tags + comment inline on the summary.
- Q3 Call driver after trip end: hidden (recommended) or keep for lost-item cases?
- Q4 Is the post-ride moment a full page (recommended) or should the map stay visible behind a taller sheet?
