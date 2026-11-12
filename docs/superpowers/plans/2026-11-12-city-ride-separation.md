# City Ride (metered in-city mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the hourly Rental from a new Uber/Ola-style City ride mode, without changing behaviour for any old rider, driver or web build.

**Architecture:** Detach first: a rental stops reading its `rate_cards` row (stop charge and cancellation fee move to `rental_packages`, snapshotted on the ride). Then add `trip_mode` (`standard` | `city`) to `rate_cards` and `rides`; a city ride keeps `ride_type = 'one_way'` on the wire and is priced from copies of the rental cards. The new apps opt in with `trip_mode: 'city'` behind the `city_rides_enabled` flag; the rental cards are closed only after the detach is verified live.

**Tech Stack:** Express 4 + TypeScript (`exactOptionalPropertyTypes`), Postgres 18 migrations, vitest, Next.js admin and user web, Expo rider app.

**Spec:** `docs/superpowers/specs/2026-11-12-city-ride-design.md`

## Global Constraints

- Rate cards are never UPDATEd: insert a new row and set `effective_to` on the old one (CLAUDE.md "Rate card versioning"). Migration numbers continue from `135` (next is `136`).
- Additive only for the API: no field or route is renamed or removed in Phases A to C. A request without `trip_mode` behaves exactly as today.
- `rides.ride_type` stays one of `one_way | round_trip | rental`; never write a new value to it.
- Pattern for optional fields under `exactOptionalPropertyTypes`: build the object, then set optional fields conditionally.
- Every migration is idempotent-safe on a fresh `pnpm migrate --fresh` and on a populated database. No `UPDATE rate_cards`.
- Production is read-only for us: preflight SQL is handed to the owner to run; nothing here touches prod.
- Commits: no `Co-Authored-By` line. One commit per task. Nothing is pushed until the owner says so.
- Tests: `cd api && npx vitest run <file>` (env vars as in the existing test runs).
- Migrations run during blue/green with old and new API nodes live together: every migration must be safe for old code, must not take long locks on `rides`, and must never hard-fail a deploy for data gaps (warn and skip; the preflight is the gate).
- **D7 (owner decision before Task 3):** today `endRideEarlyAsDriver` re-prices ANY ride type, rentals included, from the rate card's per-km and per-minute (capped at the quoted fare). After the detach a rental has no card, so an early-ended rental is billed per D7: **(recommended) the full package fare** (the package is a reserved block), or keep a per-km early-end by storing the two rates on the package. Pick one; Task 3 implements it and tests it.

## Review Focus

1. A rental booked **before** Phase A deploys (or by an old API node during the blue/green overlap), cancelled after: still charged its fee and stop charge (snapshot backfill + rate-card fallback).
2. An old client sends an in-city one-way with no `trip_mode` to `createBooking`: the same 422 text as today (`/pricing/estimate` has no such guard and stays that way).
3. An admin edits the **standard** one-way card (or the city card) for a city and category: the other card must stay current (both `createRateCard` writers must filter on `trip_mode`).
4. A **scheduled** city ride is re-priced at dispatch: it must use the city card and keep `fare_snapshots.rate_card_id` on it.
5. A rental with no rate card completes, ends early, adds a stop and cancels without a null-join or a silent fare change (D7).

---

## Phase A: Detach (ships and is verified before anything else)

### Task 1: Preflight, the rental cards must exist

**Files:**
- Create: `api/scripts/preflight-rental-cards.sql`
- Create: `api/src/db/migrations/136_rental_package_fees.sql` (first block only in this task)
- Test: `api/tests/unit/pricing/rental-cards-preflight.test.ts`

**Interfaces:**
- Produces: a SQL file the owner runs read-only on each environment, returning rows that are gaps; migration 136 raises an exception listing the same gaps.

