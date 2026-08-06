# Vehicle Category Fallback Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a driver's vehicle category also serve ride requests one tier below it (sedan↔hatchback, suv↔sedan, luxury↔suv), so a ride request has more eligible drivers when its exact category is scarce — without changing rider pricing.

**Architecture:** A new `category_fallback_rules` table stores which driver category accepts which additional rider category. `findNearbyDrivers`/`findReturnCabDrivers` switch from an exact `category_id = $N` filter to `category_id = ANY($N::bigint[])`. The existing 3-round broadcast (`broadcast.processor.ts`) restricts round 1 to the rider's exact category and widens to the fallback set from round 2 onward — no new scheduling infrastructure. `return-cab-available` uses the widened set immediately (no rounds there). Fare is untouched — it's always priced off the ride's booked `category_id`.

**Tech Stack:** Express + TypeScript, PostgreSQL (`pg` pool), BullMQ (existing `DISPATCH` queue, untouched), Vitest for tests.

---

## Task 1: Migration — `category_fallback_rules` table

**Files:**
- Create: `api/src/db/migrations/081_category_fallback_rules.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Lets a driver's vehicle category also serve ride requests one tier below
-- it, raising eligible driver supply per ride when the exact category is
-- scarce. category_id = the driver's own vehicle category;
-- accepts_category_id = an additional rider-booked category that driver
-- category is eligible for. A category's own tier is always implicitly
-- eligible (enforced in application code, not stored here) — this table
-- only holds the extra accepted tier. `van` is intentionally excluded: it
-- doesn't sit on the hatchback→sedan→suv→luxury price ladder (016_seed.sql
-- prices van below both suv and luxury).

CREATE TABLE category_fallback_rules (
  category_id BIGINT NOT NULL REFERENCES vehicle_categories(id),
  accepts_category_id BIGINT NOT NULL REFERENCES vehicle_categories(id),
  PRIMARY KEY (category_id, accepts_category_id)
);

INSERT INTO category_fallback_rules (category_id, accepts_category_id)
SELECT s.id, h.id FROM vehicle_categories s, vehicle_categories h
WHERE s.slug = 'sedan' AND h.slug = 'hatchback';

INSERT INTO category_fallback_rules (category_id, accepts_category_id)
SELECT suv.id, sd.id FROM vehicle_categories suv, vehicle_categories sd
WHERE suv.slug = 'suv' AND sd.slug = 'sedan';

INSERT INTO category_fallback_rules (category_id, accepts_category_id)
SELECT l.id, suv.id FROM vehicle_categories l, vehicle_categories suv
WHERE l.slug = 'luxury' AND suv.slug = 'suv';
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: output includes `081_category_fallback_rules.sql` applied, no errors.

- [ ] **Step 3: Verify seed rows**

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT s.slug AS category, a.slug AS also_accepts FROM category_fallback_rules f JOIN vehicle_categories s ON s.id = f.category_id JOIN vehicle_categories a ON a.id = f.accepts_category_id ORDER BY s.slug;"`
Expected: 3 rows — `luxury|suv`, `sedan|hatchback`, `suv|sedan`.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/081_category_fallback_rules.sql
git commit -m "feat(rides): add category_fallback_rules table"
```

---

## Task 2: `getEligibleDriverCategoryIds` repository helper

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts`
- Test: `api/src/modules/rides/rides.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/src/modules/rides/rides.repository.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}))

import { getEligibleDriverCategoryIds } from './rides.repository'

describe('getEligibleDriverCategoryIds', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('returns the rider category plus any fallback driver categories', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ category_id: '1' }] })

    const result = await getEligibleDriverCategoryIds(2n)

    expect(result).toEqual([2n, 1n])
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM category_fallback_rules'),
      [2n]
    )
  })

  it('returns only the rider category when no fallback rows target it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    const result = await getEligibleDriverCategoryIds(5n)

    expect(result).toEqual([5n])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/modules/rides/rides.repository.test.ts`
