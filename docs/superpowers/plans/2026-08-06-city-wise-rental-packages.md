# City-Wise Rental Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `rental_packages` the same per-city NULL-fallback pricing pattern `rate_cards` already has (migration 078), and extend the admin/user UI so rental package tiers can be overridden per city.

**Architecture:** Add a nullable `city_id` column to `rental_packages` (NULL = global default, non-NULL = city override), enforce uniqueness per `(category, duration, km_limit, COALESCE(city_id,0))`, and change the public listing query to merge global + city rows per `(duration_minutes, km_limit)` tier — city row wins when both exist. `rate_cards`-style versioning does NOT apply here: `rental_packages` is a plain CRUD table (no `effective_to`/history), so city_id is just another column in the existing INSERT/UPDATE/DELETE paths. Booking-time fare lookup (`getRentalPackage(packageId)`) is unaffected — it resolves by primary key, and the ID the client sends already encodes which city's tier they picked.

**Tech Stack:** Express + TypeScript + Zod-less manual body parsing (matches existing admin.controller.ts style), raw `pg` queries, Next.js 16 admin app (Radix Dialog), Next.js 16 user app.

**Context note — surge_events:** `surge_events.city_id` is already `NOT NULL` (mandatory per-event city, no global fallback needed since surge is an ad-hoc override, not a base rate). **No changes needed for surge events** — this plan only touches `rental_packages`.

---

## Task 1: Migration — add `city_id` to `rental_packages`

