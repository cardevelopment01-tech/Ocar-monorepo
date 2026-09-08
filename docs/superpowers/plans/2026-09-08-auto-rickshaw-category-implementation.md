# Auto Rickshaw Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "auto rickshaw" as a bookable in-city vehicle category priced through the existing `rental` ride-type package model (fixed package fare + km/min overage), and close the pre-existing gap where rental fares never reconcile against actual driven distance at trip end.

**Architecture:** Auto rickshaw is a new `vehicle_categories` row wired through the existing rental pricing pipeline (`rate_cards` + `rental_packages`, no new `ride_type`, no `fare.ts` change). The one real backend change extends `verifyEndOTP`'s existing round_trip-only GPS-breadcrumb reconciliation to also cover `rental`, using rental-package fields frozen onto `fare_snapshots` at booking time (since, unlike `rate_cards`, `rental_packages` isn't versioned and can't be safely re-joined after the fact). Frontend changes are small: a new vehicle icon, two hardcoded category-order lists, and a real bug fix on the one-way/round-trip page that this feature would otherwise expose (it currently renders every vehicle category unconditionally, even ones with no rate card for the selected ride type).

**Tech Stack:** PostgreSQL migrations, Express/TypeScript API (`api/src/modules/rides`, `api/src/modules/pricing`), Next.js user app, Vitest for unit tests.

Full design context: `docs/superpowers/specs/2026-09-08-auto-rickshaw-category-design.md`.

---

### Task 1: Migration — auto_rickshaw vehicle category + pricing seed

**Files:**
- Create: `api/src/db/migrations/097_auto_rickshaw_category.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Auto rickshaw: new vehicle category, in-city rental-only (no one_way/
-- round_trip rate card — booking those ride types for this category will
-- 422, which is intentional). Fully isolated in the fallback ladder, same
-- as van/luxury (087_remove_luxury_suv_fallback.sql) — no
-- category_fallback_rules rows either direction.
-- See docs/superpowers/specs/2026-09-08-auto-rickshaw-category-design.md

INSERT INTO vehicle_categories (slug, display_name, max_passengers)
VALUES ('auto_rickshaw', 'Auto Rickshaw', 3)
ON CONFLICT (slug) DO NOTHING;

-- rate_cards: rental only. rate_per_km/rate_per_min/min_fare are still
-- required by pricing.service.ts's 422 guard even though the rental
-- branch of calculateFare prices off rental_packages.package_fare, not
-- these columns.
INSERT INTO rate_cards (category_id, ride_type, rate_per_km, rate_per_min, min_fare)
SELECT id, 'rental', 6.00, 0.70, 50.00
FROM vehicle_categories WHERE slug = 'auto_rickshaw'
ON CONFLICT DO NOTHING;

-- stop_charges: one row required per category (006_m4_pricing.sql).
INSERT INTO stop_charges (category_id, charge_per_stop)
SELECT id, 15.00 FROM vehicle_categories WHERE slug = 'auto_rickshaw'
ON CONFLICT (category_id) DO NOTHING;

-- rental_packages: starter tiers. Real pricing is an admin action via the
-- Rental Packages tab (apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx),
-- not a code change.
INSERT INTO rental_packages
  (category_id, duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order)
SELECT vc.id, rp.duration_minutes, rp.km_limit, rp.package_fare, rp.extra_per_km, rp.extra_per_min, rp.display_order
FROM vehicle_categories vc
CROSS JOIN (VALUES
  (15::smallint, 3,  40.00::numeric, 8.00::numeric, 1.00::numeric, 10::smallint),
  (30,           5,  70.00,          8.00,          1.00,          20),
  (60,          10, 130.00,          8.00,          1.00,          30)
) AS rp(duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order)
WHERE vc.slug = 'auto_rickshaw'
ON CONFLICT (category_id, duration_minutes, km_limit, COALESCE(city_id, 0)) DO NOTHING;

-- Vehicle brands/models for the driver onboarding dropdown.
INSERT INTO vehicle_brands (name) VALUES
  ('Bajaj'), ('Piaggio'), ('TVS'), ('Mahindra')
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  b_bajaj    BIGINT;
  b_piaggio  BIGINT;
  b_tvs      BIGINT;
  b_mahindra BIGINT;
  c_auto     BIGINT;
BEGIN
  SELECT id INTO b_bajaj    FROM vehicle_brands WHERE name = 'Bajaj';
  SELECT id INTO b_piaggio  FROM vehicle_brands WHERE name = 'Piaggio';
  SELECT id INTO b_tvs      FROM vehicle_brands WHERE name = 'TVS';
  SELECT id INTO b_mahindra FROM vehicle_brands WHERE name = 'Mahindra';
  SELECT id INTO c_auto     FROM vehicle_categories WHERE slug = 'auto_rickshaw';

  INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
    (b_bajaj,    'RE Compact',  c_auto),
    (b_bajaj,    'Maxima Z',    c_auto),
    (b_piaggio,  'Ape City',    c_auto),
    (b_tvs,      'King Deluxe', c_auto),
    (b_mahindra, 'Treo',        c_auto)
  ON CONFLICT (brand_id, name) DO NOTHING;
END $$;
```