Expected: FAIL — `getEligibleDriverCategoryIds is not a function` (or module has no export).

- [ ] **Step 3: Implement the helper**

Add to `api/src/modules/rides/rides.repository.ts` (near the other simple SELECT helpers such as `getActiveSession`):

```ts
// Which driver categories are eligible to serve a ride booked at rideCategoryId:
// the ride's own category, plus any category that lists it as an accepted
// fallback tier (category_fallback_rules.accepts_category_id = rideCategoryId).
export async function getEligibleDriverCategoryIds(rideCategoryId: bigint): Promise<bigint[]> {
  const res = await pool.query<{ category_id: string }>(
    `SELECT category_id FROM category_fallback_rules WHERE accepts_category_id = $1`,
    [rideCategoryId]
  )
  return [rideCategoryId, ...res.rows.map(r => BigInt(r.category_id))]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/modules/rides/rides.repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/src/modules/rides/rides.repository.test.ts
git commit -m "feat(rides): add getEligibleDriverCategoryIds repository helper"
```

---

## Task 3: `findNearbyDrivers` accepts a category array

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts`
- Test: `api/src/modules/rides/rides.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `api/src/modules/rides/rides.repository.test.ts`:

```ts
import { findNearbyDrivers } from './rides.repository'

describe('findNearbyDrivers', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('filters drivers with category_id = ANY(categoryIds)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await findNearbyDrivers({
      lat: 20.29,
      lng: 85.82,
      categoryIds: [2n, 1n],
      minWalletBalance: 100,
    })

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ds.category_id = ANY($3::bigint[])')
    expect(params[2]).toEqual([2n, 1n])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/modules/rides/rides.repository.test.ts`
Expected: FAIL — either a TypeScript error on `categoryIds` not existing on the params type, or the SQL still reads `ds.category_id = $3` (no `ANY`).

- [ ] **Step 3: Update `findNearbyDrivers`**

In `api/src/modules/rides/rides.repository.ts`, change the function signature and query:

```ts
export async function findNearbyDrivers(params: {
  lat: number
  lng: number
  categoryIds: bigint[]
  radiusMetres?: number
  maxDrivers?: number
  minWalletBalance: number
}): Promise<NearbyDriver[]> {
  const radius = params.radiusMetres ?? 5000
  const max    = params.maxDrivers ?? 5
  const res = await pool.query<NearbyDriver>(
    `SELECT
       dls.driver_id,
       ds.id AS session_id,
       ds.mode,
       ST_Y(dls.location::geometry) AS lat,
       ST_X(dls.location::geometry) AS lng,
       ST_Distance(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography
       ) AS distance_metres
     FROM driver_location_snapshots dls
     JOIN driver_sessions ds ON ds.id = dls.session_id
     LEFT JOIN driver_wallets dw ON dw.driver_id = ds.driver_id
     LEFT JOIN driver_package_wallets dpw ON dpw.driver_id = ds.driver_id
     LEFT JOIN LATERAL (
       SELECT c.billing_mode
       FROM cities c
       WHERE c.status = 'active'
       ORDER BY ST_Distance(c.centroid, dls.location) ASC
       LIMIT 1
     ) nc ON true
     WHERE dls.is_available = true
       AND ds.status = 'online'
       AND ds.mode = 'standard'
       AND ds.category_id = ANY($3::bigint[])
       AND (
         (nc.billing_mode = 'commission' AND COALESCE(dw.balance, 0) >= $6 AND NOT COALESCE(dw.is_frozen, false))
         OR
         (nc.billing_mode = 'package' AND COALESCE(dpw.balance, 0) > 0 AND NOT COALESCE(dpw.is_frozen, false))
         OR
         -- nc.billing_mode IS NULL is only reachable if zero active cities exist system-wide
         -- (not a per-driver distance edge case — the LATERAL subquery has no distance bound,
         -- it always returns the single nearest active city). Falls back to the commission-style
         -- check in that case; unreachable in production since cities are always seeded.
         nc.billing_mode IS NULL
       )
       AND ST_DWithin(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         $4
       )
     ORDER BY distance_metres ASC
     LIMIT $5`,
    [params.lat, params.lng, params.categoryIds, radius, max, params.minWalletBalance]
  )
  return res.rows
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/modules/rides/rides.repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/src/modules/rides/rides.repository.test.ts
git commit -m "feat(rides): findNearbyDrivers matches on an array of eligible categories"
```