**Files:**
- Create: `api/src/db/migrations/084_city_wise_rental_packages.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- City-wise rental package pricing
-- ------------------------------------------------------------
-- rental_packages is currently global: one row per (category,
-- duration_minutes, km_limit) for the whole platform. Client
-- wants per-city control from the admin panel, same as
-- rate_cards (078_city_wise_rate_cards.sql).
--
-- Reuses the exact NULL-fallback convention: city_id IS NULL
-- means "global default, applies to any city without its own
-- override for this tier." No backfill needed — every existing
-- row becomes the global default automatically.
--
-- Unlike rate_cards, rental_packages is NOT versioned (no
-- effective_to/history table) — admin CRUD does direct
-- UPDATE/DELETE/INSERT, so city_id is just another column.
-- ============================================================

ALTER TABLE rental_packages
  ADD COLUMN city_id BIGINT NULL REFERENCES cities(id);

COMMENT ON COLUMN rental_packages.city_id IS
  'NULL = global default package tier, used by any city without its own override for this (category, duration, km) tier. Non-NULL = city-specific override, wins over the global row for the same tier.';

-- 030_rental_package_flexibility.sql named this constraint explicitly,
-- so drop by literal name (no DO-block needed, unlike its own drop of
-- the anonymous CHECK it replaced).
ALTER TABLE rental_packages
  DROP CONSTRAINT rental_packages_category_duration_km_key;

-- COALESCE(city_id, 0) so the NULL (global) bucket is uniqueness-enforced
-- too, mirroring rate_cards_current_idx from 078. Must be a plain unique
-- INDEX (not a table CONSTRAINT) because constraints can't use expressions.
CREATE UNIQUE INDEX rental_packages_category_duration_km_idx
  ON rental_packages (category_id, duration_minutes, km_limit, COALESCE(city_id, 0));

-- "List packages for category X, city Y" — city override if it exists,
-- else global, resolved in application SQL (see Task 3).
CREATE INDEX rental_packages_city_lookup_idx
  ON rental_packages (category_id, city_id)
  WHERE is_active = true;
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: output includes `084_city_wise_rental_packages.sql` applied, no errors.

- [ ] **Step 3: Verify the schema change**

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "\d rental_packages"`
Expected: `city_id` column present, `rental_packages_category_duration_km_idx` and `rental_packages_city_lookup_idx` listed under Indexes, old `rental_packages_category_duration_km_key` gone.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/084_city_wise_rental_packages.sql
git commit -m "feat(pricing): add city_id to rental_packages for per-city overrides"
```

---

## Task 2: Backend types

**Files:**
- Modify: `api/src/modules/pricing/pricing.types.ts`
- Modify: `api/src/modules/admin/admin.types.ts`

- [ ] **Step 1: Add `city_id`/`city_name` to the public `RentalPackage` type**

In `api/src/modules/pricing/pricing.types.ts`, update the `RentalPackage` interface:

```typescript
export interface RentalPackage {
  id: number
  category_id: number
  category_name: string
  duration_minutes: number
  km_limit: number
  package_fare: number
  extra_per_km: number
  extra_per_min: number
  is_active: boolean
  city_id: number | null
  city_name: string | null
}
```

- [ ] **Step 2: Add `city_id`/`city_name` to `AdminRentalPackage`**

In `api/src/modules/admin/admin.types.ts`, update the `AdminRentalPackage` interface (around line 294):

```typescript
export interface AdminRentalPackage {
  id: number
  category_id: number
  category_name?: string
  category_slug?: string
  duration_minutes: number
  km_limit: number
  display_order: number
  package_fare: string
  extra_per_km: string
  extra_per_min: string
  is_active: boolean
  city_id: number | null
  city_name?: string | null
  updated_by: number | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/pricing/pricing.types.ts api/src/modules/admin/admin.types.ts
git commit -m "feat(pricing): add city fields to rental package types"
```

---

## Task 3: Public rental-package repository — city-aware fallback query

**Files:**
- Modify: `api/src/modules/pricing/pricing.repository.ts:69-77`

- [ ] **Step 1: Replace `getRentalPackagesByCategory` with a city-aware version**

Current code (lines 69-77):

```typescript
export async function getRentalPackagesByCategory(categoryId: number) {
  const res = await pool.query(
    `SELECT * FROM rental_packages
     WHERE category_id = $1 AND is_active = true
     ORDER BY display_order, duration_minutes`,
    [categoryId]
  )
  return res.rows
}
```

Replace with:

```typescript
export async function getRentalPackagesByCategory(categoryId: number, cityId: number | null) {
  const res = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (rp.duration_minutes, rp.km_limit)
              rp.*, vc.display_name AS category_name, c.name AS city_name
       FROM rental_packages rp
       JOIN vehicle_categories vc ON vc.id = rp.category_id
       LEFT JOIN cities c ON c.id = rp.city_id
       WHERE rp.category_id = $1
         AND rp.is_active = true
         AND (rp.city_id = $2 OR rp.city_id IS NULL)
       ORDER BY rp.duration_minutes, rp.km_limit, rp.city_id NULLS LAST
     ) t
     ORDER BY t.display_order, t.duration_minutes`,
    [categoryId, cityId]
  )
  return res.rows
}
```

This dedupes per `(duration_minutes, km_limit)` tier: `DISTINCT ON` keeps the first row per tier, and `city_id NULLS LAST` (after the `WHERE` already restricted rows to `city_id = $2 OR city_id IS NULL`) makes the city-specific row win over the global one whenever both exist for the same tier. When `$2` is `NULL`, `rp.city_id = NULL` never matches, so only global rows come through — same fallback semantics as `getCurrentRateCard`.

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/pricing/pricing.repository.ts
git commit -m "feat(pricing): city-aware fallback query for rental package listing"
```

---

## Task 4: Public rental-package service, controller — thread `cityId`

**Files:**
- Modify: `api/src/modules/pricing/pricing.service.ts:96-98`
- Modify: `api/src/modules/pricing/pricing.controller.ts:16-21`

- [ ] **Step 1: Update the service function**

In `api/src/modules/pricing/pricing.service.ts`, replace:

```typescript
export async function getRentalPackages(categoryId: number) {
  return repo.getRentalPackagesByCategory(categoryId)
}
```

with:

```typescript
export async function getRentalPackages(categoryId: number, cityId: number | null) {
  return repo.getRentalPackagesByCategory(categoryId, cityId)
}
```

- [ ] **Step 2: Update the controller to parse `city_id` from the query string**

In `api/src/modules/pricing/pricing.controller.ts`, replace:

```typescript
export async function getRentalPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categoryId = parseInt(req.params['categoryId']!, 10)
    res.json(await service.getRentalPackages(categoryId))
  } catch (err) { next(err) }
}
```

with:

```typescript
export async function getRentalPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const categoryId = parseInt(req.params['categoryId']!, 10)
    const cityIdRaw = req.query['city_id']
    const cityId = typeof cityIdRaw === 'string' && cityIdRaw !== '' ? parseInt(cityIdRaw, 10) : null
    res.json(await service.getRentalPackages(categoryId, cityId))
  } catch (err) { next(err) }
}
```

`pricing.routes.ts` needs no change — `city_id` is a query param, not a path segment.

- [ ] **Step 3: Verify with curl (needs API running: `cd api && pnpm dev`)**

Run: `curl "http://localhost:3000/api/v1/pricing/rental-packages/2"`
Expected: JSON array of packages for category 2, each with `"city_id": null, "city_name": null` (no city override created yet).

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/pricing/pricing.service.ts api/src/modules/pricing/pricing.controller.ts
git commit -m "feat(pricing): accept optional city_id on rental-packages listing endpoint"
```

---

## Task 5: Admin repository — city_id in CRUD

**Files:**
- Modify: `api/src/modules/admin/admin.repository.ts:1168-1247`

- [ ] **Step 1: Add city join + column to `listAdminRentalPackages`**

Replace (around line 1170-1181):

```typescript
export async function listAdminRentalPackages() {
  const res = await pool.query(
    `SELECT rp.id, rp.category_id, vc.display_name AS category_name, vc.slug AS category_slug,
            rp.duration_minutes, rp.km_limit, rp.display_order,
            rp.package_fare::text, rp.extra_per_km::text, rp.extra_per_min::text,
            rp.is_active, rp.updated_by, rp.created_at, rp.updated_at
     FROM rental_packages rp
     JOIN vehicle_categories vc ON vc.id = rp.category_id
     ORDER BY vc.display_name, rp.display_order, rp.duration_minutes`
  )
  return res.rows as AdminRentalPackage[]
}
```