- [ ] **Step 2: Run the migration and verify**

Run: `cd api && pnpm migrate`
Expected: migration `097_auto_rickshaw_category` reported as applied, no errors.

Verify:
```bash
docker exec ocar_postgres psql -U postgres -d ocar -c "
  SELECT slug, max_passengers FROM vehicle_categories WHERE slug = 'auto_rickshaw';
  SELECT ride_type, rate_per_km, min_fare FROM rate_cards rc
    JOIN vehicle_categories vc ON vc.id = rc.category_id WHERE vc.slug = 'auto_rickshaw';
  SELECT duration_minutes, km_limit, package_fare FROM rental_packages rp
    JOIN vehicle_categories vc ON vc.id = rp.category_id WHERE vc.slug = 'auto_rickshaw'
    ORDER BY display_order;
"
```
Expected: one category row, one rate_cards row (`rental`), three rental_packages rows (15/30/60 min tiers).

- [ ] **Step 3: Commit**

```bash
git add api/src/db/migrations/097_auto_rickshaw_category.sql
git commit -m "feat(api): add auto_rickshaw vehicle category with rental package pricing"
```

---

### Task 2: Migration — freeze rental overage rate onto fare_snapshots

**Files:**
- Create: `api/src/db/migrations/098_rental_overage_snapshot_fields.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Freeze rental package overage rate onto fare_snapshots
-- ------------------------------------------------------------
-- rental_packages is NOT versioned (084_city_wise_rental_packages.sql —
-- admin CRUD does direct UPDATE/DELETE/INSERT), unlike rate_cards. So
-- unlike round_trip's verifyEndOTP reconciliation (which safely re-joins
-- rate_cards by its immutable rate_card_id, because rate_cards rows are
-- never updated in place), a rental ride's end-of-trip overage
-- recalculation can't safely re-join rental_packages by
-- rental_package_id — an admin editing the package mid-ride would
-- silently apply the NEW rate instead of what the rider was quoted.
-- Freeze the exact rate the rider was quoted at booking time instead.
-- ============================================================

ALTER TABLE fare_snapshots
  ADD COLUMN rental_extra_per_km     NUMERIC(8,2) NULL,
  ADD COLUMN rental_extra_per_min    NUMERIC(8,2) NULL,
  ADD COLUMN rental_km_limit         NUMERIC(8,2) NULL,
  ADD COLUMN rental_duration_minutes INTEGER NULL;

COMMENT ON COLUMN fare_snapshots.rental_extra_per_km IS
  'Rental only: extra_per_km frozen from rental_packages at booking time. NULL for non-rental ride types, and for rental rows booked before this column existed.';
COMMENT ON COLUMN fare_snapshots.rental_extra_per_min IS
  'Rental only: extra_per_min frozen from rental_packages at booking time.';
COMMENT ON COLUMN fare_snapshots.rental_km_limit IS
  'Rental only: km_limit frozen from rental_packages at booking time — the package allowance overage is measured against this at trip end.';
COMMENT ON COLUMN fare_snapshots.rental_duration_minutes IS
  'Rental only: duration_minutes frozen from rental_packages at booking time — the package allowance overage is measured against this at trip end.';
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: migration `098_rental_overage_snapshot_fields` applied, no errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/db/migrations/098_rental_overage_snapshot_fields.sql
git commit -m "feat(api): freeze rental package overage rate onto fare_snapshots"
```

---

### Task 3: Expose frozen rental fields on the fare-estimate response

**Files:**
- Modify: `api/src/modules/pricing/pricing.types.ts:79-95`
- Modify: `api/src/modules/pricing/pricing.service.ts:38-47,78-86`

- [ ] **Step 1: Extend `FareEstimateResponse`**

