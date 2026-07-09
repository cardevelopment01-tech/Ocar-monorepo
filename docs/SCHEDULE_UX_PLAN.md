# Schedule-for-Later: UX Audit & Redesign Plan

> **Status note (July 2026):** §3–§4's relocation plan has shipped. The schedule control moved out
> of the select-ride tab cluster into its own row/pill on `/search`, `/round-trip`, `/select-ride`,
> and `/rental`. The remaining UI redesign (trigger + picker component design) is covered and now
> implemented per `docs/ADVANCE_BOOKING_UX_AUDIT.md` (`PickupTimeChip` + `SchedulePickerSheet`).
> Do not re-execute this doc's §4 plan.

## 1. Current state (as implemented)

**Where it lives today:** `apps/user/components/ui/ScheduleRideSheet.tsx`, mounted only inside
`select-ride/page.tsx` and `rental/page.tsx`.

**The flow today:**
```
Home ("Where to?") → Search (pick destination) → [route computed] → Select-ride sheet
                                                                        │
                                                                        ├─ ride-type tabs (one-way/round-trip)
                                                                        ├─ hour chip selector (rental only)
                                                                        ├─ ⬅ "Ride now" / "Schedule for later" pills  ⬅ HERE
                                                                        ├─ no-drivers banner
                                                                        └─ ride list (car categories)
```

**Problems:**
1. **Wrong moment in the funnel.** The user has already done the expensive work (typed an address,
   waited for route/ETA calc) before being told they can schedule. If they wanted to schedule, all
   the "live ETA" / "drivers nearby" UI they just saw was irrelevant noise.
2. **No visual hierarchy.** It's two plain pills with the same weight as everything else on a sheet
   that's already busy: ride-type tabs, distance/duration text, an hour-selector, a no-drivers
   banner, then the car list. "Schedule" has to compete with all of that for a glance.
3. **No entry point on Home.** A returning user who *knows* they want to book an airport pickup for
   tomorrow 6am has no way to signal that until they've gone through the entire address flow.
4. **Mixed concerns.** Ride type (what) and schedule (when) are orthogonal decisions crammed into
   the same row, visually implying they're related.
5. **Inconsistent across flows.** Round-trip's own page (`/round-trip`) has no schedule control at
   all; it only appears once you land on `/select-ride`. Users have no idea scheduling exists for
   round-trip until deep in the flow.

## 2. How the major players place this (industry patterns)

| App | Placement | Pattern |
|---|---|---|
| **Uber** | Dedicated **"Reserve"** entry point on the home screen (own icon, same tier as UberX), *and* a "Pickup time: Now ▾" row directly above the Confirm button on the request screen | Treats "when" as a first-class product mode, not a checkbox. Reserve rides get their own confirmation copy, cancellation policy, and driver-assignment timing, set to different expectations than on-demand rides. |
| **Ola** | A "Now ▾" chip next to/inside the search bar. Tapping opens a sheet with Now / Schedule tabs *before* car selection | Time decision made at the same moment as the destination, not after. |
| **Lyft** | "Schedule" toggle inside the pickup-time row on the request screen, always visible near the top | Not buried among car options; it's part of the "confirm your trip" summary block. |
< /br>
| **Rapido / inDrive** | Explicit "Book Later" as a secondary CTA next to the primary "Book Now" button on the home screen | Two clearly distinct calls-to-action, equal visual weight, no nesting. |

**Common threads:**
- **"When" is decided early**, either on the home screen (before address entry) or immediately
  after destination entry (before car selection), never buried inside car-selection UI.
- **It's never inline with ride-type tabs.** Time and ride-type are always visually separate rows/areas.
- **It gets its own visual identity**: a clock icon and label, distinct color treatment, sometimes its
  own dedicated tile, not a plain pill matching surrounding buttons.
- **The chosen time persists visibly** through the rest of the flow (e.g., a "Pickup at 6:00 AM" chip
  stays visible on the confirm screen), so users always know which mode they're in.

## 3. Recommended redesign

**Principle:** decouple *when* from *what* and *where*. Surface it at the point the user is already
thinking about the trip as a whole, right after destination is picked, before car selection, with
its own dedicated real estate, not squeezed into the select-ride sheet.

### Recommended option: "Now ▾" chip on the Search screen, carried forward as a summary chip

