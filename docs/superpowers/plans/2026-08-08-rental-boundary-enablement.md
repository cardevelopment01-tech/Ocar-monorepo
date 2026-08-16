# Rental Boundary Enablement (Angul / Jajpur / Jajpur Road / Paradeep / Puri) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable proper hourly-rental service in Angul, Jajpur (town), Jajpur Road, Paradeep and Puri — real boundary/coordinate data for all five, plus the "driver left the rental zone" alert feature (`RIDE_TYPES_PLAN.md` Phase 5) that boundary data exists to support, since it's currently spec-only with zero implementation.

**Architecture:** Part A lands the data (a renamed/untouched research migration + one new migration for the gaps it didn't cover: Jajpur Road doesn't exist as a city row at all, Angul's centroid was a guess, Angul and Jajpur Road have no real OSM municipal boundary to pull so they get a documented interim circular buffer). Part B builds Phase 5 on top of that data: the GPS-flush worker checks live position against `cities.boundary` for in-progress rentals, debounces via Redis, emits a socket event; the user app's ride-tracking screen shows a dismissible banner on receipt.

**Tech Stack:** PostgreSQL 18 + PostGIS (migrations), Express/TypeScript API, BullMQ worker, ioredis, Socket.io, Next.js 16 (user app).

---

## Assumptions (stated explicitly per plan)

1. **Jajpur Road gets its own `cities` row**, not a bigger Jajpur polygon. It's ~25km from Jajpur Town, in a different tehsil (Vyasanagar), confirmed via OSM/Nominatim research this session. One polygon spanning both would swallow ~20km of rural corridor as "in-city."
2. **Interim boundary for Angul and Jajpur Road = a 3km-radius circle** around the verified centroid. Neither has any OSM administrative relation at town/city level to pull a real polygon from (confirmed via Nominatim search this session — Angul only has a district-level relation, Jajpur Road/Byasanagar only has a bare place node). 3km is chosen conservatively: it's below the *shortest* axis of every real municipality polygon already in the codebase (Puri ~4.0km, Rourkela ~4.8km short axis) — better to under-cover than to misclassify rural highway trips as cheap in-city rentals. This must be replaced with a real surveyed/OSM boundary once available; each UPDATE is tagged with a `-- TODO(interim-boundary):` comment so it's greppable later.
3. **`is_rental_enabled` flips to `true`** for all five cities as part of this work — that's the actual ask. `is_return_cab_enabled` stays `false` (separate feature, not requested).
4. **No new rate-card rows needed.** `rate_cards`/`rental_packages` already fall back to `city_id IS NULL` global rows (confirmed in `pricing.repository.ts`), so enabling `is_rental_enabled` is enough to get *a* rental price — per-city tuning is a documented follow-up, not part of this plan (matches the existing "Round-trip package defaults are placeholders" note pattern in CLAUDE.md).
5. **Phase 5 is an alert, not an automatic fare-model conversion.** Confirmed by re-reading `docs/RIDE_TYPES_PLAN.md` — it emits a socket event and shows a banner. It does not cancel the ride, block it, or switch it to one-way billing. Overage/what-happens-next is out of scope for this plan (nothing in the spec calls for it).

---

## Part A — Coordinate & Boundary Data

### Task 1: Rename the stashed research migration (no content changes)

**Files:**
- Rename: `api/src/db/migrations/083_backfill_city_boundaries.sql` → `api/src/db/migrations/086_backfill_city_boundaries.sql`

The migration currently sits untracked in the working tree numbered `083`, but `083_backfill_driver_city_id.sql`, `084_city_wise_rental_packages.sql`, and `085_call_masking.sql` have since been merged and already claim that number range. Migrations are tracked by full filename (`api/src/db/migrate.ts:77`, `:84-86` sorts and reads the directory), so a duplicate numeric prefix won't break the tracking table, but it would run out of chronological order and confuse anyone reading the migrations list. Renumber it to the next free slot.

- [ ] **Step 1: Rename the file**

```powershell
Move-Item api\src\db\migrations\083_backfill_city_boundaries.sql api\src\db\migrations\086_backfill_city_boundaries.sql
```

- [ ] **Step 2: Verify no other file claims 086**

```powershell
Get-ChildItem api\src\db\migrations | Where-Object { $_.Name -like '086_*' }
```
Expected: exactly one file, `086_backfill_city_boundaries.sql`.

- [ ] **Step 3: Commit**

```bash
git add api/src/db/migrations/086_backfill_city_boundaries.sql
git commit -m "chore: renumber stashed city-boundary backfill migration to 086"
```

---

### Task 2: Add Jajpur Road as its own city

**Files:**
- Create: `api/src/db/migrations/087_add_jajpur_road_and_fix_gaps.sql`

Jajpur Road (Byasanagar/Vyasanagar Municipality) has no row in `cities` today. Insert it following the exact pattern `069_add_angul_jajpur_paradip.sql` used, but with `is_rental_enabled = true` from the start since that's the point of this work. Centroid is the verified OSM place node (`node/2467312527`, class=place, type=town) found via Nominatim this session.

- [ ] **Step 1: Write the migration's city insert**

```sql
-- Jajpur Road (Byasanagar / Vyasanagar Municipality) is a distinct town ~25km from
-- Jajpur Town in a different tehsil (Vyasanagar, not Jajpur Sadar) — confirmed via
-- OSM/Nominatim research 2026-08-08. It has no row in `cities` yet. Centroid is the
-- verified OSM place node (node/2467312527, place=town), not a guess.
INSERT INTO cities (
  name, slug, state,
  centroid,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled
) VALUES (
  'Jajpur Road', 'jajpur-road', 'Odisha',
  ST_GeogFromText('SRID=4326;POINT(86.1226688 20.9587602)'),
  45, 'active', true, false
)
ON CONFLICT (slug) DO NOTHING;
```

- [ ] **Step 2: Run it against the dev DB**

```powershell
cd api
pnpm migrate
```
Expected output includes `ran: 087_add_jajpur_road_and_fix_gaps.sql` (this migration isn't finished yet — later tasks append to the same file before this is the final run, or run `pnpm migrate` again after each task; either works since `migrate.ts` skips already-applied filenames one at a time, but a single file that hasn't been recorded yet re-runs in full each time you `pnpm migrate` before it succeeds once — write all of Task 2–4's SQL into this one file before running it once, then verify).

- [ ] **Step 3: Verify the row**

```powershell
docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT id, name, slug, ST_Y(centroid::geometry) lat, ST_X(centroid::geometry) lng, is_rental_enabled FROM cities WHERE slug = 'jajpur-road';"
```
Expected: one row, `lat ≈ 20.9587602`, `lng ≈ 86.1226688`, `is_rental_enabled = t`.

*(Don't run this migration in isolation yet — continue to Task 3 and 4 first, since they add more statements to the same file, then run once at the end of Task 4.)*

---

### Task 3: Correct Angul's centroid and enable rental on all five cities

**Files:**
- Modify: `api/src/db/migrations/087_add_jajpur_road_and_fix_gaps.sql` (same file from Task 2, append below the INSERT)

Angul's centroid in `069_add_angul_jajpur_paradip.sql` (`85.1425, 20.8400`) is a rounded guess, off by ~4.7km from the verified OSM town-node coordinates found this session (`node/245691299`, place=town). Jajpur's guess (`86.3333, 20.8500`) was only ~600m off from its verified node (`node/245691345`) — correct it too while touching the row, since it's free.

- [ ] **Step 1: Append the corrections and the rental-enable flip**

```sql
-- Angul's centroid was a rounded guess (069_add_angul_jajpur_paradip.sql). Corrected
-- to the verified OSM town place-node (node/245691299) found via Nominatim 2026-08-08
-- — the old value was ~4.7km off, which matters now that rental (in-city pricing)
-- is turning on for this city.
UPDATE cities
SET centroid = ST_GeogFromText('SRID=4326;POINT(85.0973949 20.8382426)')
WHERE slug = 'angul';

-- Jajpur's centroid guess was already close (~600m off) but correcting it while
-- we're here — verified OSM town place-node (node/245691345).
UPDATE cities
SET centroid = ST_GeogFromText('SRID=4326;POINT(86.3385714 20.8522696)')
WHERE slug = 'jajpur';

-- The actual client ask: turn rental on for these five cities. Rate cards and
-- rental_packages already fall back to their city_id IS NULL global row (see
-- pricing.repository.ts), so no new rate-card rows are needed to get a working
-- rental price here — per-city tuning is a separate follow-up.
UPDATE cities
SET is_rental_enabled = true
WHERE slug IN ('angul', 'jajpur', 'jajpur-road', 'paradeep', 'puri');
```

- [ ] **Step 2: Verify**

```powershell
docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT slug, ST_Y(centroid::geometry) lat, ST_X(centroid::geometry) lng, is_rental_enabled FROM cities WHERE slug IN ('angul','jajpur','jajpur-road','paradeep','puri') ORDER BY slug;"
```
Expected: all five rows `is_rental_enabled = t`; `angul` lat/lng ≈ `20.8382426 / 85.0973949`; `jajpur` lat/lng ≈ `20.8522696 / 86.3385714`.

---

### Task 4: Interim circular boundaries for Angul and Jajpur Road

**Files:**
- Modify: `api/src/db/migrations/087_add_jajpur_road_and_fix_gaps.sql` (same file, append below Task 3's SQL)

Neither Angul nor Jajpur Road has a real OSM municipal-boundary polygon (confirmed by direct Nominatim queries this session — Angul returns only its district relation; Jajpur Road/Byasanagar returns only a bare `place=town` node, no polygon). `086_backfill_city_boundaries.sql` deliberately left both NULL for this reason. Use a 3km-radius buffer around the now-corrected centroid as a documented interim boundary — see Assumption 2 above for why 3km.

- [ ] **Step 1: Append the buffer boundaries**

```sql
-- TODO(interim-boundary): Angul has no OSM town/city-level administrative boundary
-- relation (only a too-coarse district one — confirmed via Nominatim 2026-08-08).
-- 3km-radius circle around the verified centroid stands in until someone does a
-- field survey or a real polygon becomes available in OSM. Ceiling: this is a
-- circle, not Angul's actual (irregular) town shape — it will both under- and
-- over-cover real neighborhoods. Upgrade path: replace with
-- `UPDATE cities SET boundary = ST_GeomFromGeoJSON(...) WHERE slug = 'angul'`
-- once a real polygon exists, same as 086 did for the other cities.
UPDATE cities
SET boundary = ST_Buffer(
  ST_SetSRID(ST_MakePoint(85.0973949, 20.8382426), 4326)::geography,
  3000
)::geometry
WHERE slug = 'angul';

-- TODO(interim-boundary): Jajpur Road (Byasanagar) has no OSM administrative
-- boundary relation at all (only a bare place node — confirmed via Nominatim
-- 2026-08-08). Same 3km-radius interim circle as Angul, same upgrade path.
UPDATE cities
SET boundary = ST_Buffer(
  ST_SetSRID(ST_MakePoint(86.1226688, 20.9587602), 4326)::geography,
  3000
)::geometry
WHERE slug = 'jajpur-road';
```

- [ ] **Step 2: Run the full migration file (Tasks 2-4 together)**

```powershell
cd api
pnpm migrate
```
Expected output includes `ran: 086_backfill_city_boundaries.sql` and `ran: 087_add_jajpur_road_and_fix_gaps.sql` (086 runs first alphabetically/numerically).

- [ ] **Step 3: Verify boundary geometry type and containment**

```powershell
docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT slug, GeometryType(boundary), ST_Contains(boundary, ST_SetSRID(ST_MakePoint(85.0973949, 20.8382426), 4326)) FROM cities WHERE slug IN ('angul','jajpur-road');"
```
Expected: `GeometryType = POLYGON` for both rows, `ST_Contains = t` for both (the centroid must fall inside its own buffer).

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/087_add_jajpur_road_and_fix_gaps.sql
git commit -m "feat: add Jajpur Road city, fix Angul/Jajpur centroids, enable rental in 5 cities"
```

---

## Part B — Phase 5: Rental Boundary Alert

Spec source: `docs/RIDE_TYPES_PLAN.md` lines 354-410 ("Rental City Boundary Enforcement"). Confirmed unimplemented this session (zero hits for `boundary_crossed` anywhere in `api/src`).

### Task 5: Redis key + TTL constant for the debounce

**Files:**
- Modify: `api/src/constants/redis-keys.ts`
- Modify: `api/src/constants/limits.ts`

- [ ] **Step 1: Add the key builder**

In `api/src/constants/redis-keys.ts`, append:

```typescript
export const rentalBoundaryAlertKey = (rideId: string): string =>
  `ride:rental_boundary_alert:${rideId}`
```

- [ ] **Step 2: Add the TTL constant**

In `api/src/constants/limits.ts`, append near `IN_CITY_MAX_TRIP_DISTANCE_METRES`:

```typescript
// Debounce for the rental-boundary-crossed alert (RIDE_TYPES_PLAN.md Phase 5) — one
// alert per ride per window even if the driver keeps crossing back and forth.
export const RENTAL_BOUNDARY_ALERT_TTL_SECONDS = 300
```

- [ ] **Step 3: Commit**

```bash
git add api/src/constants/redis-keys.ts api/src/constants/limits.ts
git commit -m "feat: add redis key and TTL constant for rental boundary alert"
```

---

### Task 6: Socket event helper

**Files:**
- Modify: `api/src/websocket/socket.server.ts`

Add a new `socketEvents` entry following the exact pattern of the existing ones (e.g. `sendStopAdded` at line 273).

- [ ] **Step 1: Add the helper**

Insert after the `sendStopAdded` entry (`api/src/websocket/socket.server.ts:273-275`):

```typescript
  sendRentalBoundaryAlert: (rideId: string, data: { cityName: string }) => {
    getIO().to(`ride:${rideId}`).emit('rental:boundary_crossed', data)
  },
```

- [ ] **Step 2: Commit**

```bash
git add api/src/websocket/socket.server.ts
git commit -m "feat: add sendRentalBoundaryAlert socket helper"
```

---

### Task 7: GPS-flush worker boundary check

**Files:**
- Modify: `api/src/jobs/workers/gps-flush.worker.ts`
- Test: `api/tests/unit/jobs/gps-flush-boundary-alert.test.ts`

The worker (`api/src/jobs/workers/gps-flush.worker.ts`) currently just inserts the GPS point. After the insert, for rides that are `ride_type = 'rental'` and `status = 'in_progress'`, check the point against `cities.boundary` via `origin_city_id`. If outside, debounce via the Redis key from Task 5, then emit the Task 6 socket event.

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/jobs/gps-flush-boundary-alert.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()
vi.mock('@/db/client', () => ({
  workerPool: { query: (...args: unknown[]) => queryMock(...args) },
}))

const redisSetMock = vi.fn()
vi.mock('@/db/redis', () => ({
  client: { set: (...args: unknown[]) => redisSetMock(...args) },
}))

const sendRentalBoundaryAlertMock = vi.fn()
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRentalBoundaryAlert: (...args: unknown[]) => sendRentalBoundaryAlertMock(...args) },
  getIO: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((_name, processor) => ({
    on: vi.fn(),
    __processor: processor,
  })),
}))

import { checkRentalBoundary } from '@/jobs/workers/gps-flush.worker'

describe('checkRentalBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing for a non-rental ride', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ ride_type: 'one_way', status: 'in_progress', origin_city_id: '1', city_name: 'Bhubaneswar' }],
    })
    await checkRentalBoundary('101', 20.5, 85.5)
    expect(sendRentalBoundaryAlertMock).not.toHaveBeenCalled()
  })

  it('does nothing when the point is inside the boundary', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ ride_type: 'rental', status: 'in_progress', origin_city_id: '1', city_name: 'Bhubaneswar' }],
    })
    queryMock.mockResolvedValueOnce({ rows: [{ is_inside: true }] })
    await checkRentalBoundary('101', 20.29, 85.82)
    expect(sendRentalBoundaryAlertMock).not.toHaveBeenCalled()
  })

  it('emits the alert once when outside the boundary, then debounces', async () => {
    queryMock.mockResolvedValue({
      rows: [{ ride_type: 'rental', status: 'in_progress', origin_city_id: '1', city_name: 'Bhubaneswar' }],
    })
    queryMock.mockResolvedValueOnce({
      rows: [{ ride_type: 'rental', status: 'in_progress', origin_city_id: '1', city_name: 'Bhubaneswar' }],
    })
    queryMock.mockResolvedValueOnce({ rows: [{ is_inside: false }] })
    redisSetMock.mockResolvedValueOnce('OK')

    await checkRentalBoundary('101', 21.0, 86.9)
    expect(sendRentalBoundaryAlertMock).toHaveBeenCalledWith('101', { cityName: 'Bhubaneswar' })

    redisSetMock.mockResolvedValueOnce(null)
    queryMock.mockResolvedValueOnce({
      rows: [{ ride_type: 'rental', status: 'in_progress', origin_city_id: '1', city_name: 'Bhubaneswar' }],
    })
    queryMock.mockResolvedValueOnce({ rows: [{ is_inside: false }] })
    await checkRentalBoundary('101', 21.01, 86.91)
    expect(sendRentalBoundaryAlertMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```powershell
cd api
npx vitest run tests/unit/jobs/gps-flush-boundary-alert.test.ts
```
Expected: FAIL — `checkRentalBoundary` is not exported from the worker file yet.

- [ ] **Step 3: Implement `checkRentalBoundary` and wire it into the worker**

Replace the full contents of `api/src/jobs/workers/gps-flush.worker.ts`:

```typescript
import { Worker } from 'bullmq'
import { workerPool as pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { createWorkerLogger } from '@/lib/worker-logger'
import { socketEvents } from '@/websocket/socket.server'
import { rentalBoundaryAlertKey } from '@/constants/redis-keys'
import { RENTAL_BOUNDARY_ALERT_TTL_SECONDS } from '@/constants/limits'

const log = createWorkerLogger('gps-flush')

interface GpsTrackJob {
  rideId: string
  driverId: string
  sessionId: string
  lat: number
  lng: number
  heading?: number
  speed?: number
  recordedAt: string
}

// RIDE_TYPES_PLAN.md Phase 5 — warns the rider once per debounce window when an
// in-progress rental's GPS ping falls outside the pickup city's boundary polygon.
// Alert only; does not block, cancel, or reprice the ride.
export async function checkRentalBoundary(rideId: string, lat: number, lng: number): Promise<void> {
  const rideRes = await pool.query<{
    ride_type: string
    status: string
    origin_city_id: string | null
    city_name: string | null
  }>(
    `SELECT r.ride_type, r.status, r.origin_city_id::text, c.name AS city_name
     FROM rides r
     LEFT JOIN cities c ON c.id = r.origin_city_id
     WHERE r.id = $1`,
    [BigInt(rideId)]
  )
  const ride = rideRes.rows[0]
  if (!ride || ride.ride_type !== 'rental' || ride.status !== 'in_progress' || !ride.origin_city_id) return

  const containsRes = await pool.query<{ is_inside: boolean }>(
    `SELECT (boundary IS NOT NULL AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326))) AS is_inside
     FROM cities WHERE id = $3`,
    [lat, lng, BigInt(ride.origin_city_id)]
  )
  if (containsRes.rows[0]?.is_inside !== false) return

  const debounceKey = rentalBoundaryAlertKey(rideId)
  const acquired = await redis.set(debounceKey, '1', 'EX', RENTAL_BOUNDARY_ALERT_TTL_SECONDS, 'NX')
  if (acquired !== 'OK') return

  socketEvents.sendRentalBoundaryAlert(rideId, { cityName: ride.city_name ?? 'the city' })
}

export const gpsFlushWorker = new Worker<GpsTrackJob>(
  QUEUE_NAMES.GPS_FLUSH,
  async (job) => {
    const { rideId, driverId, sessionId, lat, lng, heading, speed, recordedAt } = job.data
    await pool.query(
      `INSERT INTO gps_tracks
         (ride_id, driver_id, session_id, location, heading, speed_kmph, recorded_at)
       VALUES ($1, $2, $3,
         ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326)::geography,
         $6, $7, $8
       )
       ON CONFLICT DO NOTHING`,
      [
        BigInt(rideId),
        BigInt(driverId),
        BigInt(sessionId),
        lat,
        lng,
        heading ?? null,
        speed   ?? null,
        recordedAt,
      ]
    )
    await checkRentalBoundary(rideId, lat, lng)
  },
  {
    connection:  redisConnection,
    concurrency: 20,
    limiter:     { max: 500, duration: 1000 },
  }
)

gpsFlushWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'gps-flush job failed')
})
```

- [ ] **Step 4: Run the test to verify it passes**

```powershell
cd api
npx vitest run tests/unit/jobs/gps-flush-boundary-alert.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full unit suite to check nothing else broke**

```powershell
cd api
npx vitest run tests/unit
```
Expected: all tests pass (84+ from before, +3 new).

- [ ] **Step 6: Commit**

```bash
git add api/src/jobs/workers/gps-flush.worker.ts api/tests/unit/jobs/gps-flush-boundary-alert.test.ts
git commit -m "feat: emit rental:boundary_crossed alert when GPS leaves the rental city boundary"
```

---

### Task 8: User app — boundary-crossed banner on the ride tracking screen

**Files:**
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx`

Follow the exact same socket-listener + dismissible-banner pattern already used for `fareDrift` in this file (state at line 320, listener block at lines 452-604, banner JSX at lines 933-952).

- [ ] **Step 1: Add state**

Near `const [fareDrift, setFareDrift] = useState<...>(null)` (line 320), add:

```typescript
  const [boundaryAlert, setBoundaryAlert] = useState<{ cityName: string } | null>(null)
```

- [ ] **Step 2: Add the socket handler and registration**

Near `onChatMessage` (line 568), add:

```typescript
    const onBoundaryCrossed = (data: { cityName: string }) => {
      setBoundaryAlert(data)
    }
```

In the `socket.on(...)` block (after line 581):

```typescript
    socket.on('rental:boundary_crossed', onBoundaryCrossed)
```

In the corresponding `socket.off(...)` cleanup block (mirrors the `.on` block, a few lines below):

```typescript
    socket.off('rental:boundary_crossed', onBoundaryCrossed)
```

- [ ] **Step 3: Add the banner JSX**

Directly after the `fareDrift` banner block (`apps/user/app/(main)/ride/[id]/page.tsx:933-952`), add:

```typescript
              {boundaryAlert && (
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl mb-3"
                  style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
                >
                  <div>
                    <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide">Leaving rental zone</p>
                    <p className="text-[13px] font-bold text-amber-800">
                      Your driver has left {boundaryAlert.cityName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBoundaryAlert(null)}
                    className="text-[11px] font-semibold text-amber-700"
                  >
                    Dismiss
                  </button>
                </div>
              )}
```

- [ ] **Step 4: Typecheck**

```powershell
cd apps/user
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Manual verify**

Start the API (`cd api && pnpm dev`) and user app (`cd apps/user && pnpm dev`). With a rental ride in `in_progress` status, manually emit the event from a Node REPL or a temporary script using the same `getIO().to(...)` call to confirm the banner renders and dismisses. (No automated test — this is pure JSX wiring with no branching logic beyond what Task 7's unit tests already cover server-side.)

- [ ] **Step 6: Commit**

```bash
git add "apps/user/app/(main)/ride/[id]/page.tsx"
git commit -m "feat: show dismissible banner when driver leaves the rental city boundary"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1-4 cover the coordinate/boundary data gaps identified this session (Jajpur Road missing entirely, Angul's guessed centroid, Angul/Jajpur Road's missing boundaries, rental-enable flip). Task 5-8 cover all three steps of `RIDE_TYPES_PLAN.md` Phase 5 (migration/boundary already covered by Part A, so only 5.2 and 5.3 remained — the worker check and the frontend banner).
- **Placeholder scan:** No TBD/TODO-without-content — the two `TODO(interim-boundary)` comments are intentional, greppable markers for a known future upgrade, not unfinished work in this plan.
- **Type consistency:** `checkRentalBoundary(rideId: string, lat: number, lng: number)` signature is used consistently between the worker call site (Task 7 Step 3) and the test (Task 7 Step 1). `socketEvents.sendRentalBoundaryAlert(rideId, { cityName })` signature matches between Task 6's definition and Task 7's call site and the test's mock assertion.