with:

```typescript
export async function listAdminRentalPackages() {
  const res = await pool.query(
    `SELECT rp.id, rp.category_id, vc.display_name AS category_name, vc.slug AS category_slug,
            rp.duration_minutes, rp.km_limit, rp.display_order,
            rp.package_fare::text, rp.extra_per_km::text, rp.extra_per_min::text,
            rp.is_active, rp.city_id, c.name AS city_name,
            rp.updated_by, rp.created_at, rp.updated_at
     FROM rental_packages rp
     JOIN vehicle_categories vc ON vc.id = rp.category_id
     LEFT JOIN cities c ON c.id = rp.city_id
     ORDER BY c.name NULLS FIRST, vc.display_name, rp.display_order, rp.duration_minutes`
  )
  return res.rows as AdminRentalPackage[]
}
```

- [ ] **Step 2: Accept `city_id` in `createAdminRentalPackage`**

Replace (around line 1222-1247):

```typescript
export async function createAdminRentalPackage(
  fields: {
    category_id: number
    duration_minutes: number
    km_limit: number
    package_fare: number
    extra_per_km: number
    extra_per_min: number
    display_order?: number
  },
  adminId: bigint,
) {
  const res = await pool.query(
    `INSERT INTO rental_packages
       (category_id, duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 100), $8)
     RETURNING
       id, category_id, duration_minutes, km_limit, display_order,
       package_fare::text, extra_per_km::text, extra_per_min::text,
       is_active, updated_by, created_at, updated_at`,
    [fields.category_id, fields.duration_minutes, fields.km_limit,
     fields.package_fare, fields.extra_per_km, fields.extra_per_min,
     fields.display_order ?? null, adminId],
  )
  return res.rows[0] as AdminRentalPackage
}
```

with:

```typescript
export async function createAdminRentalPackage(
  fields: {
    category_id: number
    duration_minutes: number
    km_limit: number
    package_fare: number
    extra_per_km: number
    extra_per_min: number
    display_order?: number
    city_id?: number | null
  },
  adminId: bigint,
) {
  const res = await pool.query(
    `INSERT INTO rental_packages
       (category_id, duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order, city_id, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 100), $8, $9)
     RETURNING
       id, category_id, duration_minutes, km_limit, display_order,
       package_fare::text, extra_per_km::text, extra_per_min::text,
       is_active, city_id, updated_by, created_at, updated_at`,
    [fields.category_id, fields.duration_minutes, fields.km_limit,
     fields.package_fare, fields.extra_per_km, fields.extra_per_min,
     fields.display_order ?? null, fields.city_id ?? null, adminId],
  )
  return res.rows[0] as AdminRentalPackage
}
```

- [ ] **Step 3: Accept `city_id` in `updateAdminRentalPackage`'s dynamic SET builder**

Replace (around line 1183-1215):

```typescript
export async function updateAdminRentalPackage(
  id: bigint,
  fields: {
    package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
    duration_minutes?: number; km_limit?: number; display_order?: number
  },
  adminId: bigint,
) {
  const sets: string[] = []
  const params: unknown[] = []
  let p = 1

  if (fields.package_fare     !== undefined) { sets.push(`package_fare     = $${p++}`); params.push(fields.package_fare) }
  if (fields.extra_per_km     !== undefined) { sets.push(`extra_per_km     = $${p++}`); params.push(fields.extra_per_km) }
  if (fields.extra_per_min    !== undefined) { sets.push(`extra_per_min    = $${p++}`); params.push(fields.extra_per_min) }
  if (fields.is_active        !== undefined) { sets.push(`is_active        = $${p++}`); params.push(fields.is_active) }
  if (fields.duration_minutes !== undefined) { sets.push(`duration_minutes = $${p++}`); params.push(fields.duration_minutes) }
  if (fields.km_limit         !== undefined) { sets.push(`km_limit         = $${p++}`); params.push(fields.km_limit) }
  if (fields.display_order    !== undefined) { sets.push(`display_order    = $${p++}`); params.push(fields.display_order) }

  sets.push(`updated_by = $${p++}`)
  params.push(adminId)
  params.push(id)

  const res = await pool.query(
    `UPDATE rental_packages SET ${sets.join(', ')} WHERE id = $${p} RETURNING
       id, category_id, duration_minutes, km_limit, display_order,
       package_fare::text, extra_per_km::text, extra_per_min::text,
       is_active, updated_by, created_at, updated_at`,
    params,
  )
  return res.rows[0] as AdminRentalPackage | undefined
}
```

with:

