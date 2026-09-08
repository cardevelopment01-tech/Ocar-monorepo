# Auto Rickshaw Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "auto rickshaw" as a bookable in-city vehicle category priced through the existing `rental` ride-type package model (fixed package fare + km/min overage).

**Architecture:** Auto rickshaw is a new `vehicle_categories` row wired through the existing rental pricing pipeline (`rate_cards` + `rental_packages`, no new `ride_type`, no `fare.ts` change). Frontend changes are small: a new vehicle icon, two hardcoded category-order lists, and a real bug fix on the one-way/round-trip page that this feature would otherwise expose (it currently renders every vehicle category unconditionally, even ones with no rate card for the selected ride type).

**Tech Stack:** PostgreSQL migrations, Express/TypeScript API (`api/src/modules/pricing`), Next.js user app.

Full design context: `docs/superpowers/specs/2026-09-08-auto-rickshaw-category-design.md`.

**Out of scope for now:** the rental fare GPS-reconciliation fix (extending `verifyEndOTP`'s round_trip-only GPS-breadcrumb reconciliation to also cover `rental`) is **deferred pending client confirmation** — see the design doc's "Deferred" section. Rental fares (including auto_rickshaw) continue to settle at `total_estimated`, same as every other existing rental category today. Nothing in this plan changes that behavior.

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
-- Full catalog as supplied by the client for the Odisha market (5 manufacturers,
-- 24 models). Model names encode their own fuel variant where relevant (e.g. "RE
-- CNG", "Ape E City", "Alfa DX Duo CNG") — vehicle_models has no fuel_type column
-- of its own; the driver separately selects fuel type at registration time via
-- driver_vehicles.fuel_type (004_m2_vehicles.sql, already generic across every
-- category, no schema change needed here).
INSERT INTO vehicle_brands (name) VALUES
  ('Bajaj'), ('Piaggio'), ('Atul'), ('TVS'), ('Mahindra')
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  b_bajaj    BIGINT;
  b_piaggio  BIGINT;
  b_atul     BIGINT;
  b_tvs      BIGINT;
  b_mahindra BIGINT;
  c_auto     BIGINT;
BEGIN
  SELECT id INTO b_bajaj    FROM vehicle_brands WHERE name = 'Bajaj';
  SELECT id INTO b_piaggio  FROM vehicle_brands WHERE name = 'Piaggio';
  SELECT id INTO b_atul     FROM vehicle_brands WHERE name = 'Atul';
  SELECT id INTO b_tvs      FROM vehicle_brands WHERE name = 'TVS';
  SELECT id INTO b_mahindra FROM vehicle_brands WHERE name = 'Mahindra';
  SELECT id INTO c_auto     FROM vehicle_categories WHERE slug = 'auto_rickshaw';

  INSERT INTO vehicle_models (brand_id, name, typical_category_id) VALUES
    (b_bajaj,    'RE',                  c_auto),
    (b_bajaj,    'RE CNG',              c_auto),
    (b_bajaj,    'Compact RE',          c_auto),
    (b_bajaj,    'Gogo',                c_auto),
    (b_bajaj,    'Maxima X Wide',       c_auto),
    (b_bajaj,    'Maxima Z',            c_auto),
    (b_piaggio,  'Classic Diesel',      c_auto),
    (b_piaggio,  'Ape City Plus',       c_auto),
    (b_piaggio,  'Ape E City',          c_auto),
    (b_piaggio,  'Ape E City FX Max',   c_auto),
    (b_piaggio,  'Ape Auto Dx',         c_auto),
    (b_atul,     'Gem Paxx CNG',        c_auto),
    (b_atul,     'Elite Plus Electric', c_auto),
    (b_atul,     'Rik',                 c_auto),
    (b_atul,     'Elite Paxx Electric', c_auto),
    (b_tvs,      'King Deluxe',         c_auto),
    (b_tvs,      'King EV Max',         c_auto),
    (b_tvs,      'King Duramax',        c_auto),
    (b_tvs,      'King Duramax Plus',   c_auto),
    (b_mahindra, 'Treo Plus',           c_auto),
    (b_mahindra, 'Alfa DX Duo CNG',     c_auto),
    (b_mahindra, 'Alfa DX',             c_auto),
    (b_mahindra, 'Udo Electric',        c_auto),
    (b_mahindra, 'E Alfa Plus',         c_auto)
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

### Task 2: Fix select-ride page rendering categories with no rate card for the current ride type

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

### Task 3: Vehicle icon for auto rickshaw

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

Run the user app dev server and view `/rental` once Task 1's migration + Task 4's fallback-category entry are in place — confirm the Auto Rickshaw card shows the new silhouette, not the Sedan fallback.

- [ ] **Step 3: Commit**

```bash
git add apps/user/components/ui/VehicleIcon.tsx
git commit -m "feat(user): add auto rickshaw vehicle icon"
```

---

### Task 4: Register auto_rickshaw in admin + rental page category-order lists

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

Note: `select-ride/page.tsx`'s own `FALLBACK_CATEGORIES` (used for `one_way`/`round_trip`) is deliberately **not** touched — auto_rickshaw is rental-only and must not appear there (Task 2 handles the live-data case; this fallback list only matters if the categories API call fails, and should stay consistent with what that page is allowed to show).

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

### Task 5: End-to-end verification

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

Run `cd apps/driver && pnpm dev`, onboard a test driver, confirm "Auto Rickshaw" appears in the vehicle category dropdown and can be selected with a brand+model from any of the five seeded manufacturers (Bajaj, Piaggio, Atul, TVS, Mahindra), and that fuel type selection (petrol/diesel/CNG/electric) works normally alongside it.

- [ ] **Step 3: User booking flow**

Run `cd apps/user && pnpm dev`, pick an in-city origin/destination (or go directly to `/rental`), confirm Auto Rickshaw appears with its own icon and the three package tiers, and that `/select-ride` (one-way/round-trip) does NOT show it.

- [ ] **Step 4: Full ride lifecycle**

With the driver app online as an auto_rickshaw driver and the user app booking an auto_rickshaw rental ride: request → accept → start (OTP) → drive → end (OTP). Confirm the ride completes and a fare is shown (settling at the booking-time estimate, same as every other rental category today — no GPS reconciliation for rental yet, see "Out of scope" above).

- [ ] **Step 5: Regression-check an existing rental category**

Repeat steps 3-4 booking a `sedan` rental ride (pre-existing category) — confirms nothing in this plan changed existing rental behavior.