In `api/src/modules/pricing/pricing.types.ts`, replace:

```typescript
export interface FareEstimateResponse {
  rate_card_id: number
  surge_event_id: number | null
  surge_multiplier: number
  breakdown: {
    base_fare: number
    distance_fare: number
    time_fare: number
    stop_fare: number
    hour_surcharge: number
    overage_fare: number
    overage_km?: number
    surge_fare: number
    total: number
  }
  rental_hours?: number
}
```

with:

```typescript
export interface FareEstimateResponse {
  rate_card_id: number
  surge_event_id: number | null
  surge_multiplier: number
  breakdown: {
    base_fare: number
    distance_fare: number
    time_fare: number
    stop_fare: number
    hour_surcharge: number
    overage_fare: number
    overage_km?: number
    surge_fare: number
    total: number
  }
  rental_hours?: number
  /** Rental only: the package's overage rates/allowance, for freezing onto fare_snapshots at booking time. */
  rental_extra_per_km?: number
  rental_extra_per_min?: number
  rental_km_limit?: number
  rental_duration_minutes?: number
}
```

- [ ] **Step 2: Populate the new fields in `getFareEstimate`**

In `api/src/modules/pricing/pricing.service.ts`, replace:

```typescript
  let packageFare: number | null = null
  let extraPerKm = 0
  let extraPerMin = 0
  let rentalHours: number | undefined
  if (pkg) {
    packageFare  = parseFloat(pkg.package_fare)
    extraPerKm   = parseFloat(pkg.extra_per_km)
    extraPerMin  = parseFloat(pkg.extra_per_min)
    rentalHours  = Math.round(pkg.duration_minutes / 60)
  }
```

with:

```typescript
  let packageFare: number | null = null
  let extraPerKm = 0
  let extraPerMin = 0
  let rentalHours: number | undefined
  let rentalKmLimit: number | undefined
  let rentalDurationMinutes: number | undefined
  if (pkg) {
    packageFare  = parseFloat(pkg.package_fare)
    extraPerKm   = parseFloat(pkg.extra_per_km)
    extraPerMin  = parseFloat(pkg.extra_per_min)
    rentalHours  = Math.round(pkg.duration_minutes / 60)
    rentalKmLimit = pkg.km_limit
    rentalDurationMinutes = pkg.duration_minutes
  }
```

Then replace:

```typescript
  if (rentalHours !== undefined) response.rental_hours = rentalHours
  return response
```

with:

```typescript
  if (rentalHours !== undefined) response.rental_hours = rentalHours
  if (rentalKmLimit !== undefined) response.rental_km_limit = rentalKmLimit
  if (rentalDurationMinutes !== undefined) response.rental_duration_minutes = rentalDurationMinutes
  if (pkg) {
    response.rental_extra_per_km = extraPerKm
    response.rental_extra_per_min = extraPerMin
  }
  return response
```

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/pricing/pricing.types.ts api/src/modules/pricing/pricing.service.ts
git commit -m "feat(api): expose frozen rental overage fields on fare estimate response"
```

---

### Task 4: Persist frozen rental fields when booking a rental ride

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts:569-599`

- [ ] **Step 1: Extend the `fare_snapshots` INSERT**

Replace:

```typescript
  await pool.query(
    `INSERT INTO fare_snapshots (
       ride_id, rate_card_id, rental_package_id,
       ride_type, is_return_cab,
       surge_event_id, surge_multiplier,
       estimated_km, estimated_min, stop_count, trip_hours,
       base_fare, distance_fare, time_fare,
       stop_fare, hour_surcharge, surge_fare,
       total_estimated, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'estimate')`,
    [
      ride.id,
      fareEstimate.rate_card_id,
      data.rentalPackageId ?? null,
      data.rideType,
      data.isReturnCab ?? false,
      fareEstimate.surge_event_id,
      fareEstimate.surge_multiplier,
      data.distanceKm,
      data.durationMin,
      fareStopCount,
      effectiveTripHours,
      fareEstimate.breakdown.base_fare,
      fareEstimate.breakdown.distance_fare,
      fareEstimate.breakdown.time_fare,
      fareEstimate.breakdown.stop_fare,
      fareEstimate.breakdown.hour_surcharge,
      fareEstimate.breakdown.surge_fare,
      fareEstimate.breakdown.total,
    ]
  )
```

with:

