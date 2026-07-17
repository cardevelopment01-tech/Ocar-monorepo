# GPS Trip-Replay for Disputes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `gps_tracks` from a write-only table into a production-ready feature: automate its partition lifecycle (creation + 90-day retention purge) and surface an animated trip-replay view on the admin dispute detail panel.

**Architecture:** Two new BullMQ repeatable jobs (partition pre-creation, partition purge) reusing the existing `create_gps_partition()` SQL function and the existing job-queue infrastructure (`api/src/jobs/`). One new admin read endpoint (`GET /api/v1/admin/safety/disputes/:id/trip-replay`) that joins the dispute's ride coordinates (already fetched by `getDisputeById`) with a straight `gps_tracks` query and the existing `/geo/route` planned-route lookup. One new frontend component (`TripReplayMap`) reusing `@vis.gl/react-google-maps` primitives already used in `LiveMap.tsx`, wired into the existing dispute `SlideOver` (the `[id]/page.tsx` route is an orphaned stub with no links to it — left untouched, out of scope).

**Tech Stack:** Express + TypeScript, PostgreSQL/PostGIS (`pool.query`), BullMQ + Redis, Vitest, Next.js 16 App Router, `@vis.gl/react-google-maps`, lucide-react.

**Spec:** `docs/superpowers/specs/2026-07-17-gps-tracks-trip-replay-design.md`

---

### Task 1: Retention constant + new BullMQ queue

**Files:**
- Modify: `api/src/constants/limits.ts`
- Modify: `api/src/jobs/queues/index.ts`

- [ ] **Step 1: Add the retention constant**

In `api/src/constants/limits.ts`, add this line directly after the existing `export const GPS_ACCURACY_THRESHOLD_METRES = 50` line:

```typescript
export const GPS_TRAIL_RETENTION_DAYS = 90
```

- [ ] **Step 2: Register a new queue**

In `api/src/jobs/queues/index.ts`, add `PARTITION_MAINTENANCE` to the `QUEUE_NAMES` object (after `AUDIT: 'audit',`):

```typescript
export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  GPS_FLUSH: 'gps-flush',
  SETTLEMENTS: 'settlements',
  ANALYTICS: 'analytics',
  SCHEDULER: 'scheduler',
  CLEANUP: 'cleanup',
  AUDIT: 'audit',
  PARTITION_MAINTENANCE: 'partition-maintenance',
} as const
```

Then add the queue instance (after `export const auditQueue = new Queue(QUEUE_NAMES.AUDIT, { connection })`):

```typescript
export const partitionMaintenanceQueue = new Queue(QUEUE_NAMES.PARTITION_MAINTENANCE, { connection })
```

And add it to the `queues` map (after `[QUEUE_NAMES.AUDIT]: auditQueue,`):

```typescript
  [QUEUE_NAMES.PARTITION_MAINTENANCE]: partitionMaintenanceQueue,
```

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/constants/limits.ts api/src/jobs/queues/index.ts
git commit -m "feat: add gps_tracks retention constant and partition-maintenance queue"
```

---

### Task 2: Partition auto-creation processor + test

**Files:**
- Modify: `api/src/jobs/processors/partition-creator.processor.ts` (currently a one-line TODO stub)
- Test: `api/tests/unit/jobs/partition-creator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/jobs/partition-creator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getNextPartitionTarget } from '@/jobs/processors/partition-creator.processor'