- [ ] **Step 1: Write the failing test.** `rental-cards-preflight.test.ts` reads `preflight-rental-cards.sql` as text and asserts: it contains `rental_packages`, `rate_cards`, `effective_to IS NULL`, and `COALESCE(rp.city_id`; named `it('looks for packages whose category has no current rental card (city override or global)')`.
- [ ] **Step 2: Run it** (`npx vitest run tests/unit/pricing/rental-cards-preflight.test.ts`), expect FAIL (file missing).
- [ ] **Step 3: Write the SQL**: select every active `rental_packages` row `rp` with no current `rate_cards` row where `ride_type='rental'`, `category_id = rp.category_id`, `effective_to IS NULL` and `(city_id = rp.city_id OR city_id IS NULL)`. Returns `(package_id, category_id, city_id)` gaps. Migration 136 starts with a `DO $$` block running the same query and `RAISE WARNING 'rental packages without a current rental rate card: %'` (never an exception: a data gap must not fail a blue/green deploy); the package backfill in Task 2 skips unmatched rows and leaves their fees 0 until the owner fixes them from the preflight output.
- [ ] **Step 4: Run test, expect PASS.** Then run the SQL against the local test DB: `docker exec -i ocar_pr1_test_pg psql -U postgres -d ocar_test < api/scripts/preflight-rental-cards.sql`; expect 0 rows.
- [ ] **Step 5: Commit** `feat(pricing): preflight that every rental package has a current rental rate card`.
- [ ] **Owner action (not code):** run the same SQL read-only on staging and prod and report the rows. Task 2 is not merged until both return 0 rows (this is the gate; the migration only warns).

### Task 2: Fees on the package, snapshotted on the ride

**Files:**
- Modify: `api/src/db/migrations/136_rental_package_fees.sql`
- Modify: `api/src/modules/rides/rides.repository.ts` (`insertFareSnapshot` near line 438; `getRideStopCharge` near line 571)
- Modify: `api/src/modules/rides/rides.service.ts` (`readCancellationFee` near line 1848)
- Test: `api/tests/unit/rides/rental-fees-snapshot.test.ts`

**Interfaces:**
- Produces (schema): `rental_packages.stop_charge NUMERIC(8,2) NOT NULL DEFAULT 0`, `rental_packages.cancellation_fee NUMERIC(8,2) NOT NULL DEFAULT 0`, `fare_snapshots.rental_stop_charge NUMERIC(8,2) NULL`, `fare_snapshots.rental_cancellation_fee NUMERIC(8,2) NULL`.
- Produces (code): `getRideStopCharge(rideId: bigint): Promise<number>` prefers `fs.rental_stop_charge`, else the rate card as today; `readCancellationFee` prefers the ride's `rental_cancellation_fee` for `ride_type = 'rental'`, else the rate-card lookup as today.

- [ ] **Step 1: Write failing tests.** `rental-fees-snapshot.test.ts`: (a) `getRideStopCharge` with a snapshot row `{ rental_stop_charge: '15', rc_stop_charge: '0' }` returns `15`; (b) with `rental_stop_charge: null` returns the rate-card value (fallback, Review Focus 1); (c) cancelling a `rental` ride whose snapshot has `rental_cancellation_fee: '50'` charges 50 without querying `rate_cards`; (d) a `one_way` ride still reads the rate card.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Migration 136 (after the guard):** add the four columns; backfill `rental_packages.stop_charge/cancellation_fee` from the current rental card matching `(category, COALESCE(city override, global))`; backfill `fare_snapshots.rental_stop_charge/rental_cancellation_fee` for every non-terminal rental (`rides.status IN ('scheduled','requested','accepted','driver_arrived','in_progress','returning')`) from the card in `fs.rate_card_id` (same style as migration 099).
- [ ] **Step 4: Implement** the two reads as above, and make `insertFareSnapshot` write the package's two fees into the new snapshot columns when `rentalPackageId` is set.
- [ ] **Step 5: Run the new test plus `npx vitest run tests/unit/rides`, expect PASS.** Apply the migration to the local DB and check `SELECT count(*) FROM rental_packages WHERE cancellation_fee = 0` is 0 where a card had a fee.
- [ ] **Step 6:** The rate-card fallbacks stay in code until Task 11's trigger (old API nodes keep writing rentals with the snapshot columns NULL during the blue/green overlap).
- [ ] **Step 7: Commit** `feat(rentals): stop charge and cancellation fee live on the package and are snapshotted on the ride`.