---

## Task 4: `findReturnCabDrivers` accepts a category array

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts`
- Test: `api/src/modules/rides/rides.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `api/src/modules/rides/rides.repository.test.ts`:

```ts
import { findReturnCabDrivers } from './rides.repository'

describe('findReturnCabDrivers', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('filters drivers with category_id = ANY(categoryIds)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })

    await findReturnCabDrivers({
      pickupLat: 20.29,
      pickupLng: 85.82,
      dropLat: 20.46,
      dropLng: 85.88,
      categoryIds: [3n, 2n],
      minWalletBalance: 100,
    })

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ds.category_id = ANY($5::bigint[])')
    expect(params[4]).toEqual([3n, 2n])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/modules/rides/rides.repository.test.ts`
Expected: FAIL — `categoryIds` type mismatch or SQL still `ds.category_id = $5`.

- [ ] **Step 3: Update `findReturnCabDrivers`**

In `api/src/modules/rides/rides.repository.ts`:

```ts
export async function findReturnCabDrivers(params: {
  pickupLat: number
  pickupLng: number
  dropLat: number
  dropLng: number
  categoryIds: bigint[]
  minWalletBalance: number
}): Promise<NearbyDriver[]> {
  const res = await pool.query<NearbyDriver>(
    `SELECT
       rcr.driver_id,
       rcr.session_id,
       ds.mode,
       ST_Y(dls.location::geometry) AS lat,
       ST_X(dls.location::geometry) AS lng,
       ST_Distance(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography
       ) AS distance_metres
     FROM return_cab_routes rcr
     JOIN driver_sessions ds ON ds.id = rcr.session_id
     JOIN driver_location_snapshots dls ON dls.driver_id = rcr.driver_id
     LEFT JOIN driver_wallets dw ON dw.driver_id = rcr.driver_id
     LEFT JOIN driver_package_wallets dpw ON dpw.driver_id = rcr.driver_id
     LEFT JOIN LATERAL (
       SELECT c.billing_mode
       FROM cities c
       WHERE c.status = 'active'
       ORDER BY ST_Distance(c.centroid, dls.location) ASC
       LIMIT 1
     ) nc ON true
     WHERE rcr.is_active = true
       AND ds.status = 'online'
       AND ds.category_id = ANY($5::bigint[])
       AND (
         (nc.billing_mode = 'commission' AND COALESCE(dw.balance, 0) >= $6 AND NOT COALESCE(dw.is_frozen, false))
         OR
         (nc.billing_mode = 'package' AND COALESCE(dpw.balance, 0) > 0 AND NOT COALESCE(dpw.is_frozen, false))
         OR
         -- nc.billing_mode IS NULL is only reachable if zero active cities exist system-wide
         -- (not a per-driver distance edge case — the LATERAL subquery has no distance bound,
         -- it always returns the single nearest active city). Falls back to the commission-style
         -- check in that case; unreachable in production since cities are always seeded.
         nc.billing_mode IS NULL
       )
       AND ST_DWithin(
         rcr.corridor,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         rcr.match_radius_metres
       )
       AND ST_DWithin(
         rcr.corridor,
         ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography,
         rcr.match_radius_metres
       )
     ORDER BY distance_metres ASC
     LIMIT 3`,
    [params.pickupLat, params.pickupLng, params.dropLat, params.dropLng, params.categoryIds, params.minWalletBalance]
  )
  return res.rows
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/modules/rides/rides.repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/src/modules/rides/rides.repository.test.ts
git commit -m "feat(rides): findReturnCabDrivers matches on an array of eligible categories"
```

