# Ride Types Implementation Plan
## Round Trip · Rental · Return Cab (One Way)

> Derived from Project Plan v4.0 PDF audit + codebase review — July 2026  
> All decisions and specs traced back to the client-approved PDF document.

---

## Core Mental Model (read this first)

Round Trip and Rental are the **same product** — hire a driver for N hours.  
The only difference is **territory constraint** and **pricing model**:

| | Round Trip | Rental |
|---|---|---|
| Territory | Outstation — crosses city boundary by definition | In-city only — boundary enforced |
| Destination | Fixed (A → B → A) | None (user goes wherever within city) |
| Duration input | Hour selector (4 / 6 / 8 / 10 / 12h) | Package selector (1 / 2 / 4 / 6 / 8 / 10h + km cap) |
| Pricing model | Metered (km + min) + hourly surcharge | Flat package + overage (extra km / extra min) |
| Stop charges | Yes | No |
| Km cap | None — actual distance billed | 10 km per hour (package limit) |
| Min duration | 4 hours | 1 hour |
| Driver mode | Standard only | Standard only |
| Return Cab eligibility | No | No |

---

## What Is Correct — Do Not Touch

- Home page: 3 tabs (One Way, Round Trip, Rental) — correct per spec
- Backend `goOnline` — accepts `mode: 'return_cab'` + `destinationCityId` — correct
- `createSession` + `return_cab_routes` insertion on go-online — correct
- `findReturnCabDrivers` PostGIS corridor query in repository — correct
- Dual OTP flow (start + end), ride state machine — correct
- Rental 10 km/hr package ratio in seed (km_limit = duration_hours × 10) — correct
- `clampTripHours` minimum-4-hour enforcement in backend service — correct
- `trip_hours` column in rides table driving hour_rate surcharge — correct
- Rental page package selector and fare summary UI — structurally correct
- Backend booking service handling `tripHours`, `rentalPackageId` — correct

---

## Critical Bug — Fix Before Anything Else

### `returnAt` in Round Trip is WRONG

**What the spec says (three references):**
- Section 3: "user selects source, destination, optional intermediate stops, and **total trip duration in hours**"
- Section 6 pricing: `Fare = (Rate_km × km) + Min_fare + (Rate_min × min) + **(hrs × Hour_rate)** + Stop_charges`
- Section 7 app scope: "Round Trip Screen: Source, destination, optional stops, **hour selector**, vehicle selector"

**What the current implementation does:**  
`/round-trip` shows a date/time picker ("When do you want to return?"). Hours are derived as `returnAt - now`. This is wrong.

**Why it's wrong:**  
`returnAt` conflates two separate spec concepts:
1. **Round Trip duration** = how long the driver is hired. This is just `tripHours`. No date/time.
2. **Advance booking** = schedule any ride for a future time (Section 5). A separate feature for all ride types.

The driver is with you for N hours. When you're ready to return, you return. No scheduled return pickup exists in the spec.

**Impact:** `return_at` DB column stays (for future advance booking feature). It just must not be set for Round Trip bookings.

---

## Phase 1 — Data Fixes
**Severity: HIGH · No UI changes · Unblocks correct fare display**

### Step 1.1 — Rate cards: update to spec pricing table

File: `api/src/db/migrations/016_seed.sql`

Current seed has Sedan at Rs.10/km, Rs.1.20/min, min_fare=Rs.80.  
Spec defines:

| Category | Rate/km | Rate/min | Min Fare | Return Rate/km | Hour Rate (Round Trip) |
|---|---|---|---|---|---|
| Hatchback | Rs.10 | Rs.1.50 | Rs.200 | Rs.8 | Rs.60 |
| Sedan | Rs.13 | Rs.2.00 | Rs.250 | Rs.11 | Rs.100 |
| SUV | Rs.17 | Rs.2.50 | Rs.350 | Rs.14 | Rs.130 |
| Luxury | Rs.25 | Rs.4.00 | Rs.500 | Rs.20 | Rs.200 |

> Note: `return_rate_per_km` is for Return Cab (one_way variant).  
> `hour_rate` is for Round Trip duration surcharge.  
> Rates are admin-configurable — seed is the baseline, not locked in code.

**Verify:** Run a fare estimate for Sedan 30km/45min/6h round trip.  
Expected: `(13×30) + 250 + (2×45) + (6×100) + 0 = Rs.1,380` per spec example.