```typescript
  await pool.query(
    `INSERT INTO fare_snapshots (
       ride_id, rate_card_id, rental_package_id,
       ride_type, is_return_cab,
       surge_event_id, surge_multiplier,
       estimated_km, estimated_min, stop_count, trip_hours,
       base_fare, distance_fare, time_fare,
       stop_fare, hour_surcharge, surge_fare,
       total_estimated,
       rental_extra_per_km, rental_extra_per_min,
       rental_km_limit, rental_duration_minutes,
       status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'estimate')`,
    [
      ride.id,
      fareEstimate.rate_card_id,
      data.rentalPackageId ?? null,
      data.rideType,
      data.isReturnCab ?? false,
      fareEstimate.surge_event_id,
      fareEstimate.surge_multiplier,
      data.distanceKm,
      data.durationMin,
      fareStopCount,
      effectiveTripHours,
      fareEstimate.breakdown.base_fare,
      fareEstimate.breakdown.distance_fare,
      fareEstimate.breakdown.time_fare,
      fareEstimate.breakdown.stop_fare,
      fareEstimate.breakdown.hour_surcharge,
      fareEstimate.breakdown.surge_fare,
      fareEstimate.breakdown.total,
      fareEstimate.rental_extra_per_km ?? null,
      fareEstimate.rental_extra_per_min ?? null,
      fareEstimate.rental_km_limit ?? null,
      fareEstimate.rental_duration_minutes ?? null,
    ]
  )
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check against local DB**

Book a rental ride via the user app (or `rideApi.createBooking` directly) against any existing category (e.g. sedan) with a selected rental package, then:

```bash
docker exec ocar_postgres psql -U postgres -d ocar -c "
  SELECT ride_type, base_fare, rental_extra_per_km, rental_extra_per_min,
         rental_km_limit, rental_duration_minutes
  FROM fare_snapshots ORDER BY id DESC LIMIT 1;
"
```
Expected: the four new columns are populated (not NULL) for the rental row.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/rides/rides.service.ts
git commit -m "feat(api): freeze rental package overage rate at booking time"
```

---