---

## Task 5: Stage category widening into the broadcast rounds

**Files:**
- Modify: `api/src/jobs/processors/broadcast.processor.ts`
- Test: `api/src/jobs/processors/broadcast.processor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/jobs/processors/broadcast.processor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetRideById = vi.fn()
const mockGetRideStops = vi.fn()
const mockFindNearbyDrivers = vi.fn()
const mockFindReturnCabDrivers = vi.fn()
const mockGetEligibleDriverCategoryIds = vi.fn()
const mockCreateRideAssignment = vi.fn()
const mockUpdateRideStatus = vi.fn()
const mockLogStatusHistory = vi.fn()

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById: (...a: unknown[]) => mockGetRideById(...a),
  getRideStops: (...a: unknown[]) => mockGetRideStops(...a),
  findNearbyDrivers: (...a: unknown[]) => mockFindNearbyDrivers(...a),
  findReturnCabDrivers: (...a: unknown[]) => mockFindReturnCabDrivers(...a),
  getEligibleDriverCategoryIds: (...a: unknown[]) => mockGetEligibleDriverCategoryIds(...a),
  createRideAssignment: (...a: unknown[]) => mockCreateRideAssignment(...a),
  updateRideStatus: (...a: unknown[]) => mockUpdateRideStatus(...a),
  logStatusHistory: (...a: unknown[]) => mockLogStatusHistory(...a),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  getMinWalletBalance: vi.fn().mockResolvedValue(100),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideRequest: vi.fn() },
}))
vi.mock('@/db/redis', () => ({
  client: { set: vi.fn() },
}))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn() } },
  QUEUE_NAMES: { DISPATCH: 'dispatch' },
}))

import { processBroadcast } from './broadcast.processor'

describe('processBroadcast category eligibility per round', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRideById.mockResolvedValue({ id: 1n, status: 'requested', origin_address: 'A', destination_address: 'B', total_estimated: '100' })
    mockGetRideStops.mockResolvedValue([])
    mockFindNearbyDrivers.mockResolvedValue([])
    mockFindReturnCabDrivers.mockResolvedValue([])
  })

  it('round 1 queries only the ride\'s exact category, without calling the eligibility helper', async () => {
    await processBroadcast({
      rideId: '1', categoryId: '2', originLat: 20.29, originLng: 85.82,
      rideType: 'one_way', isReturnCab: false, broadcastRound: 1,
    })

    expect(mockGetEligibleDriverCategoryIds).not.toHaveBeenCalled()
    expect(mockFindNearbyDrivers).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [2n] })
    )
  })

  it('round 2 widens to the fallback category set', async () => {
    mockGetEligibleDriverCategoryIds.mockResolvedValue([2n, 1n])

    await processBroadcast({
      rideId: '1', categoryId: '2', originLat: 20.29, originLng: 85.82,
      rideType: 'one_way', isReturnCab: false, broadcastRound: 2,
    })

    expect(mockGetEligibleDriverCategoryIds).toHaveBeenCalledWith(2n)
    expect(mockFindNearbyDrivers).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [2n, 1n] })
    )
  })

  it('round 3 also widens to the fallback category set for a return cab', async () => {
    mockGetEligibleDriverCategoryIds.mockResolvedValue([3n, 2n])

    await processBroadcast({
      rideId: '1', categoryId: '3', originLat: 20.29, originLng: 85.82,
      destinationLat: 20.46, destinationLng: 85.88,
      rideType: 'one_way', isReturnCab: true, broadcastRound: 3,
    })

    expect(mockFindReturnCabDrivers).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: [3n, 2n] })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/jobs/processors/broadcast.processor.test.ts`