---

### Step 1.2 — Rental packages: fix extra_per_km and add missing categories

File: `api/src/db/migrations/016_seed.sql`

**Bug:** `extra_per_km` seeded as Rs.12 for Sedan/SUV. Spec says Rs.10.  
**Missing:** Hatchback and Luxury have zero packages → "No packages" error on rental page.

Changes:
- All categories: `extra_per_km = 10.00`, `extra_per_min = 1.50`
- Add 6 packages for Hatchback (cheaper base rates)
- Add 6 packages for Luxury (higher base rates)
- Keep Sedan and SUV packages, just fix the overage rates

Package structure (all categories follow same hour/km ratio):
```
1h  → 10km
2h  → 20km
4h  → 40km
6h  → 60km
8h  → 80km
10h → 100km
```

Package base fares scale by category (Hatchback cheapest, Luxury highest).

**Verify:** All 4 category tabs on rental page show packages. Overage rates show Rs.10/km.

---

## Phase 2 — Round Trip Page Rewrite
**Severity: HIGH · Fixes the core `returnAt` bug · User-facing**

### Step 2.1 — Remove date/time picker, add hour selector

File: `apps/user/app/(main)/round-trip/page.tsx`

**Remove:**
- `DateTimePickerSheet` import and component render
- `returnAt` state (`useState<Date | null>`)
- `pickerOpen` state
- `useMemo` that derives `tripHours` from `returnAt`
- `clampTripHours(returnAt)` call (this was passing a Date, not a number)
- `DateTimePickerSheet` props and `min={new Date(Date.now() + 4 * 60 * 60 * 1000)}`
- `CalendarClock` icon import (no longer needed)
- The entire "Return date & time" section block (lines 179–227)

**Add:**
- `HOUR_OPTIONS = [4, 6, 8, 10, 12]` constant
- `selectedHours` state (`useState<number | null>(null)`)
- Hour chip selector UI (renders after destination is set):

```
How long do you need the driver?

[4h]  [6h]  [8h]  [10h]  [12h]
```

Active chip: indigo fill. Inactive: outlined. Minimum enforced visually (no option below 4h).

**Update `handleProceed`:**
- Remove `returnAt: returnAt.toISOString()` from params
- Add `tripHours: String(selectedHours)`
- Remove `returnAt === null` from canProceed check
- Add `selectedHours === null` to canProceed check

**Update button label:**
- Remove references to returnAt
- `tripHours !== null ? \`Choose your cab · ${selectedHours}h round trip\` : ...`

**Keep unchanged:**
- Source / destination / search flow
- Route meta row (km each way, duration, both legs)
- "What's included" info card
- Bottom CTA bar structure
- All animation, styling, color tokens

**Verify:**
- No `returnAt` in URL when proceeding to select-ride
- URL has `tripHours=6` (or whatever was selected)
- Chips are the only hour-selection mechanism
- CTA disabled until both destination AND hours are set

---

### Step 2.2 — Fix select-ride page round trip param handling

File: `apps/user/app/(main)/select-ride/page.tsx`

**Current:** Reads `returnAt` from URL params, re-derives `tripHours` from it for round trip  
**Fix:** Read `tripHours` directly from URL for `rideType=round_trip`

Changes:
- `const tripHours = sp.get('tripHours') ? parseInt(sp.get('tripHours')!) : undefined`
- Remove `returnAt` param reading for round trip context
- Do not forward `returnAt` in the booking API call for round_trip
- Fare estimate request for round_trip: pass `tripHours` directly (already done in backend, confirm frontend passes it)

**Verify:**
- Fare estimate for round trip shows hour surcharge component
- Booking API call body has `tripHours` but no `returnAt` for round_trip
- DB record: `return_at IS NULL`, `trip_hours = 6`

---

### Step 2.3 — Add optional intermediate stops to Round Trip

File: `apps/user/app/(main)/round-trip/page.tsx`

Per spec Section 3: "optional intermediate stops" for round trips.

**What to build (minimal):**
- "Add a stop" button appears below destination, after destination is set
- Tapping opens same `/search` page with `backTo=round_trip` and `stopIndex=0`
- Up to 3 stops, each searchable
- Stops shown as removable chips below destination
- Passed as `stops[0][address]=...&stops[0][lat]=...` etc. to select-ride