### Task 3: The rental quote stops needing a rate card

**Files:**
- Modify: `api/src/modules/pricing/pricing.service.ts` (`getFareEstimate`, the `Promise.all` near line 38)
- Modify: `api/src/modules/rides/rides.service.ts` (lines near 946 and 1003: `rateCardId`, `rateCardIdAtBooking`)
- Modify: `api/src/modules/pricing/pricing.types.ts` (`FareEstimate.rate_card_id: number | null`)
- Test: `api/tests/unit/pricing/rental-quote-no-rate-card.test.ts`

**Interfaces:**
- Consumes: package fees from Task 2.
- Produces: for `ride_type = 'rental'` with `rental_package_id`, `getFareEstimate` never calls `getCurrentRateCard`, returns the same `breakdown` as today, `rate_card_id: null`, and `charge_per_stop` from the package. `fare_snapshots.rate_card_id` and `rate_card_id_at_booking` are stored NULL for such rentals (both columns are nullable; verify in the migration before relying on it).

- [ ] **Step 1: Write failing tests.** (a) mock `getRentalPackage` and make `getCurrentRateCard` throw; the rental quote still returns the package fare + `charge_per_stop` equal to the package's `stop_charge`; (b) the `breakdown.total` equals the value the old path produced for the same inputs (golden numbers from `lib/fare.ts`: package 500, no overage, surge 1 gives 500); (c) a **one-way** quote still throws 422 "No rate card" when none exists.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** In `getFareEstimate`, skip the rate-card fetch when `ride_type === 'rental' && pkg`; feed `estimateFare` a zero `rate_card` (the pattern already used at `lib/fare.ts:266`); a rental with no `rental_package_id` keeps the old 422. In `rides.service.ts` make the two `BigInt(fareEstimate.rate_card_id)` uses null-safe.
- [ ] **Step 4: Audit every read of `fare_snapshots.rate_card_id`** and make each null-safe, with a test per item (a rental with a NULL card): the early-end recompute in `rides.service.ts` (INNER JOIN near line 2188; implement D7 here), `getRideRatePerMin` in `rides.repository.ts` (near line 649; returns 0 for a card-less ride, so confirm it is only used for one-way stop wait), `getRideStopCharge` (Task 2), `updateFareSnapshotEstimate` (near line 1735, typed non-null; widen to `number | null`), the scheduled re-quote in `jobs/processors/dispatch-scheduled.processor.ts`, and the `rate_card_id_at_booking` insert. LEFT JOINs (`RIDE_SELECT_SQL`, admin ride detail) and the round-trip snapshot loader are already safe. Tests: completing a card-less rental, early-ending it (per D7), adding a stop to it.
- [ ] **Step 4b: Check no client reads `rate_card_id` at runtime**: `grep -rn "rate_card_id\|rateCardId" apps packages --include=*.ts --include=*.tsx`; expect only type declarations (found: `apps/user/lib/ride-api.ts:23`, `apps/admin/lib/pricing-api.ts:28`, `packages/mobile-shared/src/api/types.ts:30`). Widen those three types to `number | null`.
- [ ] **Step 5: Run `npx vitest run tests/unit/pricing tests/unit/rides` and `npx tsc --noEmit`, expect PASS.**
- [ ] **Step 6: Commit** `feat(rentals): a rental quote and booking no longer depend on a rate card`.

### Task 4: Admin edits the two fees on the package

**Files:**
- Modify: `api/src/modules/admin/admin.types.ts` (`AdminRentalPackage`), `api/src/modules/admin/admin.service.ts` (`createAdminRentalPackage` line ~727, `updateAdminRentalPackage` line ~680), `api/src/modules/admin/admin.repository.ts` (list/create/update, lines ~2313-2347)
- Modify: `apps/admin/lib/pricing-api.ts` (`RentalPackageAdmin`), `apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx`
- Test: `api/tests/unit/admin/rental-package-fees.test.ts`

**Interfaces:**
- Produces: create/update accept optional `stop_charge`, `cancellation_fee` (numbers, 0 to 5000); list returns them.