describe('getNextPartitionTarget', () => {
  it('returns next month within the same year', () => {
    expect(getNextPartitionTarget(new Date('2026-07-17T00:00:00Z'))).toEqual({ year: 2026, month: 8 })
  })

  it('rolls over into January of the following year when called in December', () => {
    expect(getNextPartitionTarget(new Date('2026-12-15T00:00:00Z'))).toEqual({ year: 2027, month: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/jobs/partition-creator.test.ts`
Expected: FAIL — `getNextPartitionTarget` is not exported (the file is still the TODO stub).

- [ ] **Step 3: Implement the processor**

Replace the full contents of `api/src/jobs/processors/partition-creator.processor.ts` with:

```typescript
import { pool } from '@/db/client'

// Computes which month's gps_tracks partition to pre-create, one month
// ahead of "now" — e.g. called in July, creates August's partition.
export function getNextPartitionTarget(now: Date): { year: number; month: number } {
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { year: target.getUTCFullYear(), month: target.getUTCMonth() + 1 }
}

// Calls the create_gps_partition() SQL function (defined in
// 005_m3_geo.sql, idempotent via CREATE TABLE IF NOT EXISTS) for next
// month's gps_tracks partition. Fixes the audit finding that this
// function existed but was never called from application code — inserts
// would silently start failing once the migration's initial 4
// pre-created partitions ran out.
export async function processCreateNextPartition(): Promise<void> {
  const { year, month } = getNextPartitionTarget(new Date())
  await pool.query('SELECT create_gps_partition($1, $2)', [year, month])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/jobs/partition-creator.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/jobs/processors/partition-creator.processor.ts api/tests/unit/jobs/partition-creator.test.ts
git commit -m "feat: implement gps_tracks partition auto-creation processor"
```

---

### Task 3: Partition purge processor + test

**Files:**
- Create: `api/src/jobs/processors/partition-purge.processor.ts`
- Test: `api/tests/unit/jobs/partition-purge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/jobs/partition-purge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { selectPartitionsToPurge } from '@/jobs/processors/partition-purge.processor'

describe('selectPartitionsToPurge', () => {
  it('selects only partitions fully older than the retention window', () => {
    const now = new Date('2026-07-17T00:00:00Z')
    const names = ['gps_tracks_2026_07', 'gps_tracks_2026_01', 'gps_tracks_2025_06']
    const result = selectPartitionsToPurge(names, now, 90)
    expect(result).toEqual(['gps_tracks_2026_01', 'gps_tracks_2025_06'])
  })

  it('purges nothing when every partition is within the retention window', () => {
    const now = new Date('2026-07-17T00:00:00Z')
    const result = selectPartitionsToPurge(['gps_tracks_2026_07', 'gps_tracks_2026_06'], now, 90)
    expect(result).toEqual([])
  })

  it('ignores table names that are not gps_tracks partitions', () => {
    const now = new Date('2026-07-17T00:00:00Z')
    const result = selectPartitionsToPurge(['gps_tracks_2020_01', 'unrelated_table'], now, 90)
    expect(result).toEqual(['gps_tracks_2020_01'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/jobs/partition-purge.test.ts`
Expected: FAIL — cannot find module `@/jobs/processors/partition-purge.processor` (file doesn't exist yet).

- [ ] **Step 3: Implement the processor**

Create `api/src/jobs/processors/partition-purge.processor.ts`:

```typescript
import { pool } from '@/db/client'
import { GPS_TRAIL_RETENTION_DAYS } from '@/constants/limits'

const PARTITION_NAME_RE = /^gps_tracks_(\d{4})_(\d{2})$/

// A partition is eligible for purge only once its FULL date range is
// older than the retention window — i.e. the start of the month AFTER
// the partition (its upper bound) has already passed the cutoff.
export function selectPartitionsToPurge(
  partitionNames: string[],
  now: Date,
  retentionDays: number
): string[] {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  return partitionNames.filter((name) => {
    const match = PARTITION_NAME_RE.exec(name)
    if (!match) return false
    const year = Number(match[1])
    const month = Number(match[2])
    const partitionEnd = new Date(Date.UTC(year, month, 1))
    return partitionEnd <= cutoff
  })
}

// Drops gps_tracks partitions older than GPS_TRAIL_RETENTION_DAYS.
// Reads the partition list from information_schema rather than a
// hardcoded list, so it can't drift out of sync with what's actually
// in the database. Implements the retention policy ADR-003 specified
// but never built — DROP TABLE is a metadata-only operation, unlike a
// DELETE over the same row volume (see ADR-003 for the benchmark).
export async function processPurgeOldPartitions(): Promise<void> {
  const res = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name ~ '^gps_tracks_[0-9]{4}_[0-9]{2}$'`
  )
  const partitionNames = res.rows.map((r) => r.table_name)
  const toPurge = selectPartitionsToPurge(partitionNames, new Date(), GPS_TRAIL_RETENTION_DAYS)

  for (const name of toPurge) {
    // Defense in depth: re-validate immediately before building DDL from
    // a string, even though `name` already came from a regex-filtered
    // system catalog query, not user input.
    if (!PARTITION_NAME_RE.test(name)) continue
    await pool.query(`DROP TABLE IF EXISTS ${name}`)
    console.log(`[gps-partition-purge] dropped ${name} (older than ${GPS_TRAIL_RETENTION_DAYS} days)`)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/jobs/partition-purge.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/jobs/processors/partition-purge.processor.ts api/tests/unit/jobs/partition-purge.test.ts
git commit -m "feat: implement gps_tracks retention purge processor"
```

---

### Task 4: Wire both jobs into a worker + monthly schedule

**Files:**
- Create: `api/src/jobs/workers/partition-maintenance.worker.ts`
- Modify: `api/src/server.ts`

- [ ] **Step 1: Create the worker**

Create `api/src/jobs/workers/partition-maintenance.worker.ts`:

```typescript
import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { processCreateNextPartition } from '@/jobs/processors/partition-creator.processor'
import { processPurgeOldPartitions } from '@/jobs/processors/partition-purge.processor'

// Two job types share this queue, both scheduled monthly from server.ts:
//  - 'create_next_partition' — pre-creates next month's gps_tracks partition
//  - 'purge_old_partitions'  — drops gps_tracks partitions past the retention window
export const partitionMaintenanceWorker = new Worker(
  QUEUE_NAMES.PARTITION_MAINTENANCE,
  async (job) => {
    if (job.name === 'create_next_partition') {
      await processCreateNextPartition()
      return
    }
    if (job.name === 'purge_old_partitions') {
      await processPurgeOldPartitions()
    }
  },
  { connection: redisConnection }
)

partitionMaintenanceWorker.on('failed', (job, err) => {
  console.error(`[partition-maintenance] job ${job?.id} (${job?.name}) failed:`, err)
})
```

- [ ] **Step 2: Wire it into server.ts**

In `api/src/server.ts`, add the import after `import { auditWorker } from './jobs/workers/audit.worker'`:

```typescript
import { partitionMaintenanceWorker } from './jobs/workers/partition-maintenance.worker'
```

Change the queues import line from:

```typescript
import { cleanupQueue, schedulerQueue } from './jobs/queues'
```

to:

```typescript
import { cleanupQueue, schedulerQueue, partitionMaintenanceQueue } from './jobs/queues'
```

Add this block after the existing `await schedulerQueue.add(...)` call (after line 53, before `httpServer.listen(...)`):

```typescript
  void partitionMaintenanceWorker
  console.log('[Worker] Partition maintenance worker started')
  // Runs on the 25th of each month (same convention ADR-003 specified),
  // ahead of month-end so next month's partition exists before it's needed.
  await partitionMaintenanceQueue.add(
    'create_next_partition',
    {},
    { repeat: { pattern: '0 3 25 * *' }, removeOnComplete: true, removeOnFail: true }
  )
  // Runs 30 minutes later, same day — purge after creation, never before.
  await partitionMaintenanceQueue.add(
    'purge_old_partitions',
    {},
    { repeat: { pattern: '30 3 25 * *' }, removeOnComplete: true, removeOnFail: true }
  )
```

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual smoke test**

Run: `cd api && pnpm dev`
Expected console output includes `[Worker] Partition maintenance worker started` with no errors, and the process stays up (confirms the two `queue.add` calls with cron `pattern` syntax are accepted by BullMQ/Redis without throwing).

- [ ] **Step 5: Commit**

```bash
git add api/src/jobs/workers/partition-maintenance.worker.ts api/src/server.ts
git commit -m "feat: schedule monthly gps_tracks partition create + purge jobs"
```

---

### Task 5: Backend trip-replay read path

**Files:**
- Modify: `api/src/modules/safety/safety.repository.ts`
- Modify: `api/src/modules/safety/disputes.service.ts`
- Modify: `api/src/modules/admin/admin.controller.ts`
- Modify: `api/src/modules/admin/admin.routes.ts`
- Modify: `api/tests/integration/m09.test.ts` (roadmap marker only)

- [ ] **Step 1: Extend `getDisputeById` to include ride coordinates**

In `api/src/modules/safety/safety.repository.ts`, replace the `getDisputeById` function (lines 299-315) with:

```typescript
export async function getDisputeById(id: bigint) {
  const res = await pool.query(
    `SELECT d.*,
            r.origin_address, r.destination_address,
            r.origin_lat::float8      AS origin_lat,
            r.origin_lng::float8      AS origin_lng,
            r.destination_lat::float8 AS destination_lat,
            r.destination_lng::float8 AS destination_lng,
            u.name       AS user_name,   u.phone AS user_phone,
            dr.full_name AS driver_name, dr.phone AS driver_phone,
            a.email      AS assigned_to_email
     FROM disputes d
     JOIN rides r    ON r.id   = d.ride_id
     LEFT JOIN users   u  ON u.id   = d.initiated_by_user
     LEFT JOIN drivers dr ON dr.id  = d.initiated_by_driver
     LEFT JOIN admins  a  ON a.id   = d.assigned_to
     WHERE d.id = $1`,
    [id]
  )
  return res.rows[0] ?? null
}
```

- [ ] **Step 2: Add the GPS trail query**

In the same file (`api/src/modules/safety/safety.repository.ts`), add this function directly after `getDisputeById`:

```typescript
export async function getGpsTrailForRide(rideId: bigint) {
  const res = await pool.query<{
    lat: number
    lng: number
    recorded_at: string
    speed_kmph: number | null
    heading: number | null
  }>(
    `SELECT
       ST_Y(location::geometry)  AS lat,
       ST_X(location::geometry)  AS lng,
       recorded_at,
       speed_kmph::float8 AS speed_kmph,
       heading::float8    AS heading
     FROM gps_tracks
     WHERE ride_id = $1
     ORDER BY recorded_at ASC`,
    [rideId]
  )
  return res.rows
}
```

- [ ] **Step 3: Add the orchestration function**

In `api/src/modules/safety/disputes.service.ts`, add this import after the existing `import type { CreateDisputeInput, ResolveDisputeInput } from './safety.types'` line:

```typescript
import * as geoService from '@/modules/geo/geo.service'
```

Then add this function at the end of the file:

```typescript
export async function getTripReplay(id: bigint) {
  const dispute = await repo.getDisputeById(id)
  if (!dispute) throw Object.assign(new Error('Dispute not found'), { httpStatus: 404 })

  const actualTrail = await repo.getGpsTrailForRide(dispute.ride_id)

  let plannedRoute: { polyline: string } | null = null
  if (
    dispute.origin_lat != null && dispute.origin_lng != null &&
    dispute.destination_lat != null && dispute.destination_lng != null
  ) {
    try {
      const route = await geoService.getRoute(
        dispute.origin_lat, dispute.origin_lng,
        dispute.destination_lat, dispute.destination_lng
      )
      plannedRoute = { polyline: route.polyline }
    } catch {
      // Planned-route overlay is a nice-to-have on top of the actual trail —
      // a Google Directions API failure shouldn't block replay of the trail itself.
      plannedRoute = null
    }
  }

  return { actualTrail, plannedRoute }
}
```

- [ ] **Step 4: Add the controller**

In `api/src/modules/admin/admin.controller.ts`, add this function directly after `getAdminDispute` (after line 354):

```typescript
export async function getAdminDisputeTripReplay(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await disputeService.getTripReplay(BigInt(req.params['id']!)))
  } catch (err) { next(err) }
}
```

- [ ] **Step 5: Add the route**

In `api/src/modules/admin/admin.routes.ts`, add this line directly after `router.get('/safety/disputes/:id', controller.getAdminDispute)` (after line 80):

```typescript
router.get('/safety/disputes/:id/trip-replay', controller.getAdminDisputeTripReplay)
```

- [ ] **Step 6: Add a roadmap marker in the integration test file**

In `api/tests/integration/m09.test.ts`, add this line after the existing `it.todo('TC-M09-007: dispute resolution applies fare adjustment')` line:

```typescript
it.todo('TC-M09-008: dispute trip-replay returns actual GPS trail and planned route')
```

- [ ] **Step 7: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Manual verification**

Run: `cd api && pnpm dev`, then with a valid admin JWT and an existing dispute id:

```bash
curl -H "Authorization: Bearer <admin-token>" http://localhost:<API_PORT>/api/v1/admin/safety/disputes/<dispute-id>/trip-replay
```

Expected: `200` with `{ "actualTrail": [...], "plannedRoute": { "polyline": "..." } | null }`. An `actualTrail: []` response for a dispute whose ride has no GPS pings is correct, not an error.

- [ ] **Step 9: Commit**

```bash
git add api/src/modules/safety/safety.repository.ts api/src/modules/safety/disputes.service.ts api/src/modules/admin/admin.controller.ts api/src/modules/admin/admin.routes.ts api/tests/integration/m09.test.ts
git commit -m "feat: add dispute trip-replay endpoint reading from gps_tracks"
```

---

### Task 6: Shared polyline decoder (extract from LiveMap)

**Files:**
- Create: `apps/admin/lib/polyline.ts`
- Modify: `apps/admin/components/LiveMap.tsx`

- [ ] **Step 1: Extract the decoder**

Create `apps/admin/lib/polyline.ts`:

```typescript
// Decodes a Google-encoded polyline string into [lat, lng] pairs.
// Shared by LiveMap.tsx (planned route for an on-trip driver) and
// TripReplayMap.tsx (planned + actual route for a dispute).
export function decodePolyline(encoded: string): [number, number][] {
  const pts: [number, number][] = []
  let i = 0, lat = 0, lng = 0
  while (i < encoded.length) {
    let b, shift = 0, result = 0
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0; result = 0
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    pts.push([lat / 1e5, lng / 1e5])
  }
  return pts
}
```

- [ ] **Step 2: Update LiveMap.tsx to import it**

In `apps/admin/components/LiveMap.tsx`, replace the local `function decodePolyline(...)` definition (lines 22-35) with nothing (delete those lines), and add this import after the existing `import api from '@/lib/api'` line:

```typescript
import { decodePolyline } from '@/lib/polyline'
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors — `decodePolyline` is still used at line ~156 in `LiveMap.tsx`, now via import instead of local definition.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/lib/polyline.ts apps/admin/components/LiveMap.tsx
git commit -m "refactor: extract decodePolyline into a shared util"
```

---

### Task 7: Frontend — trip-replay API client + types

**Files:**
- Modify: `apps/admin/lib/safety-api.ts`

- [ ] **Step 1: Add types and the API method**

In `apps/admin/lib/safety-api.ts`, add these types after the existing `Dispute` type (after the closing `}` on line 55):

```typescript
export type GpsTrailPoint = {
  lat: number
  lng: number
  recorded_at: string
  speed_kmph: number | null
  heading: number | null
}

export type TripReplay = {
  actualTrail: GpsTrailPoint[]
  plannedRoute: { polyline: string } | null
}
```

Then add this method inside the `safetyApi` object, after `resolveDispute`:

```typescript
  getTripReplay: (disputeId: string) =>
    api.get<TripReplay>(`/api/v1/admin/safety/disputes/${disputeId}/trip-replay`).then(r => r.data),
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/lib/safety-api.ts
git commit -m "feat: add trip-replay API client to safety-api"
```

---

### Task 8: Frontend — TripReplayMap component

**Files:**
- Create: `apps/admin/components/TripReplayMap.tsx`

- [ ] **Step 1: Create the component**

Create `apps/admin/components/TripReplayMap.tsx`:

```tsx
'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Map as GoogleMap, AdvancedMarker, Polyline } from '@vis.gl/react-google-maps'
import { Play, Pause } from 'lucide-react'
import { safetyApi, type TripReplay } from '@/lib/safety-api'
import { decodePolyline } from '@/lib/polyline'

const DEFAULT_ZOOM = 14
const STEP_MS = 400 // playback speed: ms of real time per GPS ping advanced
const FALLBACK_CENTER = { lat: 20.2961, lng: 85.8245 } // Bhubaneswar

export default function TripReplayMap({ disputeId }: { disputeId: string }) {
  const [replay, setReplay] = useState<TripReplay | null>(null)
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    setLoading(true)
    setReplay(null)
    setIndex(0)
    setPlaying(false)
    safetyApi.getTripReplay(disputeId)
      .then(setReplay)
      .catch(() => setReplay({ actualTrail: [], plannedRoute: null }))
      .finally(() => setLoading(false))
  }, [disputeId])

  const trail = replay?.actualTrail ?? []

  useEffect(() => {
    if (!playing || trail.length === 0) return
    timerRef.current = setInterval(() => {
      setIndex((i) => {
        if (i >= trail.length - 1) {
          setPlaying(false)
          return i
        }
        return i + 1
      })
    }, STEP_MS)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [playing, trail.length])

  const actualPath = useMemo(
    () => trail.map((p) => ({ lat: p.lat, lng: p.lng })),
    [trail]
  )

  const plannedPath = useMemo(
    () => replay?.plannedRoute
      ? decodePolyline(replay.plannedRoute.polyline).map(([lat, lng]) => ({ lat, lng }))
      : null,
    [replay]
  )

  const current = trail[index]
  const center = current ? { lat: current.lat, lng: current.lng } : (actualPath[0] ?? FALLBACK_CENTER)

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center text-sm text-text-muted bg-surface-2 rounded-xl border border-border-light">
        Loading trail…
      </div>
    )
  }

  if (trail.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-sm text-text-muted bg-surface-2 rounded-xl border border-border-light">
        No GPS trail available for this ride
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="h-64 rounded-xl overflow-hidden border border-border-light">
        <GoogleMap
          defaultCenter={center}
          center={center}
          defaultZoom={DEFAULT_ZOOM}
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
          gestureHandling="greedy"
          disableDefaultUI
          style={{ width: '100%', height: '100%' }}
        >
          {plannedPath && plannedPath.length >= 2 && (
            <Polyline path={plannedPath} strokeColor="#9CA3AF" strokeWeight={4} strokeOpacity={0.8} zIndex={1} />
          )}
          {actualPath.length >= 2 && (
            <Polyline path={actualPath} strokeColor="#4F46E5" strokeWeight={4} strokeOpacity={0.95} zIndex={2} />
          )}
          <AdvancedMarker position={center}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              background: '#4F46E5', border: '2.5px solid #ffffff',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }} />
          </AdvancedMarker>
        </GoogleMap>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => { if (index >= trail.length - 1) setIndex(0); setPlaying((p) => !p) }}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-primary text-white hover:bg-primary-dark transition-colors flex-shrink-0"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <input
          type="range"
          min={0}
          max={trail.length - 1}
          value={index}
          onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)) }}
          className="flex-1"
        />
        <span className="text-xs text-text-muted flex-shrink-0 w-16 text-right">
          {current ? new Date(current.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}
        </span>
      </div>

      <p className="text-[11px] text-text-muted flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#4F46E5' }} /> Actual path
        {plannedPath && (
          <>
            <span className="inline-block w-2 h-2 rounded-full ml-3" style={{ background: '#9CA3AF' }} /> Planned route
          </>
        )}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/components/TripReplayMap.tsx
git commit -m "feat: add TripReplayMap animated playback component"
```

---

### Task 9: Wire TripReplayMap into the dispute SlideOver

**Files:**
- Modify: `apps/admin/app/(dashboard)/disputes/page.tsx`

- [ ] **Step 1: Import the component**

In `apps/admin/app/(dashboard)/disputes/page.tsx`, add this import after the existing `import ConfirmDialog from '@/components/ui/ConfirmDialog'` line:

```typescript
import TripReplayMap from '@/components/TripReplayMap'
```

- [ ] **Step 2: Render it in the SlideOver**

In the same file, insert this block directly after the closing `</div>` of the "Ride" card (after line 282, before the `<div>` that starts the "Description" section on line 284):

```tsx
            <TripReplayMap disputeId={selected.id} />

```

- [ ] **Step 3: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual UI verification**

Run: `cd apps/admin && pnpm dev`, log in as an admin, open the Disputes page, click a dispute row to open the SlideOver.

Expected:
- If the ride has GPS pings: a map renders inside the SlideOver between the "Ride" card and "Description", showing the actual path (indigo) and planned route (grey) as polylines, with a play/pause button and scrubber below it. Pressing play animates the marker along the trail and the scrubber advances; dragging the scrubber jumps to that point and pauses.
- If the ride has no GPS pings (e.g. a very old or very short ride): "No GPS trail available for this ride" renders instead, no map, no crash.

- [ ] **Step 5: Commit**

```bash
git add "apps/admin/app/(dashboard)/disputes/page.tsx"
git commit -m "feat: show trip-replay map in the dispute detail slide-over"
```

---

## Post-implementation checklist

- [ ] `cd api && npx tsc --noEmit` — clean
- [ ] `cd api && pnpm test` — all unit tests pass (including the 5 new ones from Tasks 2-3)
- [ ] `cd apps/admin && npx tsc --noEmit` — clean
- [ ] Manual verification steps from Tasks 4, 5, and 9 all confirmed
- [ ] Update `CLAUDE.md`'s Module Build State / Known UI Caveats sections if this closes any listed caveat (it doesn't — disputes was already listed live; this is an enhancement, not a new module)