**Stop charges:** already handled in fare engine (`stop_charges` per `ride_stops` table).

**Priority:** Medium — core spec requirement but doesn't block booking. Implement after Steps 2.1/2.2 are working.

---

## Phase 3 — Return Cab Surface in One Way
**Severity: HIGH · Key product differentiator per spec · User-facing**

Per spec Section 3:
> "Return Cab is NOT a separate tab. It surfaces intelligently inside the One Way screen based on driver availability."

### Step 3.1 — New API endpoint for return cab driver availability

File: `api/src/modules/rides/rides.controller.ts`

Add: `GET /api/v1/rides/return-cab-available?pickupLat=&pickupLng=&dropLat=&dropLng=&categoryId=`

The `findReturnCabDrivers` repository function already exists. Wire it to an HTTP route.

Returns: `{ drivers: NearbyDriver[], count: number }` — same shape as standard nearby driver response.

**Verify:** Endpoint returns drivers when return_cab_routes exist on the corridor, empty array otherwise.

---

### Step 3.2 — Parallel query on select-ride for One Way

File: `apps/user/app/(main)/select-ride/page.tsx`

When `rideType=one_way`:
- Fire two parallel fetches: return cab availability + standard driver fare estimates
- Use `Promise.all` — both run simultaneously

**Display logic:**
- Return cab results → render first, with green "Return Cab" badge + discounted fare (`return_rate_per_km` from rate card)
- Standard results → render below, no badge
- If no return cab drivers: standard results only, no empty section, no placeholder
- If no results at all: existing "no drivers" empty state

**Vehicle card changes for return cab entries:**
```
┌─────────────────────────────────────┐
│ 🟢 RETURN CAB  [Sedan · Dzire]      │
│ ₹700  ← discounted                 │
│ (vs standard ₹880)  Save ₹180      │
│ Available now · on route to [City] │
└─────────────────────────────────────┘
```

Green badge color: `#059669` (emerald-600). Label: "RETURN CAB".

**Verify:**
- When return cab drivers exist on Bhubaneswar→Puri corridor: they appear first with green badge
- When no return cab drivers: only standard options show, no UI gap
- Tapping a return cab vehicle proceeds to booking with `driverMode=return_cab` context

---

### Step 3.3 — Booking with return cab context

When user selects a return cab vehicle option:
- Booking API call includes the specific driver/session for the return cab
- Fare calculated at `return_rate_per_km` (discounted) not `rate_per_km`
- Driver matched directly (not broadcast to nearby) — return cab driver gets priority assignment per spec

> "Return Cab bookings are given priority assignment to ensure the driver gets a ride on their return leg as quickly as possible." — PDF Section 2

---

## Phase 4 — Driver Return Cab Mode (Go Online)
**Severity: HIGH · Required for return cab feature to have supply · Driver-facing**

Per spec Section 2:
> "When a driver taps Go Online, a mode selection popup appears with two tabs."

### Step 4.1 — Restructure Go Online into a two-tab sheet

File: `apps/driver/src/pages/GoOnline/ModeSelection.tsx`  
File: `apps/driver/src/pages/GoOnline/ReturnCabSetup.tsx`

**Current:** Two separate cards, Return Cab marked "Coming Soon" (opacity 0.55, disabled)  
**Replace with:** Two-tab sheet, both tabs active

Tab 1 — Standard Mode (existing `StandardConfirm.tsx` content, unchanged):
- GPS auto-detect
- Pre-ride checklist
- Single tap "Go Online Now"

Tab 2 — Return Cab Mode (replace "Coming Soon" with):
```
┌─────────────────────────────────────┐
│  Where are you heading?             │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Select destination city ▾   │    │  ← dropdown from /api/v1/geo/cities
│  └─────────────────────────────┘    │
│                                     │
│  You'll only receive rides going    │
│  towards [Puri].                    │
│  Discounted rates apply.            │
│                                     │
│  [Go Online as Return Cab]          │
└─────────────────────────────────────┘
```

**On confirm:**
```typescript
driverRideApi.goOnline({
  mode: 'return_cab',
  vehicleId,
  categoryId,
  lat,
  lng,
  destinationCityId,  // from city dropdown
})
```

Backend already handles this correctly — creates `return_cab_routes` entry with PostGIS corridor.