- [ ] **Step 1: Failing tests:** create with `cancellation_fee: 50, stop_charge: 15` persists both; update changes only `cancellation_fee`; a negative value is rejected with `VALIDATION_ERROR`; omitting both on **update** leaves the existing values; on **create** both are required (a forgotten field must not become a free cancellation).
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** in service, repository and types; add two number inputs ("Cancellation fee", "Stop charge") to the create and edit dialogs of `RentalPackagesTab.tsx`. **Step 4: Run tests and `cd apps/admin && npx tsc --noEmit`, expect PASS.**
- [ ] **Step 5: Commit** `feat(admin): rental package fees (stop charge, cancellation fee)`.

### Gate A (no code)
Deploy Phase A and wait until the old blue/green color is drained (old nodes write rentals without the snapshot columns). Confirm with read-only SQL on staging, then prod: `SELECT count(*) FROM fare_snapshots fs JOIN rides r ON r.id = fs.ride_id WHERE r.ride_type='rental' AND r.status IN ('scheduled','requested','accepted','driver_arrived','in_progress','returning') AND fs.rental_cancellation_fee IS NULL` returns 0. Book, stop-add and cancel a test rental on staging; the fee and stop charge match the package. Only then continue.

---

## Phase B: City ride on the server (all dormant behind the flag)

### Task 5: `trip_mode` on rate cards and rides, city cards copied from rental

**Files:**
- Create: `api/src/db/migrations/137_city_ride_rate_cards.sql`
- Modify: `api/src/modules/pricing/pricing.repository.ts` (`getCurrentRateCard`, `fetchCurrentRateCardFromDb`, `rateCardKey`, **`createRateCard` expire/history/carry-forward near lines 316-370**, `getAllCurrentRateCards`), `api/src/modules/admin/admin.repository.ts` (**`createAdminRateCard` near lines 2623-2660**, the admin list near line 1967), `api/src/constants/redis-keys.ts` (rate-card key near line 72), `api/src/modules/pricing/pricing.types.ts`
- Test: `api/tests/unit/pricing/rate-card-trip-mode.test.ts`

**Interfaces:**
- Produces (schema): `rate_cards.trip_mode TEXT NOT NULL DEFAULT 'standard' CHECK (trip_mode IN ('standard','city'))`, `rides.trip_mode` the same; `rate_cards_current_idx` rebuilt on `(COALESCE(city_id,0), category_id, ride_type, trip_mode) WHERE effective_to IS NULL` and the lookup index likewise (follow migration 078).
- Produces (code): `getCurrentRateCard(categoryId: number, rideType: string, cityId: number | null, tripMode: 'standard' | 'city' = 'standard')`; the cache key includes `tripMode`.
- Data: for every current rental card insert a city card (`ride_type='one_way'`, `trip_mode='city'`, same per-km, per-minute, min fare, base fare, stop charge, cancellation fee, same city_id). Rental cards are left open.

- [ ] **Step 1: Failing tests.** (0) for BOTH `createRateCard` and `createAdminRateCard`: creating a `standard` card leaves the current `city` card for the same city and category open, and creating a `city` card leaves the `standard` one open; the history row and the carried-forward `stop_charge`, `cancellation_fee`, `base_fare` come from the card of the same `trip_mode` (Review Focus 3); (a) `rateCardKey` differs for `standard` vs `city` with identical other args (Review Focus 5); (b) `getCurrentRateCard(2,'one_way',null)` SQL filters `trip_mode = 'standard'`; with `'city'` filters `'city'`; (c) default arg keeps every existing caller on `standard`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement** repository change and migration. **Step 4:** apply to the local DB; check `SELECT category_id, trip_mode, rate_per_km FROM rate_cards WHERE effective_to IS NULL AND trip_mode='city'` shows one row per rental card including category 6; check the standard one-way quote for category 2 is unchanged. **Step 5: Run `npx vitest run tests/unit/pricing tests/unit/admin`, expect PASS.**
- [ ] **Step 6: Migration safety.** In `137`: add `rides.trip_mode` and `rate_cards.trip_mode` as `ADD COLUMN ... NOT NULL DEFAULT 'standard'` and add the CHECK constraints `NOT VALID`, then `VALIDATE CONSTRAINT` in a second statement; `SET LOCAL lock_timeout = '3s'` at the top (the migration is retried, never queued behind a long ride transaction); swap `rate_cards_current_idx` and `rate_cards_lookup_idx` in ONE transaction so the uniqueness guard is never absent. Bump the rate-card cache key prefix and read through to the DB when a cached card has no `trip_mode` (same pattern as the `base_fare` guard in `getCurrentRateCard`). The admin and public lists (`getAllCurrentRateCards`, the admin list) select `trip_mode` so duplicate one-way rows are distinguishable.
- [ ] **Step 7: Commit** `feat(pricing): trip_mode on rate cards; city ride cards copied from the rental cards`.