```typescript
export async function updateAdminRentalPackage(
  id: bigint,
  fields: {
    package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
    duration_minutes?: number; km_limit?: number; display_order?: number; city_id?: number | null
  },
  adminId: bigint,
) {
  const sets: string[] = []
  const params: unknown[] = []
  let p = 1

  if (fields.package_fare     !== undefined) { sets.push(`package_fare     = $${p++}`); params.push(fields.package_fare) }
  if (fields.extra_per_km     !== undefined) { sets.push(`extra_per_km     = $${p++}`); params.push(fields.extra_per_km) }
  if (fields.extra_per_min    !== undefined) { sets.push(`extra_per_min    = $${p++}`); params.push(fields.extra_per_min) }
  if (fields.is_active        !== undefined) { sets.push(`is_active        = $${p++}`); params.push(fields.is_active) }
  if (fields.duration_minutes !== undefined) { sets.push(`duration_minutes = $${p++}`); params.push(fields.duration_minutes) }
  if (fields.km_limit         !== undefined) { sets.push(`km_limit         = $${p++}`); params.push(fields.km_limit) }
  if (fields.display_order    !== undefined) { sets.push(`display_order    = $${p++}`); params.push(fields.display_order) }
  if (fields.city_id          !== undefined) { sets.push(`city_id          = $${p++}`); params.push(fields.city_id) }

  sets.push(`updated_by = $${p++}`)
  params.push(adminId)
  params.push(id)

  const res = await pool.query(
    `UPDATE rental_packages SET ${sets.join(', ')} WHERE id = $${p} RETURNING
       id, category_id, duration_minutes, km_limit, display_order,
       package_fare::text, extra_per_km::text, extra_per_min::text,
       is_active, city_id, updated_by, created_at, updated_at`,
    params,
  )
  return res.rows[0] as AdminRentalPackage | undefined
}
```

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/admin/admin.repository.ts
git commit -m "feat(pricing): city_id support in admin rental-package CRUD queries"
```

---

## Task 6: Admin service — thread `city_id` through validation wrappers

**Files:**
- Modify: `api/src/modules/admin/admin.service.ts:424-494`

- [ ] **Step 1: Widen the `updateAdminRentalPackage` and `createAdminRentalPackage` param types**

In `api/src/modules/admin/admin.service.ts`, update the `updateAdminRentalPackage` signature (around line 424-429):

```typescript
export async function updateAdminRentalPackage(
  id: bigint,
  body: {
    package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
    duration_minutes?: number; km_limit?: number; display_order?: number; city_id?: number | null
  },
  adminId: bigint,
) {
```

The body (validation checks, `repo.updateAdminRentalPackage(id, body, adminId)` call) is unchanged — TypeScript now allows `city_id` to flow through structurally since `repo.updateAdminRentalPackage`'s param type (Task 5) already accepts it.

Update `createAdminRentalPackage`'s signature (around line 469-474):

```typescript
export async function createAdminRentalPackage(
  body: {
    category_id: number; duration_minutes: number; km_limit: number
    package_fare: number; extra_per_km: number; extra_per_min: number
    display_order?: number; city_id?: number | null
  },
  adminId: bigint,
) {
```

No other lines in either function need to change — `rethrowIfDuplicatePackage` (line 410-418) matches on Postgres SQLSTATE `'23505'` only, not a constraint name, so it keeps working unmodified against the renamed unique index from Task 1.

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/admin/admin.service.ts
git commit -m "feat(pricing): thread city_id through rental-package service validation"
```

---

## Task 7: Admin controller — parse `city_id` from request body

**Files:**
- Modify: `api/src/modules/admin/admin.controller.ts:581-620`

- [ ] **Step 1: Parse `city_id` in `patchAdminRentalPackage`**

Replace (around line 581-597):

```typescript
export async function patchAdminRentalPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { package_fare, extra_per_km, extra_per_min, is_active, duration_minutes, km_limit, display_order } = req.body as Record<string, unknown>
    const fields: {
      package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
      duration_minutes?: number; km_limit?: number; display_order?: number
    } = {}
    if (package_fare     !== undefined) fields.package_fare     = Number(package_fare)
    if (extra_per_km     !== undefined) fields.extra_per_km     = Number(extra_per_km)
    if (extra_per_min    !== undefined) fields.extra_per_min    = Number(extra_per_min)
    if (is_active        !== undefined) fields.is_active        = Boolean(is_active)
    if (duration_minutes !== undefined) fields.duration_minutes = Number(duration_minutes)
    if (km_limit         !== undefined) fields.km_limit         = Number(km_limit)
    if (display_order    !== undefined) fields.display_order    = Number(display_order)
    res.json(await service.updateAdminRentalPackage(BigInt(req.params['id']!), fields, req.admin!.id))
  } catch (err) { next(err) }
}
```

with:

```typescript
export async function patchAdminRentalPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { package_fare, extra_per_km, extra_per_min, is_active, duration_minutes, km_limit, display_order, city_id } = req.body as Record<string, unknown>
    const fields: {
      package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
      duration_minutes?: number; km_limit?: number; display_order?: number; city_id?: number | null
    } = {}
    if (package_fare     !== undefined) fields.package_fare     = Number(package_fare)
    if (extra_per_km     !== undefined) fields.extra_per_km     = Number(extra_per_km)
    if (extra_per_min    !== undefined) fields.extra_per_min    = Number(extra_per_min)
    if (is_active        !== undefined) fields.is_active        = Boolean(is_active)
    if (duration_minutes !== undefined) fields.duration_minutes = Number(duration_minutes)
    if (km_limit         !== undefined) fields.km_limit         = Number(km_limit)
    if (display_order    !== undefined) fields.display_order    = Number(display_order)
    if (city_id          !== undefined) fields.city_id          = city_id === null ? null : Number(city_id)
    res.json(await service.updateAdminRentalPackage(BigInt(req.params['id']!), fields, req.admin!.id))
  } catch (err) { next(err) }
}
```

- [ ] **Step 2: Parse `city_id` in `postAdminRentalPackage`**

Replace (around line 606-620):

```typescript
export async function postAdminRentalPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { category_id, duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order } = req.body as Record<string, unknown>
    const pkg = await service.createAdminRentalPackage({
      category_id:      Number(category_id),
      duration_minutes: Number(duration_minutes),
      km_limit:         Number(km_limit),
      package_fare:     Number(package_fare),
      extra_per_km:     Number(extra_per_km),
      extra_per_min:    Number(extra_per_min),
      ...(display_order !== undefined ? { display_order: Number(display_order) } : {}),
    }, req.admin!.id)
    res.status(201).json(pkg)
  } catch (err) { next(err) }
}
```

with:

```typescript
export async function postAdminRentalPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { category_id, duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order, city_id } = req.body as Record<string, unknown>
    const pkg = await service.createAdminRentalPackage({
      category_id:      Number(category_id),
      duration_minutes: Number(duration_minutes),
      km_limit:         Number(km_limit),
      package_fare:     Number(package_fare),
      extra_per_km:     Number(extra_per_km),
      extra_per_min:    Number(extra_per_min),
      ...(display_order !== undefined ? { display_order: Number(display_order) } : {}),
      ...(city_id !== undefined ? { city_id: city_id === null ? null : Number(city_id) } : {}),
    }, req.admin!.id)
    res.status(201).json(pkg)
  } catch (err) { next(err) }
}
```

- [ ] **Step 3: Typecheck the API**

Run: `cd api && npx tsc --noEmit`
Expected: no errors (this closes out the backend — Tasks 1-7 should now compile clean end to end).

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/admin/admin.controller.ts
git commit -m "feat(pricing): parse city_id on rental-package admin create/update routes"
```

---

## Task 8: Admin frontend API client

**Files:**
- Modify: `apps/admin/lib/pricing-api.ts:87-120`

- [ ] **Step 1: Add city fields to `RentalPackageAdmin` and the create/update payloads**

Replace (lines 87-120):

```typescript
export interface RentalPackageAdmin {
  id: number
  category_id: number
  category_name: string
  category_slug: string
  duration_minutes: number
  km_limit: number
  display_order: number
  package_fare: string
  extra_per_km: string
  extra_per_min: string
  is_active: boolean
  updated_at: string
}

export const rentalPackageApi = {
  list: (): Promise<RentalPackageAdmin[]> =>
    api.get('/api/v1/admin/pricing/rental-packages').then(r => r.data as RentalPackageAdmin[]),

  update: (id: number, data: {
    package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
    duration_minutes?: number; km_limit?: number; display_order?: number
  }): Promise<RentalPackageAdmin> =>
    api.patch(`/api/v1/admin/pricing/rental-packages/${id}`, data).then(r => r.data as RentalPackageAdmin),

  create: (data: {
    category_id: number; duration_minutes: number; km_limit: number
    package_fare: number; extra_per_km: number; extra_per_min: number; display_order?: number
  }): Promise<RentalPackageAdmin> =>
    api.post('/api/v1/admin/pricing/rental-packages', data).then(r => r.data as RentalPackageAdmin),

  remove: (id: number): Promise<void> =>
    api.delete(`/api/v1/admin/pricing/rental-packages/${id}`).then(() => undefined),
}
```

with:

```typescript
export interface RentalPackageAdmin {
  id: number
  category_id: number
  category_name: string
  category_slug: string
  duration_minutes: number
  km_limit: number
  display_order: number
  package_fare: string
  extra_per_km: string
  extra_per_min: string
  is_active: boolean
  city_id: number | null
  city_name: string | null
  updated_at: string
}

export const rentalPackageApi = {
  list: (): Promise<RentalPackageAdmin[]> =>
    api.get('/api/v1/admin/pricing/rental-packages').then(r => r.data as RentalPackageAdmin[]),

  update: (id: number, data: {
    package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
    duration_minutes?: number; km_limit?: number; display_order?: number; city_id?: number | null
  }): Promise<RentalPackageAdmin> =>
    api.patch(`/api/v1/admin/pricing/rental-packages/${id}`, data).then(r => r.data as RentalPackageAdmin),

  create: (data: {
    category_id: number; duration_minutes: number; km_limit: number
    package_fare: number; extra_per_km: number; extra_per_min: number; display_order?: number
    city_id?: number | null
  }): Promise<RentalPackageAdmin> =>
    api.post('/api/v1/admin/pricing/rental-packages', data).then(r => r.data as RentalPackageAdmin),

  remove: (id: number): Promise<void> =>
    api.delete(`/api/v1/admin/pricing/rental-packages/${id}`).then(() => undefined),
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/lib/pricing-api.ts
git commit -m "feat(admin): city fields in rental-package API client"
```

---

## Task 9: Admin UI — city selector on the Rental Packages tab

**Files:**
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/page.tsx`

This grafts the same city-selector UX already shipped for rate cards (`CreateRateCardDialog`/`UpdateRateDialog`, lines 55-204 and 208-358) onto the rental package dialogs (`EditRentalPackageDialog`/`CreateRentalPackageDialog`, lines 471-584 and 586-709), plus a City column and city filter on the table (mirroring lines 928-939, 968, 982-986).

- [ ] **Step 1: Give `EditRentalPackageDialog` a city dropdown and accept `cities` as a prop**

Replace the function signature and form state (lines 471-482):

```typescript
function EditRentalPackageDialog({ pkg, onUpdated }: { pkg: RentalPackageAdmin; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    duration_minutes: String(pkg.duration_minutes),
    km_limit:      String(pkg.km_limit),
    display_order: String(pkg.display_order),
    package_fare:  pkg.package_fare,
    extra_per_km:  pkg.extra_per_km,
    extra_per_min: pkg.extra_per_min,
  })
```

with:

```typescript
function EditRentalPackageDialog({ pkg, cities, onUpdated }: { pkg: RentalPackageAdmin; cities: AdminCity[]; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    city_id: pkg.city_id !== null ? String(pkg.city_id) : '',
    duration_minutes: String(pkg.duration_minutes),
    km_limit:      String(pkg.km_limit),
    display_order: String(pkg.display_order),
    package_fare:  pkg.package_fare,
    extra_per_km:  pkg.extra_per_km,
    extra_per_min: pkg.extra_per_min,
  })
```

Update the `useEffect` that resets form on open (lines 484-494) to also reset `city_id`:

```typescript
  useEffect(() => {
    if (open) {
      setForm({
        city_id: pkg.city_id !== null ? String(pkg.city_id) : '',
        duration_minutes: String(pkg.duration_minutes),
        km_limit:      String(pkg.km_limit),
        display_order: String(pkg.display_order),
        package_fare: pkg.package_fare, extra_per_km: pkg.extra_per_km, extra_per_min: pkg.extra_per_min,
      })
      setError('')
    }
  }, [open, pkg])
```

Update `submit` (lines 496-512) to send `city_id`:

```typescript
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      await rentalPackageApi.update(pkg.id, {
        city_id: form.city_id ? parseInt(form.city_id, 10) : null,
        duration_minutes: parseInt(form.duration_minutes, 10),
        km_limit:      parseInt(form.km_limit, 10),
        display_order: parseInt(form.display_order, 10),
        package_fare:  parseFloat(form.package_fare),
        extra_per_km:  parseFloat(form.extra_per_km),
        extra_per_min: parseFloat(form.extra_per_min),
      })
      setOpen(false); onUpdated()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Failed to update package.')
    } finally { setLoading(false) }
  }
```

Add a City field to the form JSX, directly above the `grid grid-cols-3` duration/km/order row (insert before line 529's `<div className="grid grid-cols-3 gap-3">`):

```typescript
            <div>
              <label className={labelCls}>City</label>
              <select value={form.city_id} onChange={e => setForm(f => ({ ...f, city_id: e.target.value }))} className={inputCls}>
                <option value="">All Cities (Global Default)</option>
                {cities.filter(c => c.status === 'active').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="text-xs text-text-muted mt-1">
                {form.city_id ? 'Overrides this tier for the selected city only.' : 'Applies to any city without its own override for this tier.'}
              </p>
            </div>
```

- [ ] **Step 2: Give `CreateRentalPackageDialog` the same city dropdown**

Replace the function signature and form state (lines 586-599):

```typescript
function CreateRentalPackageDialog({
  categories,
  onCreated,
}: {
  categories: { id: number; display_name: string }[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    category_id: '', duration_minutes: '', km_limit: '', display_order: '',
    package_fare: '', extra_per_km: '', extra_per_min: '0',
  })
```

with:

```typescript
function CreateRentalPackageDialog({
  categories, cities,
  onCreated,
}: {
  categories: { id: number; display_name: string }[]
  cities: AdminCity[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    city_id: '', category_id: '', duration_minutes: '', km_limit: '', display_order: '',
    package_fare: '', extra_per_km: '', extra_per_min: '0',
  })
```

Update the reset `useEffect` (lines 601-606):

```typescript
  useEffect(() => {
    if (open) {
      setForm({ city_id: '', category_id: '', duration_minutes: '', km_limit: '', display_order: '', package_fare: '', extra_per_km: '', extra_per_min: '0' })
      setError('')
    }
  }, [open])
```

Update `submit` (lines 608-625) to send `city_id`:

```typescript
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      await rentalPackageApi.create({
        city_id:           form.city_id ? parseInt(form.city_id, 10) : null,
        category_id:       parseInt(form.category_id, 10),
        duration_minutes:  parseInt(form.duration_minutes, 10),
        km_limit:          parseInt(form.km_limit, 10),
        package_fare:      parseFloat(form.package_fare),
        extra_per_km:      parseFloat(form.extra_per_km),
        extra_per_min:     parseFloat(form.extra_per_min),
        ...(form.display_order ? { display_order: parseInt(form.display_order, 10) } : {}),
      })
      setOpen(false); onCreated()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Failed to create package. A package with this duration, km limit, and city may already exist for this category.')
    } finally { setLoading(false) }
  }
```

Add a City field to the form JSX, directly above the `Category *` field (insert before line 642's `<div>\n              <label className={labelCls}>Category *</label>`):

```typescript
            <div>
              <label className={labelCls}>City</label>
              <select value={form.city_id} onChange={e => setForm(f => ({ ...f, city_id: e.target.value }))} className={inputCls}>
                <option value="">All Cities (Global Default)</option>
                {cities.filter(c => c.status === 'active').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
```

- [ ] **Step 3: Pass `cities` down from the page component and render a City column**

The page component already fetches `cities` for the rate-cards tab (line 736, 758). Update the two call sites that render the rental dialogs:

Line 864-869 (page header "New Package" button):

```typescript
        {activeTab === 'rental' && (
          <CreateRentalPackageDialog
            categories={rentalCategories}
            cities={cities}
            onCreated={fetchRental}
          />
        )}
```

Line 1202-1204 (table row edit button):

```typescript
                          <td className="!text-right">
                            <EditRentalPackageDialog pkg={pkg} cities={cities} onUpdated={fetchRental} />
                          </td>
```

Add a City column to the rental packages table header (line 1172-1183), inserting a `<th>City</th>` right after `<th>Duration</th>`:

```typescript
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Duration</th>
                        <th>City</th>
                        <th>KM Limit</th>
                        <th className="!text-right">Package Fare</th>
                        <th className="!text-right">Extra/km</th>
                        <th className="!text-right">Extra/min</th>
                        <th className="!text-center">Active</th>
                        <th className="!text-right">Edit</th>
                        <th className="!text-right">Delete</th>
                      </tr>
                    </thead>
```

Add the matching `<td>` to each row (line 1186-1191), inserting right after the Duration cell:

```typescript
                      {rows.map(pkg => (
                        <tr key={pkg.id} className={`cursor-default ${!pkg.is_active ? 'opacity-50' : ''}`}>
                          <td className="font-semibold text-text-primary">
                            {formatDuration(pkg.duration_minutes)}
                          </td>
                          <td>
                            {pkg.city_name
                              ? <span className="pill-info">{pkg.city_name}</span>
                              : <span className="pill-muted">Global</span>}
                          </td>
                          <td className="text-text-secondary">{pkg.km_limit} km</td>
```

- [ ] **Step 4: Manual verification in the browser**

Run: `cd apps/admin && pnpm dev`, log in as an admin, go to Pricing → Rental Packages tab.
Expected: "New Package" dialog has a City dropdown ("All Cities (Global Default)" + active cities); creating a package with a city selected shows a colored city pill in the table; existing packages show a "Global" pill; editing a package pre-fills its current city.

- [ ] **Step 5: Commit**

```bash
git add "apps/admin/app/(dashboard)/config/rate-cards/page.tsx"
git commit -m "feat(admin): city selector and column for rental packages"
```

---

## Task 10: User app — pass city through the rental-packages fetch

**Files:**
- Modify: `apps/user/lib/ride-api.ts:127-137, 267-270`

- [ ] **Step 1: Add `city_id`/`city_name` to the `RentalPackage` type**

Replace (lines 127-137):

```typescript
export type RentalPackage = {
  id: number
  category_id: number
  category_name: string
  duration_minutes: number
  km_limit: number
  package_fare: number
  extra_per_km: number
  extra_per_min: number
  is_active: boolean
}
```

with:

```typescript
export type RentalPackage = {
  id: number
  category_id: number
  category_name: string
  duration_minutes: number
  km_limit: number
  package_fare: number
  extra_per_km: number
  extra_per_min: number
  is_active: boolean
  city_id: number | null
  city_name: string | null
}
```

- [ ] **Step 2: Accept an optional `cityId` in `getRentalPackages`**

Replace (lines 267-270):

```typescript
  getRentalPackages: async (categoryId: number): Promise<RentalPackage[]> => {
    const res = await api.get(`/api/v1/pricing/rental-packages/${categoryId}`)
    return res.data as RentalPackage[]
  },
```

with:

```typescript
  getRentalPackages: async (categoryId: number, cityId?: number): Promise<RentalPackage[]> => {
    const res = await api.get(`/api/v1/pricing/rental-packages/${categoryId}`, {
      params: cityId !== undefined ? { city_id: cityId } : {},
    })
    return res.data as RentalPackage[]
  },
```

- [ ] **Step 3: Commit**

```bash
git add apps/user/lib/ride-api.ts
git commit -m "feat(user): accept optional city_id when fetching rental packages"
```

---

## Task 11: User app — thread `originCityId` into the rental page's package fetch

**Files:**
- Modify: `apps/user/app/(main)/rental/page.tsx:166-183`

- [ ] **Step 1: Pass `originCityId` into `loadPackages`**

Replace (lines 166-183):

```typescript
  // Fetch packages whenever category changes; auto-select first
  const loadPackages = useCallback(async (catId: number) => {
    setPkgsLoading(true)
    setPackages([])
    setSelectedPkgId(null)
    setEstimate(null)
    try {
      const pkgs = await rideApi.getRentalPackages(catId)
      setPackages(pkgs)
      if (pkgs[0]) setSelectedPkgId(pkgs[0].id)
    } catch {
      setPackages([])
    } finally {
      setPkgsLoading(false)
    }
  }, [])

  useEffect(() => { void loadPackages(selectedCatId) }, [selectedCatId, loadPackages])
```

with:

```typescript
  // Fetch packages whenever category changes; auto-select first
  const loadPackages = useCallback(async (catId: number, cityId: number) => {
    setPkgsLoading(true)
    setPackages([])
    setSelectedPkgId(null)
    setEstimate(null)
    try {
      const pkgs = await rideApi.getRentalPackages(catId, cityId)
      setPackages(pkgs)
      if (pkgs[0]) setSelectedPkgId(pkgs[0].id)
    } catch {
      setPackages([])
    } finally {
      setPkgsLoading(false)
    }
  }, [])

  useEffect(() => { void loadPackages(selectedCatId, originCityId) }, [selectedCatId, originCityId, loadPackages])
```

(`originCityId` is already parsed in scope at line 80: `const originCityId = parseInt(sp.get('originCityId') ?? '1', 10)`.)

- [ ] **Step 2: Manual verification in the browser**

Run: `cd apps/user && pnpm dev`, book a rental ride from a city with an admin-configured package override (created in Task 9's verification step) and confirm the overridden fare shows; then repeat from a city with no override and confirm the global fare shows.

- [ ] **Step 3: Commit**

```bash
git add "apps/user/app/(main)/rental/page.tsx"
git commit -m "feat(user): fetch rental packages scoped to the pickup city"
```

---

## Task 12: Full-stack verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck everything**

Run:
```bash
cd api && npx tsc --noEmit
cd ../apps/admin && npx tsc --noEmit
cd ../apps/user && npx tsc --noEmit
```
Expected: no errors in any of the three.

- [ ] **Step 2: End-to-end manual check via SQL + curl**

```bash
docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT id, category_id, city_id, duration_minutes, km_limit, package_fare FROM rental_packages ORDER BY category_id, city_id NULLS FIRST LIMIT 10"
```
Expected: existing rows all show `city_id = NULL` (global, unaffected by the migration).

Create a city override through the admin UI (Task 9), then:
```bash
curl "http://localhost:3000/api/v1/pricing/rental-packages/<category_id>?city_id=<overridden_city_id>"
curl "http://localhost:3000/api/v1/pricing/rental-packages/<category_id>"
```
Expected: the first call returns the overridden tier's package_fare for that one tier and global fares for every other tier of the same category; the second (no city_id) returns all-global fares including the tier you just overrode.

- [ ] **Step 3: Run the API's existing unit test suite as a regression check**

Run: `cd api && pnpm test`
Expected: all currently-passing unit tests still pass (this change touches no code they cover, but confirms nothing else broke).

---

## Self-review notes

- **Spec coverage:** rate_cards already city-scoped (no task needed) → confirmed via Task 0 research. surge_events already city-scoped (no task needed) → called out explicitly in the Architecture section so nobody "fixes" it again. rental_packages was the actual gap → Tasks 1-11 cover schema, backend (public + admin), and both frontends (admin + user).
- **Merge-vs-replace semantics:** documented in Task 3's step as "city row wins per tier, merge not replace" — flagged as a known UX ceiling in the Architecture note. **Correction (post-implementation, per final review):** the original note claimed an admin could "hide" a global tier for one city by setting `is_active=false` on a city-specific override row. That's wrong — `getRentalPackagesByCategory`'s `WHERE rp.is_active = true` filters out the inactive city row *before* the `DISTINCT ON` fallback runs, so the active global row resurfaces for that tier instead. There is no way to suppress a global tier for a single city with this schema; an inactive city override simply reverts that city to the global price for that tier (arguably the saner behavior anyway). Not fixed — no requirement surfaced for "hide a tier per city," YAGNI. If it's ever needed, it requires a real mechanism (e.g. a separate suppression flag), not `is_active`.
- **Type consistency check:** `RentalPackageAdmin.city_id` (Task 8) matches `AdminRentalPackage.city_id` (Task 2) — both `number | null`. `rentalPackageApi.create`/`update` payload shapes (Task 8) match what `admin.controller.ts` (Task 7) parses and what `admin.repository.ts` (Task 5) accepts. Public `RentalPackage` type is duplicated between `pricing.types.ts` (Task 2, backend) and `apps/user/lib/ride-api.ts` (Task 10, frontend) — this duplication already existed pre-change (no shared-types package in this monorepo per CLAUDE.md), so it's consistent with existing convention, not a new problem.