Expected: FAIL — `findNearbyDrivers`/`findReturnCabDrivers` are currently called with `categoryId` (singular), not `categoryIds`.

- [ ] **Step 3: Update `broadcast.processor.ts`**

In `api/src/jobs/processors/broadcast.processor.ts`, replace the body of `processBroadcast` from the `const stops = ...` line through the `findNearbyDrivers` call with:

```ts
  const stops = await repo.getRideStops(rideId)
  const minWalletBalance = await getMinWalletBalance()

  // Round 1 stays exact-category only, so native-tier drivers get first crack
  // at their own tier's fare. Rounds 2+ widen to fallback-tier drivers
  // (category_fallback_rules) once the ride has gone unaccepted past round 1.
  const categoryIds = data.broadcastRound === 1
    ? [categoryId]
    : await repo.getEligibleDriverCategoryIds(categoryId)

  let drivers: Array<{
    driver_id: bigint
    session_id: bigint
    lat: number
    lng: number
    distance_metres: number
  }> = []

  if (data.isReturnCab && data.destinationLat != null && data.destinationLng != null) {
    const returnDrivers = await repo.findReturnCabDrivers({
      pickupLat: data.originLat,
      pickupLng: data.originLng,
      dropLat:   data.destinationLat,
      dropLng:   data.destinationLng,
      categoryIds,
      minWalletBalance,
    })
    drivers = returnDrivers.map(d => ({
      driver_id:        BigInt(d.driver_id),
      session_id:       BigInt(d.session_id),
      lat:              d.lat ?? data.originLat,
      lng:              d.lng ?? data.originLng,
      distance_metres:  d.distance_metres ?? 0,
    }))
  }

  if (drivers.length < MAX_DRIVERS) {
    const radiusMetres = data.radiusMetres ?? ROUND_RADII[data.broadcastRound] ?? 8000
    const standardDrivers = await repo.findNearbyDrivers({
      lat: data.originLat,
      lng: data.originLng,
      categoryIds,
      maxDrivers: MAX_DRIVERS - drivers.length,
      radiusMetres,
      minWalletBalance,
    })
```