### Task 6: Flag, classifier hint, and booking rules

**Files:**
- Create: `api/src/db/migrations/138_city_rides_flag.sql` (seed `city_rides_enabled`, default `'false'`, boolean, not public, same style as migration 123)
- Modify: `api/src/modules/geo/geo.service.ts` (`classifyTrip`, add `city_ride_available: boolean`), `api/src/modules/rides/rides.service.ts` (`createBooking` validation near lines 796-830; persist `rides.trip_mode`), `api/src/modules/rides/rides.types.ts` (`BookingRequest.tripMode?: 'standard' | 'city'`), `api/src/modules/pricing/pricing.service.ts` (accept `trip_mode`, pass to `getCurrentRateCard`)
- Test: `api/tests/unit/rides/city-ride-booking.test.ts`, `api/tests/unit/rides/legacy-client-compat.test.ts`

**Interfaces:**
- Consumes: `getCurrentRateCard(..., tripMode)` from Task 5.
- Produces: `rides.trip_mode` is stored at booking and read back by `getFareRecomputeInput` (`rides.repository.ts` near line 1720) and passed into the scheduled re-quote in `jobs/processors/dispatch-scheduled.processor.ts`; `readCancellationFee` (`rides.service.ts` near line 1848) filters on the ride's `trip_mode` so the standard and city one-way cards never tie; `classifyTrip` returns `city_ride_available = flag on && scope === 'in_city'`; `createBooking` with `tripMode: 'city'` requires `rideType === 'one_way'`, flag on, scope `in_city`, straight distance below `IN_CITY_MAX_TRIP_DISTANCE_METRES`, at most `MAX_STOPS_PER_RIDE` stops; otherwise 422 with codes `CITY_RIDE_DISABLED`, `CITY_RIDE_NOT_IN_CITY`.

- [ ] **Step 1: Failing tests.** `city-ride-booking.test.ts`: city booking accepted when in-city, short, flag on (asserts the city card was requested and `rides.trip_mode='city'` stored); `CITY_RIDE_DISABLED` when flag off; `CITY_RIDE_NOT_IN_CITY` for an intercity pair; `tripMode:'city'` with `rideType:'round_trip'` rejected; 4 stops rejected; a scheduled city ride re-quoted at dispatch uses the city card and keeps `rate_card_id` on it (Review Focus 4); a city cancel after arrival charges the city card's fee; a category with no city card returns a 422 whose message says the ride is not available for that vehicle (Review Focus 4). `legacy-client-compat.test.ts` (Review Focus 2): the existing in-city one-way request with **no** `tripMode` still throws the exact message "This trip stays within X — book an hourly rental package instead" with `httpStatus 422`, with the flag both on and off; a `rental` and a standard `one_way` request quote identical totals before and after.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** Keep the old in-city block untouched for requests without `tripMode`. **Step 4: Run `npx vitest run tests/unit/rides tests/unit/pricing tests/unit/geo` and `npx tsc --noEmit`, expect PASS.**
- [ ] **Step 5: Commit** `feat(rides): city ride bookings behind city_rides_enabled; old requests unchanged`.

### Task 7: Dispatch radius for city rides