### Task 5: `verifyEndOTP` — reconcile rental fares against actual GPS-tracked usage

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts:1892-1900` (widen GPS lookup)
- Modify: `api/src/modules/rides/rides.service.ts:2054` (add rental branch)
- Test: `api/tests/unit/rides/completion-payment-branch.test.ts`

- [ ] **Step 1: Write the failing tests**

In `api/tests/unit/rides/completion-payment-branch.test.ts`, add these two tests immediately before the closing `})` of the `describe('verifyEndOTP — payment channel branch', ...)` block (i.e. right after the existing `'round_trip early termination...'` test, before line 356's `})`):

```typescript
  it('rental normal completion: reconciles against GPS-tracked distance and bills package overage, not the stale estimate', async () => {
    const startedAt = new Date(Date.now() - 40 * 60 * 1000).toISOString()
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: BigInt(101), user_id: 42, driver_id: 9, status: 'in_progress',
      ride_type: 'rental', end_otp_hash: 'h', payment_channel: 'cash',
      origin_lat: 20.3, origin_lng: 85.8, user_phone: null,
      started_at: startedAt,
    } as never)
    vi.mocked(repo.getStopWaitTotal).mockResolvedValueOnce(0)
    // GPS breadcrumbs say 8km were actually driven — different from the
    // 6km the driver app's straight-line client estimate reports below.
    vi.mocked(repo.getGpsTrackedDistanceKm).mockResolvedValueOnce(8)

    let capturedUpdateParams: unknown[] | undefined
    vi.mocked(pool.query).mockImplementation(((sql: string, params?: unknown[]) => {
      if (/rental_extra_per_km/.test(sql) && /SELECT/.test(sql)) {
        return Promise.resolve({
          rows: [{
            surge_multiplier: '1', stop_fare: '0', base_fare: '70.00',
            rental_extra_per_km: '8.00', rental_extra_per_min: '1.00',
            rental_km_limit: '5.00', rental_duration_minutes: 30,
          }],
          rowCount: 1,
        })
      }
      if (/UPDATE fare_snapshots/.test(sql) && /total_final\s*=\s*COALESCE/.test(sql)) {
        capturedUpdateParams = params
        return Promise.resolve({ rows: [], rowCount: 1 })
      }
      return Promise.resolve({ rows: [{ amount: '500.00' }], rowCount: 1 })
    }) as never)

    // Package: 5km/30min for ₹70, extra ₹8/km + ₹1/min.
    // GPS says 8km/40min driven → overageKm=3, overageMin=10.
    // overage_fare = 3*8 + 10*1 = 34. total = 70+34 = 104.
    // Client estimate (6km/35min, passed as actualDistanceKm/Min below)
    // would give overageKm=1, overageMin=5, overage_fare=13, total=83 —
    // the test must land on 104, not 83.
    await verifyEndOTP(BigInt(9), BigInt(101), '1234', 6, 35)
    await flush()

    expect(capturedUpdateParams).toBeDefined()
    const [, billedKm, billedMin, totalFinal] = capturedUpdateParams!
    expect(totalFinal).toBe(104)
    expect(billedKm).toBe(8)
    expect(billedMin).toBe(40)
    expect(repo.flagRideForReview).not.toHaveBeenCalled()
  })

  it('rental normal completion: falls back to client-reported distance when GPS data is insufficient, and flags for review', async () => {
    const startedAt = new Date(Date.now() - 40 * 60 * 1000).toISOString()
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: BigInt(101), user_id: 42, driver_id: 9, status: 'in_progress',
      ride_type: 'rental', end_otp_hash: 'h', payment_channel: 'cash',
      origin_lat: 20.3, origin_lng: 85.8, user_phone: null,
      started_at: startedAt,
    } as never)
    vi.mocked(repo.getStopWaitTotal).mockResolvedValueOnce(0)
    vi.mocked(repo.getGpsTrackedDistanceKm).mockResolvedValueOnce(null)

    let capturedUpdateParams: unknown[] | undefined
    vi.mocked(pool.query).mockImplementation(((sql: string, params?: unknown[]) => {
      if (/rental_extra_per_km/.test(sql) && /SELECT/.test(sql)) {
        return Promise.resolve({
          rows: [{
            surge_multiplier: '1', stop_fare: '0', base_fare: '70.00',
            rental_extra_per_km: '8.00', rental_extra_per_min: '1.00',
            rental_km_limit: '5.00', rental_duration_minutes: 30,
          }],
          rowCount: 1,
        })
      }
      if (/UPDATE fare_snapshots/.test(sql) && /total_final\s*=\s*COALESCE/.test(sql)) {
        capturedUpdateParams = params
        return Promise.resolve({ rows: [], rowCount: 1 })
      }
      return Promise.resolve({ rows: [{ amount: '500.00' }], rowCount: 1 })
    }) as never)

    // No GPS data → falls back to the 6km/35min client estimate.
    // overageKm=1, overageMin=5, overage_fare=8+5=13, total=83.
    await verifyEndOTP(BigInt(9), BigInt(101), '1234', 6, 35)
    await flush()

    expect(capturedUpdateParams).toBeDefined()
    const totalFinal = capturedUpdateParams![3] as number
    expect(totalFinal).toBe(83)
    expect(repo.flagRideForReview).toHaveBeenCalledWith(BigInt(101), expect.stringMatching(/GPS/i))
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/unit/rides/completion-payment-branch.test.ts`
Expected: the two new tests FAIL — `totalFinal` will be `undefined` (rental never sets `total_final`, current code leaves it `null` and the response falls back to `total_estimated`), and `repo.flagRideForReview` won't have been called for the second test.

- [ ] **Step 3: Widen the GPS-breadcrumb lookup to cover rental**

In `api/src/modules/rides/rides.service.ts`, replace:

```typescript
  // GPS-breadcrumb-derived distance/duration for round_trip fare reconciliation
  // (see calculateFare call below) — falls back to the client-reported values
  // when there isn't enough GPS data (see getGpsTrackedDistanceKm).
  const gpsDistanceKm = ride.ride_type === 'round_trip' && ride.started_at != null
    ? await repo.getGpsTrackedDistanceKm(rideId, new Date(ride.started_at))
    : null
```

with:

```typescript
  // GPS-breadcrumb-derived distance/duration for round_trip and rental fare
  // reconciliation (see calculateFare calls below) — falls back to the
  // client-reported values when there isn't enough GPS data (see
  // getGpsTrackedDistanceKm).
  const needsGpsReconciliation = ride.ride_type === 'round_trip' || ride.ride_type === 'rental'
  const gpsDistanceKm = needsGpsReconciliation && ride.started_at != null
    ? await repo.getGpsTrackedDistanceKm(rideId, new Date(ride.started_at))
    : null