```
┌─ Search screen ─────────────────┐     ┌─ Select-ride sheet ──────────────┐
│  Where from: [Sahid Nagar   ]   │     │  ●━━━━━━●  12.4 km · 24 min       │
│  Where to:   [Cuttack       ]   │     │  [Pickup: Today, 6:00 AM] 🕐 ⬅kept │
│                                  │ --> │  ─────────────────────────────── │
│  🕐 Now ▾   ⬅ NEW, own row       │     │  [One-way] [Round-trip]           │
│                                  │     │  ...ride list...                  │
└──────────────────────────────────┘     └────────────────────────────────────┘
```

- On `/search` (and `/round-trip`, `/rental`'s address-entry step), add a standalone row below the
  from/to fields: a pill labeled **"Now"** with a clock icon. Tapping opens the existing
  `DateTimePickerSheet` (Now / pick date+time), no new picker component needed, just relocate the
  entry point.
- Once set, the same pill carries into `/select-ride` as a **read-only summary chip** ("Pickup:
  Today, 6:00 PM") positioned in its own row directly under the route summary (distance/duration),
  *above* the ride-type tabs, the same real estate it occupies today, but promoted to its own row and
  restyled as a summary, not a toggle competing with everything else. Tapping it still lets you
  change it, but it's visually a confirmation chip, not a raw pill choice.
- Home screen gets no new tile. The search bar flow already leads to this screen for every ride
  type, so one relocation covers one-way, round-trip, and rental consistently (fixes problem #5).

**Why this over a home-screen "Reserve" tile:** Ocar's ride types (one-way/round-trip/rental) are
already the primary home-screen choice, and every one of them can be scheduled: schedule isn't a
4th ride type, it's a modifier on all three. Bolting a "Reserve" tile next to them would incorrectly
imply it's a 4th distinct product, and would need its own address-entry flow duplicated from the
other three. Attaching it to the search step keeps one flow for all ride types and matches Ola's
model (closer fit for Ocar's information architecture than Uber's separate-product Reserve).

### Lighter-weight alternative (if you want a smaller change first)

Keep the entry point on `/select-ride` (no changes to `/search` or `/round-trip`), but:
- Pull `ScheduleRideSheet` out of the cramped tabs/hour-selector cluster into its own full-width row
  directly below the route-summary header (distance/duration line), before the ride-type tabs.
- Restyle it as a single tappable "Pickup: Now" chip with a clock icon (opens the sheet) instead of
  a two-pill toggle, so it doesn't visually compete with the ride-type tabs directly above it.
- Only fixes problems #2 and #4. Doesn't fix #1, #3, #5 (still buried after route calc, no Home
  visibility, round-trip still only discovers it late).

## 4. Implementation plan (for the recommended option)

1. **`/search/page.tsx`**: add a "Now ▾" row under the from/to fields, wire to the existing
   `DateTimePickerSheet` (already used by `ScheduleRideSheet`), lift `scheduledFor` state here.
2. **Thread `scheduledFor` through navigation**: pass as a query param (already how `select-ride`
   receives its other params) from `/search` → `/select-ride`, and from `/round-trip` and
   `/rental`'s own address steps the same way.
3. **`/select-ride/page.tsx`**: replace the current inline `ScheduleRideSheet` usage with a read-only
   summary chip (own row, above ride-type tabs) that reads the incoming `scheduledFor` param and
   still opens `DateTimePickerSheet` on tap for changes. Remove the old cramped placement.
4. **`/round-trip/page.tsx`**: add the same "Now ▾" row at its address/hours step (currently has none),
   so round-trip scheduling is discoverable before reaching select-ride, closing the gap noted above.
5. **`/rental/page.tsx`**: same relocation; move its existing `ScheduleRideSheet` usage out of the
   cramped area into the dedicated row, consistent with the other two flows.
6. No backend/API changes needed. `scheduledFor` already flows into `bookingParams` and the booking
   API unchanged; this is purely a client-side relocation and restyle.

## 5. Open questions for you

- Do you want the full relocation (recommended option, touches `/search`, `/round-trip`, `/rental`,
  `/select-ride`), or the lighter single-file restyle on `/select-ride` only, as a first pass?
- Any preference on the chip's visual style (clock icon + text vs. a small calendar icon), or should
  I match the existing indigo accent already used elsewhere in the booking flow?