**Files:**
- Modify: `api/src/constants/limits.ts` (`maxPickupRadiusMetres`, signature gains a trailing `tripMode?: 'standard' | 'city'`), `api/src/jobs/processors/broadcast.processor.ts` (pass the ride's `trip_mode`, line ~127), `api/src/modules/rides/rides.service.ts` (BullMQ job payload carries `tripMode`)
- Test: `api/tests/unit/dispatch/city-ride-radius.test.ts`

**Interfaces:**
- Produces: `maxPickupRadiusMetres('one_way', slug, undefined, round, 'city')` returns 2000 for `auto_rickshaw` and 4000 otherwise (assumed, owner confirms); all existing calls (no 5th arg) return what they returned before.

- [ ] **Step 0:** audit every place that re-reads `ride_type` for dispatch (`jobs/processors/broadcast.processor.ts`, `ack-check.processor.ts`, retries) and carry `tripMode` through each.
- [ ] **Step 1: Failing tests:** the two city values; `maxPickupRadiusMetres('one_way', null)` still 10000 and `('rental','auto_rickshaw')` still 2000; round widening still adds `BROADCAST_ROUND_STEP_METRES` per round for a city ride.
- [ ] **Step 2 to 4:** run (FAIL), implement, run `npx vitest run tests/unit/dispatch src/jobs` (PASS). **Step 5: Commit** `feat(dispatch): pickup radius for city rides`.

---

## Phase C: Clients (new builds only; old builds untouched)

### Task 8: Rider app

**Files:**
- Modify: `apps/rider-mobile/src/features/booking/api.ts` (`TripClassification.cityRideAvailable`, `CreateBookingInput.tripMode`, `fetchFareEstimate` input), `features/booking/store.ts` (`tripMode`, `setTripMode`, reset), `app/booking/index.tsx` (redirect logic lines ~247-277), `app/booking/fare.tsx` (send `tripMode` in estimates, offer request and `createBooking`), `features/booking/liveCars.ts` (`showWithinMetres` mirrors Task 7), `features/home/sections.tsx` (hourly tile renamed "Rental"), `features/trip-summary/tripSummaryModel.ts` (labels: `rental` is "Rental"; `tripMode === 'city'` is "City ride"), `app/booking/rental.tsx` (title "Rentals")
- Test: `apps/rider-mobile/src/features/booking/cityRideRoute.test.ts` (new pure function `resolveInCityRoute`)

**Interfaces:**
- Produces: `resolveInCityRoute(args: { rideTypeDeclared: boolean; rideType: RideType; classification: TripClassification | null }): { path: '/booking/fare' | '/booking/rental' | null; tripMode: 'standard' | 'city' }`. When `cityRideAvailable` is true an in-city trip goes to `/booking/fare` with `tripMode 'city'` and no toast about rentals; when false or absent it returns exactly today's routes (so an API without the flag, or the flag off, behaves like today).

- [ ] **Step 1: Failing tests** for `resolveInCityRoute`: flag off, `cityRideAvailable` absent (older server), in-city + available, outside city with `rideType:'rental'` still redirects to one-way. **Step 2: Run, FAIL.** **Step 3: Implement** the function and wire it into `index.tsx` and the store; pass `tripMode` on the quote, offers preview and booking only when `'city'`. **Step 4: `cd apps/rider-mobile && npx tsc --noEmit && npx eslint src && npx vitest run`, expect PASS.**
- [ ] **Step 5: Emulator check** against the local API with the flag turned on in the local DB: an in-city trip shows the Choose a ride list (including Auto), books, and the ride tracks; with the flag off the old rental redirect appears. **Step 6: Commit** `feat(rider): City ride mode on Choose a ride, hourly mode renamed Rental`.

### Task 9: Admin rate cards and rides

**Files:**
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/page.tsx` (ride-type list `RIDE_TYPE_ORDER` line 25 gains City ride, create/edit form sends `trip_mode`; Rental stays visible but read-only with a note "priced from Rental Packages" until Task 11), `apps/admin/lib/pricing-api.ts`, `apps/admin/app/(dashboard)/rides/page.tsx` (filter by trip mode), `api/src/modules/admin/admin.service.ts` and `admin.repository.ts` (rate-card create/list/update take `trip_mode`, default `standard`; the pricing-side `createRateCard` is covered in Task 5)
- Test: `api/tests/unit/admin/rate-card-trip-mode.test.ts`

- [ ] **Step 1: Failing tests:** creating a card with `trip_mode:'city'` inserts a new row and closes the previous current city row (not an UPDATE of rates); the same category/ride_type with `standard` is untouched; omitting `trip_mode` is `standard`. **Step 2 to 4:** run (FAIL), implement, run API tests and `cd apps/admin && npx tsc --noEmit` (PASS). **Step 5: Commit** `feat(admin): City ride rate cards`.

### Task 10: User web parity

**Files:**
- Modify: `apps/user/app/(main)/search/page.tsx` (lines ~298-323), `apps/user/app/(main)/select-ride/page.tsx` (line ~145), `apps/user/lib/ride-api.ts`, `apps/user/app/(main)/home/page.tsx` (tile label)
- Test: component/unit test following the existing user-web test setup, or a manual check if none exists (state which in the commit)

- [ ] **Step 1 to 4:** same routing rule as Task 8 (`cityRideAvailable` true sends `tripMode:'city'` to `/select-ride`; otherwise unchanged). Run `cd apps/user && npx tsc --noEmit`. **Step 5: Commit** `feat(user): City ride routing on web`.

### Gate C (no code)
Turn `city_rides_enabled` on in staging for one city. Verify: a city booking by the new rider app; an **old** rider build (previous APK) on the same trip still gets redirected to Rental and books fine; a driver on the previous driver APK receives the city ride as a normal one-way and can start, add a stop, end and settle it. Then enable in one prod city.

---

## Phase D: Contract (separate releases, each with its own trigger)

### Task 11: Retire the rental rate cards (trigger: Gate A verified for 14 days and zero open rentals without snapshot fees)

**Files:**
- Create: `api/src/db/migrations/139_close_rental_rate_cards.sql`
- Modify: `api/src/modules/rides/rides.repository.ts`, `api/src/modules/rides/rides.service.ts` (remove the rate-card fallbacks added in Task 2 for rentals), `apps/admin/app/(dashboard)/config/rate-cards/page.tsx` (remove Rental from the ride types and its special cases at lines 128, 212, 743, 904, 987)
- Test: `api/tests/unit/pricing/rental-cards-closed.test.ts`

- [ ] **Step 1: Failing tests:** the migration text raises an exception if any non-terminal rental lacks `rental_cancellation_fee`; it sets `effective_to = now()` only where `ride_type='rental' AND effective_to IS NULL`; `getRideStopCharge` and `readCancellationFee` no longer query `rate_cards` for a rental. **Step 2 to 4:** run, implement, run `npx vitest run tests/unit` (PASS). **Step 5: Commit** `refactor(rentals): close the rental rate cards; rentals are priced from packages only`.

**Housekeeping in the same release:** update `api/scripts/seed-load-test-data.sql`, `api/src/db/bench-cache-invalidation.ts` and `load-tests/api-table-matrix.csv` (they read cards by category, ride type and city and would silently pick a city card); check `apps/user/app/pricing/page.tsx` and `apps/admin/lib/mock-data.ts` for rate-card assumptions.

### Task 12: Remove the flag and the redirect-to-rental code (trigger: minimum rider and web versions raised past the Task 8 and 10 builds, via the existing version policy)

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` (the in-city rule stays but now requires `tripMode:'city'`, error code kept), `api/src/modules/geo/geo.service.ts` (drop `city_ride_available`), `apps/rider-mobile/src/app/booking/index.tsx`, `apps/user/app/(main)/search/page.tsx`, `select-ride/page.tsx` (drop the rental redirects), migration `140` deleting the `city_rides_enabled` row
- Test: update `legacy-client-compat.test.ts` to the new contract; delete the cases that only existed for old clients

- [ ] **Step 1 to 5:** failing tests for the new contract, implement, run all three suites, commit `refactor: City ride is the only in-city mode; remove the transition flag and redirects`. This is the planned deletion of every temporary compatibility branch added above.
