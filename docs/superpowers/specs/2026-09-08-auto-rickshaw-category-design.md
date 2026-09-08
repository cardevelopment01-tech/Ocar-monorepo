# Auto Rickshaw Category — Design

Date: 2026-09-08
Status: Draft — pending verification

## 1. Goal

Add "auto rickshaw" as a bookable option for in-city rides, priced the same way the
existing `rental` ride type is priced today: a fixed package (duration + km) for a
minimum fare, with per-km and per-minute overage charged beyond the package.

## 2. Key finding: no new ride type needed

This codebase already has two distinct package-pricing models, mapped to two
different `ride_type` values:

| `ride_type` | Scope | Package unit | Where |
|---|---|---|---|
| `round_trip` | Outstation, multi-day | `km_per_day` + `driver_allowance_per_day` on `rate_cards` | `074_round_trip_package_billing.sql` |
| `rental` | **In-city** | `duration_minutes` + `km_limit` + `package_fare` + `extra_per_km`/`extra_per_min` on `rental_packages` | `006_m4_pricing.sql`, `030_rental_package_flexibility.sql` |

The "fixed KM/hour package + minimum fare, overage billed extra" model described for
auto rickshaw **is the `rental` model**, not `round_trip`. The user app's
`/select-ride` page already auto-redirects in-city trips to `/rental`
(`select-ride/page.tsx:116-154`, `geoApi.classifyTrip` → `scope === 'in_city'`).

**Conclusion:** auto rickshaw = a new `vehicle_categories` row, wired through the
existing `rental` ride-type pipeline. No new `ride_type` enum value, no `fare.ts`
change, no new booking flow, no new fare-estimate endpoint.

## 3. Scope decisions (confirmed)

- **Vehicle category, not a new ride type** — auto rickshaw joins
  hatchback/sedan/suv/luxury/van as a `vehicle_categories` row.
- **Rental-only** — no `one_way` or `round_trip` rate card for this category. It is
  only bookable as an in-city rental/package ride.