(Everything after this — the `included`/dedup loop, assignment creation, ACK scheduling, socket emit, and logging — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/jobs/processors/broadcast.processor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/jobs/processors/broadcast.processor.ts api/src/jobs/processors/broadcast.processor.test.ts
git commit -m "feat(rides): widen broadcast to fallback categories from round 2 onward"
```

---

## Task 6: `return-cab-available` uses the widened category set

**Files:**
- Modify: `api/src/modules/rides/rides.routes.ts:134-148`

- [ ] **Step 1: Update the route handler**

In `api/src/modules/rides/rides.routes.ts`, replace the `/return-cab-available` handler:

```ts
router.get('/return-cab-available', async (req, res, next) => {
  try {
    const pickupLat = parseFloat(req.query['pickupLat'] as string)
    const pickupLng = parseFloat(req.query['pickupLng'] as string)
    const dropLat   = parseFloat(req.query['dropLat']   as string)
    const dropLng   = parseFloat(req.query['dropLng']   as string)
    const categoryId = BigInt(req.query['categoryId'] as string)
    if ([pickupLat, pickupLng, dropLat, dropLng].some(isNaN)) {
      res.status(400).json({ error: 'pickupLat, pickupLng, dropLat, dropLng required' }); return
    }
    const minWalletBalance = await paymentsService.getMinWalletBalance()
    const categoryIds = await repo.getEligibleDriverCategoryIds(categoryId)
    const drivers = await repo.findReturnCabDrivers({ pickupLat, pickupLng, dropLat, dropLng, categoryIds, minWalletBalance })
    res.json({ drivers, count: drivers.length })
  } catch (err) { next(err) }
})
```

(Only the two added/changed lines: `const categoryIds = await repo.getEligibleDriverCategoryIds(categoryId)` and passing `categoryIds` instead of `categoryId` into `findReturnCabDrivers`.)

- [ ] **Step 2: Manual verification**

This route has no existing test file and no `authenticate()` middleware (pre-existing — out of scope for this plan), so verify manually:

Run: `cd api && pnpm dev` (in one terminal), then in another:
```bash
curl "http://localhost:3000/api/v1/rides/return-cab-available?pickupLat=20.29&pickupLng=85.82&dropLat=20.46&dropLng=85.88&categoryId=2"
```
Expected: HTTP 200 with `{"drivers": [...], "count": N}` — no error, confirms `getEligibleDriverCategoryIds` resolves and the route still responds. (Use a real `sedan` category id from your DB, e.g. `SELECT id FROM vehicle_categories WHERE slug='sedan';`.)

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/rides/rides.routes.ts
git commit -m "feat(rides): return-cab-available matches fallback-tier drivers too"
```

---

## Task 7: Driver app shows the rider's booked category on incoming requests

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts`
- Modify: `api/src/jobs/processors/broadcast.processor.ts`
- Modify: `apps/driver/src/components/ui/TripRequestCard.tsx`

Today `TripRequestCard` shows no category at all — it silently assumes the incoming request matches the driver's own vehicle. Now that a request can be one tier below the driver's own category, the card needs to say so.

- [ ] **Step 1: Add a category-name lookup to the repository**

Add to `api/src/modules/rides/rides.repository.ts`, near `getEligibleDriverCategoryIds`:

```ts
export async function getCategoryDisplayName(categoryId: bigint): Promise<string | null> {
  const res = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM vehicle_categories WHERE id = $1`,
    [categoryId]
  )
  return res.rows[0]?.display_name ?? null
}
```

- [ ] **Step 2: Include the category name in the broadcast payload**

In `api/src/jobs/processors/broadcast.processor.ts`, after the `categoryIds` line added in Task 5, fetch the display name once per broadcast call:

```ts
  const categoryIds = data.broadcastRound === 1
    ? [categoryId]
    : await repo.getEligibleDriverCategoryIds(categoryId)
  const categoryName = await repo.getCategoryDisplayName(categoryId)
```

Then, in the `requestPayload` object built inside the `for (const driver of drivers)` loop, add one field:

```ts
    const requestPayload: Record<string, unknown> = {
      rideId:            data.rideId,
      pickup:            ride.origin_address   ?? 'Pickup location',
      drop:              ride.destination_address ?? 'Destination',
      pickupLat:         data.originLat,
      pickupLng:         data.originLng,
      destinationLat:    ride.dest_lat ?? undefined,
      destinationLng:    ride.dest_lng ?? undefined,
      distanceToPickup:  Math.round(driver.distance_metres),
      estimatedFare:     ride.total_estimated != null ? parseFloat(ride.total_estimated) : 0,
      rideType:          data.rideType,
      isReturnCab:       data.isReturnCab,
      expiresAt:         expiresAt.toISOString(),
      timeoutSeconds:    BROADCAST_WINDOW_SECONDS,
      stopCount:         stops.length,
    }
    if (categoryName)     requestPayload['rideCategoryName'] = categoryName
```

- [ ] **Step 3: Extend the ack-check job data and driver socket event type (if typed)**

Check `AckCheckJobData` in `api/src/jobs/processors/ack-check.processor.ts` — this plan does not change the ack-check retry payload, only the initial `sendRideRequest` socket payload, so no change needed there. Skip if `AckCheckJobData` has no category field already (confirm by grep: `rg "rideCategoryName|categoryId" api/src/jobs/processors/ack-check.processor.ts` should return nothing — if it does, stop and reconcile before continuing).

- [ ] **Step 4: Update `TripRequestCard` to render the category name**

In `apps/driver/src/components/ui/TripRequestCard.tsx`, add `rideCategoryName?: string` to the `TripRequestCardProps` interface (`TripRequestCardProps`, currently lines 37-57), right after `rideType: string`:

```tsx
interface TripRequestCardProps {
  pickup: string
  drop: string
  pickupDistance: number
  tripDistance: number
  fare: number
  timeRemaining: number
  rideType: string
  rideCategoryName?: string
  tripHours?: number
  returnAt?: string
  stopCount?: number
  pickupLat: number
  pickupLng: number
  isAccepting?: boolean
  accepted?: boolean
  failed?: boolean
  onAccept: () => void
  onDecline: () => void
}
```

Destructure it in the component's props (currently lines 83-87):

```tsx
export default function TripRequestCard({
  pickup, drop, pickupDistance, tripDistance, fare,
  timeRemaining: initialTime, rideType, rideCategoryName, tripHours, returnAt, stopCount,
  pickupLat, pickupLng, isAccepting, accepted, failed, onAccept, onDecline,
}: TripRequestCardProps) {
```

Render it in the header block, right after the `RIDE_TYPE_BADGE` span closes (currently lines 222-235), reusing the same badge markup pattern and the file's existing `C.primary` teal accent token:

```tsx
          <motion.div variants={childVar} className="flex items-center justify-between px-5 pt-3 pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-[15px] font-semibold flex-shrink-0" style={{ color: C.text }}>
                {rideType === 'round_trip' ? 'Round trip' : rideType === 'rental' ? 'Rental request' : 'Trip request'}
              </p>
              {RIDE_TYPE_BADGE[rideType] && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: RIDE_TYPE_BADGE[rideType]!.bg, color: RIDE_TYPE_BADGE[rideType]!.color }}
                >
                  {RIDE_TYPE_BADGE[rideType]!.label}
                </span>
              )}
              {rideCategoryName && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: 'rgba(10,159,176,0.18)', color: C.primary }}
                >
                  {rideCategoryName} ride
                </span>
              )}
            </div>
```

(The rest of that block — the `stopCount` badge and closing tags — is unchanged.)

- [ ] **Step 5: Wire the prop from the socket payload into the component**

Find where `TripRequestCard` is rendered from the incoming socket payload (in `apps/driver/src/pages/Home.tsx` or wherever the overlay is mounted — grep `<TripRequestCard` to locate it) and pass `rideCategoryName={payload.rideCategoryName}` alongside the other props already being passed through from the socket event.

- [ ] **Step 6: Manual verification**

Run: `cd apps/driver && pnpm dev`, go online as an SUV-category driver, and trigger a Sedan-category test booking from the user app (or via `curl` against the booking endpoint with a sedan `categoryId`) after the driver has been online through round 1 (wait ~25s so round 2 fires). Confirm the incoming request overlay shows a "Sedan ride" badge.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/src/jobs/processors/broadcast.processor.ts apps/driver/src/components/ui/TripRequestCard.tsx apps/driver/src/pages/Home.tsx
git commit -m "feat(driver): show rider's booked category on fallback-tier incoming requests"
```

---

## Task 8: Full API test suite + typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full API test suite**

Run: `cd api && pnpm test`
Expected: all tests pass, including the 4 new `rides.repository.test.ts` cases and 3 new `broadcast.processor.test.ts` cases.

- [ ] **Step 2: Typecheck the API**

Run: `cd api && npx tsc --noEmit`
Expected: no errors. This catches any remaining caller of `findNearbyDrivers`/`findReturnCabDrivers` still passing the old singular `categoryId` field.

- [ ] **Step 3: Typecheck the driver app**

Run: `cd apps/driver && npx tsc --noEmit` (or the project's configured typecheck script if different — check `apps/driver/package.json` `scripts.typecheck`)
Expected: no errors.

- [ ] **Step 4: Commit (only if any fixes were needed in prior steps)**

If typecheck surfaced any missed caller, fix it and commit:

```bash
git add -A
git commit -m "fix(rides): update remaining caller of findNearbyDrivers/findReturnCabDrivers"
```

---