**Verify:**
- Driver can select Return Cab tab, pick a city, tap Go Online
- `driver_sessions` row: `mode = 'return_cab'`, `destination_city_id = [selected]`
- `return_cab_routes` row created with corridor LINESTRING
- Driver appears in `findReturnCabDrivers` results when user searches on their corridor

---

### Step 4.2 — Driver Home: Return Cab mode indicator

File: `apps/driver/src/pages/Home.tsx`

When driver is online in return_cab mode, show a persistent header badge:
```
🟢 Return Cab Mode — heading to Puri
```

When driver reaches destination city and completes a return cab ride:
- Prompt: "You've reached Puri. Switch to Standard Mode to accept all ride types?"
- [Switch to Standard] [Stay in Return Cab]

Per spec: "If a Return Cab mode driver has reached their destination city, they are prompted to switch to Standard Mode."

---

## Phase 5 — Rental City Boundary Enforcement
**Severity: MEDIUM · Protects users from inflated bills · Requires migration**

Per spec Section 3:
> "Each city has a defined geographic polygon stored in PostGIS. The system monitors the vehicle position during rental trips and triggers an alert when the boundary is crossed."

### Step 5.1 — Migration: add boundary polygon to cities

New migration file: `api/src/db/migrations/017_city_boundaries.sql`

```sql
ALTER TABLE cities ADD COLUMN IF NOT EXISTS boundary geometry(Polygon, 4326);

-- Seed rough bounding polygons for Phase 1
-- Bhubaneswar: approx 85.75–85.92 E, 20.20–20.36 N
-- Cuttack:     approx 85.82–85.93 E, 20.42–20.52 N  
-- Puri:        approx 85.79–85.88 E, 19.77–19.85 N

UPDATE cities SET boundary = ST_GeomFromText('POLYGON(...)', 4326)
WHERE name = 'Bhubaneswar';
-- (repeat for Cuttack, Puri)

CREATE INDEX idx_cities_boundary ON cities USING GIST (boundary);
```

**Verify:** `SELECT ST_Contains(boundary, ST_SetSRID(ST_MakePoint(85.82, 20.29), 4326)) FROM cities WHERE name='Bhubaneswar'` returns true for a point inside Bhubaneswar.

---

### Step 5.2 — GPS flush worker: boundary check during rental

File: `api/src/modules/rides/submodules/gps/gps.service.ts`

During GPS batch flush, for rides where `ride_type = 'rental'` and `status = 'in_progress'`:

```typescript
const isInsideCity = await checkInsideCityBoundary(lat, lng, ride.origin_city_id)
if (!isInsideCity) {
  socketEvents.emitToRideRoom(ride.id, 'rental:boundary_crossed', {
    cityName: ride.origin_city_name,
  })
}
```