- **Fully isolated in the fallback ladder** — no `category_fallback_rules` entries
  in either direction. Matches the existing precedent: `087_remove_luxury_suv_fallback.sql`
  explicitly excludes hatchback/luxury/van from fallback ("never participate in
  fallback, in either direction"). A 3-wheeler can't substitute for a car and
  vice versa, so auto_rickshaw rides only ever broadcast to auto_rickshaw drivers.
- **Multiple package tiers** — reuse `rental_packages`' existing per-category,
  per-city, multi-row support (e.g. 15min/3km, 30min/5km, 60min/10km). No schema
  change; this is already how `rental_packages` works for existing categories.

## 4. Data layer changes

One new migration, e.g. `09x_auto_rickshaw_category.sql`:

1. `INSERT INTO vehicle_categories` — slug `auto_rickshaw`, `max_passengers = 3`.
2. `INSERT INTO rate_cards` for `(auto_rickshaw, rental)` only. `rate_per_km` /
   `rate_per_min` / `min_fare` are still required — `pricing.service.ts` 422s on a
   fare-estimate request if no current rate card exists for the
   `(category, ride_type)` pair, even though the rental branch of `calculateFare`
   mostly ignores these fields in favor of the selected package's
   `package_fare`/`extra_per_km`/`extra_per_min`.
3. `INSERT INTO rental_packages` — seed a small number of starter tiers with
   placeholder pricing. Real pricing is tuned by an admin afterward via the
   existing Rental Packages tab (`RentalPackagesTab.tsx`) — no UI work needed,
   it's already category- and city-generic.
4. `INSERT INTO stop_charges` — one row is required per category
   (`006_m4_pricing.sql:64-73`).
5. **No `category_fallback_rules` rows.**
6. Seed `vehicle_brands` / `vehicle_models` for the five 3-wheeler manufacturers
   active in Odisha, with `typical_category_id` pointing at the new category,
   mirroring the existing car-brand seed pattern in `016_seed.sql`. Full catalog,
   as supplied by the client, in Section 4.1 below.
7. **No `vehicle_models.fuel_type` column needed.** `driver_vehicles.fuel_type`
   (`004_m2_vehicles.sql:40`, validated as `petrol`/`diesel`/`cng`/`electric` in
   `drivers.validator.ts:58`) already exists as a per-vehicle field, generic across
   every category, and is already collected in both the driver onboarding flow and
   the admin vehicle-edit screen. Several of the model names below encode their own
   fuel variant (e.g. "RE CNG", "Ape E City", "Alfa DX Duo CNG"); the model catalog
   itself carries no fuel_type column, the driver still separately selects the
   correct value at registration, same as it already works for every other
   category.

### 4.1 Full manufacturer / model catalog (client-supplied, Odisha market)

| Brand | Models |
|---|---|
| Bajaj | RE &middot; RE CNG &middot; Compact RE &middot; Gogo &middot; Maxima X Wide &middot; Maxima Z |
| Piaggio | Classic Diesel &middot; Ape City Plus &middot; Ape E City &middot; Ape E City FX Max &middot; Ape Auto Dx |
| Atul | Gem Paxx CNG &middot; Elite Plus Electric &middot; Rik &middot; Elite Paxx Electric |
| TVS | King Deluxe &middot; King EV Max &middot; King Duramax &middot; King Duramax Plus |
| Mahindra | Treo Plus &middot; Alfa DX Duo CNG &middot; Alfa DX &middot; Udo Electric &middot; E Alfa Plus |

24 models across 5 brands, replacing the earlier 4-brand/5-model placeholder list
(Atul was missing entirely, and the other four brands' model names did not match
the real Odisha-market lineup). Every model maps to `typical_category_id =
auto_rickshaw`.

## 5. Backend change: close the rental overage-billing gap — DEFERRED

**Status: deferred, pending client confirmation (2026-09-08).** This section is kept
for reference — the analysis is still accurate and the fix may be picked up later —
but it is **not part of the current implementation scope**. Auto_rickshaw ships
without it: rental fares (all categories, not just auto_rickshaw) continue to
settle at `total_estimated`, same as they do today. See the implementation plan's
"Out of scope for now" note.

This would have been the one non-seed code change, and it affects existing
`rental` rides too, not just auto_rickshaw — which is exactly why it needs
client sign-off before shipping (it changes settlement behavior for a ride type
that's already live).

**Current state:** `rides.service.ts`'s `verifyEndOTP` does server-side
GPS-breadcrumb-based distance/duration reconciliation
(`getGpsTrackedDistanceKm`, with its 2.5x-of-booked-distance sanity ceiling and
&lt;2-GPS-points fallback) **only when `ride.ride_type === 'round_trip'`**
(gated at `rides.service.ts` ~line 1895, recalculation block ~1940-2054). For
every other ride type, including `rental`, the server just stores whatever
`actualDistanceKm`/`actualDurationMin` the driver app sends — and the driver app
(`TripInProgress.tsx:360-376`) computes those from a **straight-line haversine
distance × 1.3**, not real driven distance. `total_final` stays `null` for rental,
so rental fares always settle at `total_estimated`; overage is not reliably
reconciled against what actually happened.

**Change:** extend the `ride.ride_type === 'round_trip'` condition in
`verifyEndOTP` to also cover `'rental'`, reusing the same
`getGpsTrackedDistanceKm` path (same sanity ceiling, same fallback rule) instead
of trusting the client-reported straight-line estimate.

**Why now, not deferred:** auto_rickshaw is expected to be a higher-volume,
lower-fare in-city product than round_trip — inaccurate overage billing matters
more here (percentage-wise) than it did for round_trip's typically longer,
lower-frequency outstation trips.

**Risk called out explicitly:** this changes settlement behavior for the
*existing* `rental` ride type, not just the new category. It should be tested
against existing round-trip/rental ride flows before shipping, since it changes
how already-live rental rides get billed at trip end.

## 6. Frontend changes

Small and mostly cosmetic — none of it is new logic, just extending
category-slug lists that are hardcoded in a few places, and one new icon.

- **`apps/user/components/ui/VehicleIcon.tsx`** — add an auto-rickshaw SVG body +
  `BODIES` map entry. Today, an unrecognized category slug silently falls back to
  the sedan silhouette (`VehicleIcon.tsx:152`), which would be visibly wrong for a
  3-wheeler.
- **`apps/admin/app/(dashboard)/config/rate-cards/page.tsx`** and
  **`.../rate-cards/shared.tsx`** — add `'auto_rickshaw'` to
  `CATEGORY_ORDER_ITEMS` / `CATEGORY_ORDER`. Without this, the category's rate
  card and rental package sections won't render in the admin Rate Cards page at
  all (categories not in this list are simply skipped).
- **`apps/user/app/(main)/rental/page.tsx`** — add to `FALLBACK_CATEGORIES`. Only
  exercised if the live `GET /api/v1/vehicles/categories` call fails; low risk but
  cheap to keep consistent. `select-ride/page.tsx`'s own `FALLBACK_CATEGORIES` is
  deliberately **not** touched — auto_rickshaw is rental-only and must not appear
  on the one-way/round-trip page.
- **`apps/user/app/(main)/select-ride/page.tsx`** — real bug fix, not cosmetic:
  this page fetches the live category list generically and renders every category
  unconditionally, even ones with no rate card for the current ride type. Once
  auto_rickshaw exists it would show up here as a broken, price-less card (the
  first category to expose this, since all 5 existing categories support every
  ride type). Fix: filter to categories with a successful fare estimate once
  loading has settled.
- **Driver onboarding** (`onboarding-api.ts`, vehicle registration screens) —
  **no code change**. The category dropdown is already fully data-driven from the
  public categories endpoint.

## 7. What's explicitly out of scope

- New `ride_type` enum value.
- Any change to `fare.ts`'s `calculateFare`/`estimateFare`.
- New fare-estimate endpoint or booking flow.
- `one_way` or `round_trip` support for auto_rickshaw.
- `category_fallback_rules` entries for auto_rickshaw (either direction).
- Auto-rickshaw-specific onboarding fields (e.g. `ac_availability` special-casing)
  — cosmetic only; auto rickshaws simply get `ac_availability: false`.
- **The rental GPS-reconciliation fix (Section 5)** — deferred pending client
  confirmation. Rental fares (all categories) keep settling at `total_estimated`.

## 8. Verification plan

No new algorithmic logic is being introduced (the fare-calc code path is
unchanged), so this is verified end-to-end rather than with a unit-level
`demo()`/assert check:

1. Run the migration; confirm `vehicle_categories`, `rate_cards`,
   `rental_packages`, and `stop_charges` rows exist for `auto_rickshaw`.
2. Confirm the user app's `/rental` page lists auto_rickshaw once seeded, with its
   own icon (not the sedan fallback), and that it does NOT appear on
   `/select-ride` (one-way/round-trip).
3. Confirm a driver can onboard selecting the `auto_rickshaw` category.
4. Book an end-to-end rental ride as `auto_rickshaw`: request → assign → start →
   drive → end. Fare settles at the booking-time estimate, same as any other
   rental category today (Section 5's fix is deferred).
5. Re-run an existing (non-auto-rickshaw) rental ride through the same flow to
   confirm nothing regressed.