```

- [ ] **Step 4: Add the rental reconciliation branch**

Still in `rides.service.ts`, find the closing brace of the `if (ride.ride_type === 'round_trip') { ... }` block — the standalone `}` immediately followed by the `await pool.query(\`UPDATE fare_snapshots ...\`)` call (the one with `total_final = COALESCE($4::numeric, total_estimated)`). Replace that single closing brace line:

```typescript
    }

    await pool.query(
      `UPDATE fare_snapshots
       SET actual_km               = $2,
```

with:

```typescript
    } else if (ride.ride_type === 'rental') {
      // Rental: reconcile against actual km/duration vs. the package
      // allowance frozen on the fare_snapshot at booking time (Task 4) —
      // rental_packages itself isn't versioned, so we can't safely
      // re-join it here the way round_trip re-joins the versioned
      // rate_cards.
      const snapRes = await pool.query<{
        surge_multiplier: string
        stop_fare: string
        base_fare: string
        rental_extra_per_km: string | null
        rental_extra_per_min: string | null
        rental_km_limit: string | null
        rental_duration_minutes: number | null
      }>(
        `SELECT fs.surge_multiplier, fs.stop_fare, fs.base_fare,
                fs.rental_extra_per_km, fs.rental_extra_per_min,
                fs.rental_km_limit, fs.rental_duration_minutes
         FROM fare_snapshots fs
         WHERE fs.ride_id = $1`,
        [rideId]
      )
      const snap = snapRes.rows[0]

      if (
        snap &&
        snap.rental_extra_per_km != null && snap.rental_extra_per_min != null &&
        snap.rental_km_limit != null && snap.rental_duration_minutes != null
      ) {
        billedKm  = gpsDistanceKm  ?? actualDistanceKm
        billedMin = gpsDurationMin ?? actualDurationMin

        const overageKm  = Math.max(0, billedKm  - parseFloat(snap.rental_km_limit))
        const overageMin = Math.max(0, billedMin - snap.rental_duration_minutes)

        const recalc = calculateFare({
          rate_card: { rate_per_km: 0, rate_per_min: 0, min_fare: 0 },
          ride_type:        'rental',
          is_return_cab:    false,
          estimated_km:     billedKm,
          estimated_min:    billedMin,
          stop_count:       0,
          charge_per_stop:  0,
          trip_hours:       0,
          surge_multiplier: parseFloat(snap.surge_multiplier),
          overage_km:       overageKm,
          overage_min:      overageMin,
          extra_per_km:     parseFloat(snap.rental_extra_per_km),
          extra_per_min:    parseFloat(snap.rental_extra_per_min),
          package_fare:     parseFloat(snap.base_fare),
        })

        const stopFare = parseFloat(snap.stop_fare ?? '0')
        totalFinal = Math.round((recalc.total + stopFare) * 100) / 100

        if (gpsDistanceKm == null) {
          await repo.flagRideForReview(
            rideId,
            'Rental fare reconciled against client-reported distance — GPS breadcrumb data unavailable'
          )
        }
      }
    }

    await pool.query(
      `UPDATE fare_snapshots
       SET actual_km               = $2,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/unit/rides/completion-payment-branch.test.ts`
Expected: all tests in the file PASS, including the two new ones.

- [ ] **Step 6: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/completion-payment-branch.test.ts
git commit -m "fix(api): reconcile rental fares against actual GPS-tracked km/duration at trip end"
```

---

### Task 6: Fix select-ride page rendering categories with no rate card for the current ride type

Auto rickshaw only has a `rental` rate card. `select-ride/page.tsx` (used for `one_way`/`round_trip`) fetches the live category list generically and renders every category unconditionally — once auto_rickshaw exists, it will 422 on estimate fetch there but still render as a selectable, price-less card. This is a latent bug the existing 5 categories never triggered (they all have all three ride types configured); auto_rickshaw is the first category to expose it.

**Files:**
- Modify: `apps/user/app/(main)/select-ride/page.tsx:701`

- [ ] **Step 1: Filter out categories with no successful estimate**

Replace:

```tsx
          {/* ── Standard category list ── */}
          {categories.map((cat, i) => {
```

with:

```tsx
          {/* ── Standard category list ── */}
          {/* Hide any category whose estimate fetch failed (e.g. no rate
              card for this ride_type — auto_rickshaw only has `rental`)
              once loading has settled; keep showing all cards during the
              initial load so the skeleton state still renders. */}
          {categories
            .filter(cat => loading || estimates[cat.id] !== undefined)
            .map((cat, i) => {
```

Note the closing of this `.map(...)` callback later in the file stays a normal arrow-function close; since only the opening was changed to a chained `.filter().map()`, no other lines need touching.

- [ ] **Step 2: Manual verification**

Run the user app dev server (`cd apps/user && pnpm dev`), open `/select-ride` for a one-way trip. Confirm: Hatchback/Sedan/SUV/Luxury still render with fares as before. Auto Rickshaw does not appear (once Task 1's migration has run locally).

- [ ] **Step 3: Commit**

```bash
git add "apps/user/app/(main)/select-ride/page.tsx"
git commit -m "fix(user): hide vehicle categories with no rate card for the selected ride type"
```

---

### Task 7: Vehicle icon for auto rickshaw

**Files:**
- Modify: `apps/user/components/ui/VehicleIcon.tsx`

- [ ] **Step 1: Add the `AutoRickshaw` body**

Add this function after `Van` (after line 141) in `apps/user/components/ui/VehicleIcon.tsx`:

```tsx
function AutoRickshaw({ color, wheel }: { color: string; wheel: string }) {
  return (
    <>
      {/* Rounded canopy cab: short snub nose, domed roof, open-sided body */}
      <path
        d="M10 33 L10 22 Q10 15 17 13 L20 12 Q22 9 27 9 L52 9 Q58 9 60 14 L63 22 L66 22 Q69 22 69 25 L69 33 Q69 35 66 35 L13 35 Q10 35 10 33 Z"
        fill={color}
      />
      {/* Domed windshield + open side glass */}
      <path d="M23 21 L26 13 Q27 12 29 12 L50 12 Q54 12 56 15 L59 21 Z" fill={WINDOW_FILL} />
      {/* Canopy support seam */}
      <line x1="40" y1="12" x2="40" y2="21" stroke={WINDOW_FILL} strokeWidth="1" />
      {/* Single small front wheel, two larger rear wheels (3-wheeler stance) */}
      <circle cx="18" cy="37" r="5.5" fill={wheel} />
      <circle cx="52" cy="37" r="7" fill={wheel} />
      <circle cx="18" cy="37" r="2.5" fill={WINDOW_FILL} />
      <circle cx="52" cy="37" r="3" fill={WINDOW_FILL} />
    </>
  )
}
```

Then replace:

```tsx
const BODIES: Record<string, (p: { color: string; wheel: string }) => React.JSX.Element> = {
  hatchback: Hatchback,
  sedan: Sedan,
  suv: Suv,
  luxury: Luxury,
  van: Van,
}
```

with:

```tsx
const BODIES: Record<string, (p: { color: string; wheel: string }) => React.JSX.Element> = {
  hatchback: Hatchback,
  sedan: Sedan,
  suv: Suv,
  luxury: Luxury,
  van: Van,
  auto_rickshaw: AutoRickshaw,
}
```

- [ ] **Step 2: Visual check**

Run the user app dev server and view `/rental` once Task 1's migration + Task 8's fallback-category entry are in place — confirm the Auto Rickshaw card shows the new silhouette, not the Sedan fallback.

- [ ] **Step 3: Commit**

```bash
git add apps/user/components/ui/VehicleIcon.tsx
git commit -m "feat(user): add auto rickshaw vehicle icon"
```

---

### Task 8: Register auto_rickshaw in admin + rental page category-order lists

**Files:**
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/page.tsx:562`
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/shared.tsx:1`
- Modify: `apps/user/app/(main)/rental/page.tsx:27-33`

- [ ] **Step 1: Admin rate-cards page**

In `apps/admin/app/(dashboard)/config/rate-cards/page.tsx`, replace:

```typescript
  const CATEGORY_ORDER_ITEMS = ['hatchback', 'sedan', 'suv', 'luxury', 'van']
```

with:

```typescript
  const CATEGORY_ORDER_ITEMS = ['hatchback', 'sedan', 'suv', 'luxury', 'van', 'auto_rickshaw']
```

- [ ] **Step 2: Admin shared category order (used by Rental Packages tab)**

In `apps/admin/app/(dashboard)/config/rate-cards/shared.tsx`, replace:

```typescript
export const CATEGORY_ORDER = ['hatchback', 'sedan', 'suv', 'luxury', 'van']
```

with:

```typescript
export const CATEGORY_ORDER = ['hatchback', 'sedan', 'suv', 'luxury', 'van', 'auto_rickshaw']
```

- [ ] **Step 3: User rental page fallback categories**

In `apps/user/app/(main)/rental/page.tsx`, replace:

```typescript
const FALLBACK_CATEGORIES: Category[] = [
  { id: 1, slug: 'hatchback', display_name: 'Hatchback', max_passengers: 4 },
  { id: 2, slug: 'sedan',     display_name: 'Sedan',     max_passengers: 4 },
  { id: 3, slug: 'suv',       display_name: 'SUV',       max_passengers: 6 },
  { id: 4, slug: 'luxury',    display_name: 'Luxury',    max_passengers: 4 },
  { id: 5, slug: 'van',       display_name: 'Van',        max_passengers: 8 },
]
```

with:

```typescript
const FALLBACK_CATEGORIES: Category[] = [
  { id: 1, slug: 'hatchback',    display_name: 'Hatchback',    max_passengers: 4 },
  { id: 2, slug: 'sedan',        display_name: 'Sedan',        max_passengers: 4 },
  { id: 3, slug: 'suv',          display_name: 'SUV',          max_passengers: 6 },
  { id: 4, slug: 'luxury',       display_name: 'Luxury',       max_passengers: 4 },
  { id: 5, slug: 'van',          display_name: 'Van',          max_passengers: 8 },
  { id: 6, slug: 'auto_rickshaw', display_name: 'Auto Rickshaw', max_passengers: 3 },
]
```

Note: `select-ride/page.tsx`'s own `FALLBACK_CATEGORIES` (used for `one_way`/`round_trip`) is deliberately **not** touched — auto_rickshaw is rental-only and must not appear there (Task 6 handles the live-data case; this fallback list only matters if the categories API call fails, and should stay consistent with what that page is allowed to show).

- [ ] **Step 4: Typecheck both apps**

Run: `cd apps/admin && npx tsc --noEmit` — expect no errors.
Run: `cd apps/user && npx tsc --noEmit` — expect no errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/admin/app/(dashboard)/config/rate-cards/page.tsx" \
        "apps/admin/app/(dashboard)/config/rate-cards/shared.tsx" \
        "apps/user/app/(main)/rental/page.tsx"
git commit -m "feat: register auto_rickshaw in admin and user rental category-order lists"
```

---

### Task 9: End-to-end verification

No new algorithmic logic beyond what Task 5 already unit-tests — this task exercises the full booking→completion flow manually, per the design doc's verification plan.

- [ ] **Step 1: Confirm seed data**

```bash
docker exec ocar_postgres psql -U postgres -d ocar -c "
  SELECT vc.slug, rc.ride_type, rp.duration_minutes, rp.km_limit, rp.package_fare
  FROM vehicle_categories vc
  LEFT JOIN rate_cards rc ON rc.category_id = vc.id AND rc.effective_to IS NULL
  LEFT JOIN rental_packages rp ON rp.category_id = vc.id
  WHERE vc.slug = 'auto_rickshaw'
  ORDER BY rp.display_order;
"
```
Expected: one `rental` rate_cards row, three rental_packages rows.

- [ ] **Step 2: Driver onboarding**

Run `cd apps/driver && pnpm dev`, onboard a test driver, confirm "Auto Rickshaw" appears in the vehicle category dropdown and can be selected with a Bajaj/TVS/Piaggio/Mahindra brand+model.

- [ ] **Step 3: User booking flow**

Run `cd apps/user && pnpm dev`, pick an in-city origin/destination (or go directly to `/rental`), confirm Auto Rickshaw appears with its own icon and the three package tiers, and that `/select-ride` (one-way/round-trip) does NOT show it.

- [ ] **Step 4: Full ride lifecycle**

With the driver app online as an auto_rickshaw driver and the user app booking an auto_rickshaw rental ride: request → accept → start (OTP) → drive → end (OTP). Confirm the ride completes and a fare is shown.

- [ ] **Step 5: Confirm GPS reconciliation ran**

```bash
docker exec ocar_postgres psql -U postgres -d ocar -c "
  SELECT ride_id, ride_type, actual_km, actual_min, total_estimated, total_final, status
  FROM fare_snapshots WHERE ride_type = 'rental' ORDER BY id DESC LIMIT 1;
"
```
Expected: `status = 'final'`, `total_final` populated (not NULL), `actual_km`/`actual_min` reflecting GPS-breadcrumb data rather than a suspiciously round straight-line-times-1.3 number.

- [ ] **Step 6: Regression-check an existing rental category**

Repeat steps 3-5 booking a `sedan` rental ride (pre-existing category) — confirms Task 5's change didn't regress rental billing for categories that existed before this feature.