Emit once per boundary crossing event (debounce — don't spam if driver keeps crossing back and forth). Use Redis key `rental:boundary_crossed:{rideId}` with 5-min TTL to prevent repeated alerts.

**Verify:** Simulating driver GPS outside city boundary during a rental ride triggers the WebSocket event.

---

### Step 5.3 — User app: boundary alert on ride tracking screen

File: `apps/user/app/(main)/ride/[id]/page.tsx` (or wherever live tracking renders)

Listen for `rental:boundary_crossed` WebSocket event. Show a dismissable banner:

```
┌─────────────────────────────────────────────┐
│ ⚠ You've left Bhubaneswar                  │
│ Outstation rates may apply if you continue. │
│ Consider switching to a One Way booking.    │
│                                    [Dismiss]│
└─────────────────────────────────────────────┘
```

Alert is informational only — no forced booking conversion. User can dismiss.

---

## Phase 6 — UI/UX Polish
**Severity: LOW · Correctness first, polish after**

### Step 6.1 — Fare breakdown display on select-ride

**Round Trip breakdown** (after Phase 2):
```
Sedan — 6h Round Trip               ₹1,380
─────────────────────────────────────────
Distance (30 km × ₹13)              ₹390
Travel time (45 min × ₹2)           ₹90
Base charge                          ₹250
Duration surcharge (6h × ₹100)      ₹600
1 stop                              ₹50
```

**Rental breakdown** (after Phase 1):
```
Sedan — 6 Hour Package              ₹900
─────────────────────────────────────────
Package includes 60 km
Extra km: ₹10/km · Extra min: ₹1.50/min
```

### Step 6.2 — Home tab UX hints

On the home page 3-tab row, add subtle sub-labels:

| Tab | Current sub | Better sub |
|---|---|---|
| One Way | "City to city" | "One way · best fare" |
| Round Trip | "There & back" | "Driver stays with you" |
| Rental | "By the hour" | "Within city · hourly" |

The "Within city" label on Rental sets user expectation before they book.

---

## Optimization Notes

### Pricing engine — no change needed
`fare.ts` uses `max(metered, min_fare)` as a floor. This is correct industry practice.  
The spec formula `= km + Min_fare + min + hour` reads `Min_fare` as a surcharge in the example  
because the example's metered value (Rs.480) exceeds min_fare (Rs.250) — so the floor has no effect.  
The formula is identical in outcome. Do not change `fare.ts` logic.

### Redis caching — follow spec Section 9
One Way search: cache results by `(src_geohash + dst_geohash)` for 10 seconds.  
Prevents repeated identical queries when multiple users search the same corridor simultaneously.  
Implement when Return Cab feature is live (Phase 3).

### `return_at` column in rides table
Keep the column. Do not remove it. It is reserved for the advance booking feature (Section 5 of spec).  
Round Trip bookings: `return_at = NULL` always.  
Future: a user scheduling any ride for a future time will set `return_at` = scheduled departure time.

### Driver session `destination_city_id`
Already exists in schema. Only populated when `mode = 'return_cab'`. No schema change needed for Phase 4.

---

## Build Sequence Summary

```
Phase 1 — Data Fixes (no UI changes, high impact)
  1.1  Update rate cards in seed to spec pricing table          [HIGH]
  1.2  Fix rental extra_per_km (12→10), add Hatchback+Luxury   [HIGH]

Phase 2 — Round Trip Rewrite (fix the returnAt bug)
  2.1  Replace date/time picker with hour chip selector         [HIGH]
  2.2  Fix select-ride to read tripHours directly               [HIGH]
  2.3  Add optional intermediate stops UI                       [MEDIUM]

Phase 3 — Return Cab in One Way (key product differentiator)
  3.1  New API endpoint exposing findReturnCabDrivers           [HIGH]
  3.2  Parallel query + priority display on select-ride         [HIGH]
  3.3  Booking flow for return cab selection                    [HIGH]

Phase 4 — Driver Return Cab Mode (supply side)
  4.1  Replace "Coming Soon" with functional two-tab sheet      [HIGH]
  4.2  Driver home: Return Cab mode indicator + switch prompt   [MEDIUM]

Phase 5 — Rental City Boundary (rental protection)
  5.1  Migration: add boundary polygon to cities                [MEDIUM]
  5.2  GPS worker: ST_Contains check during rental rides        [MEDIUM]
  5.3  User app: boundary crossed alert banner                  [MEDIUM]

Phase 6 — UI/UX Polish
  6.1  Fare breakdown display on select-ride                    [LOW]
  6.2  Home tab sub-label copy improvements                     [LOW]
```

---

## Files Touched Per Phase

| Phase | Files |
|---|---|
| 1 | `api/src/db/migrations/016_seed.sql` |
| 2.1 | `apps/user/app/(main)/round-trip/page.tsx` |
| 2.2 | `apps/user/app/(main)/select-ride/page.tsx` |
| 2.3 | `apps/user/app/(main)/round-trip/page.tsx` + search page backTo handling |
| 3.1 | `api/src/modules/rides/rides.controller.ts`, `rides.validator.ts` |
| 3.2 | `apps/user/app/(main)/select-ride/page.tsx` |
| 3.3 | `apps/user/lib/ride-api.ts` |
| 4.1 | `apps/driver/src/pages/GoOnline/ModeSelection.tsx`, `ReturnCabSetup.tsx` |
| 4.2 | `apps/driver/src/pages/Home.tsx` |
| 5.1 | New migration `api/src/db/migrations/017_city_boundaries.sql` |
| 5.2 | `api/src/modules/rides/submodules/gps/gps.service.ts` |
| 5.3 | User app ride tracking page |

---

*Last updated: July 2, 2026*  
*Source of truth: Cab Booking Platform Project Plan v4.0 (PDF)*
