# Admin Manual Driver Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin manually assign a specific driver to any not-yet-accepted ride (`scheduled`, `requested`, or `no_drivers`), either as a request the driver can accept/decline or as an immediate force-assign, reusing the existing broadcast/accept infrastructure wherever possible.

**Architecture:** One new admin endpoint (`POST /admin/rides/:id/assign`) drives two paths through the existing `rides.service.ts`/`rides.repository.ts` layer: "request" mode creates one `ride_assignments` row exactly like broadcast does (reusing the driver's existing accept flow unchanged) plus a delayed fallback broadcast job that safely no-ops if the manual offer was accepted; "force" mode reuses the existing `acceptAssignment` CAS directly, with a new delayed grace-period job that reverts the ride if the driver shows no GPS activity in time. A second read endpoint (`GET /admin/rides/:id/assign-candidates`) feeds the admin driver-picker UI.

**Tech Stack:** Express + TypeScript + `pg` (raw SQL), BullMQ, Socket.io, Next.js 16 admin app (Tailwind + framer-motion), Vite/React driver app.

**Spec:** `docs/superpowers/specs/2026-08-09-admin-manual-driver-assignment-design.md`

---

## File Structure

- **Modify** `api/src/db/migrations/086_manual_driver_assignment.sql` (new) — one nullable column on `rides`.
- **Modify** `api/src/constants/limits.ts` — two new timing constants.
- **Modify** `api/src/modules/rides/rides.types.ts` — new `AssignCandidate` type.
- **Modify** `api/src/modules/rides/rides.repository.ts` — new query/mutation functions (eligibility lookup, grace-job bookkeeping, revert).
- **Create** `api/src/modules/rides/rides.repository.assign.test.ts` — unit tests for the new repository functions.
- **Modify** `api/src/modules/rides/rides.service.ts` — `getRideAssignCandidates`, `adminAssignDriver`, `forceAssignGraceCheck`.
- **Create** `api/src/jobs/processors/force-assign-grace.processor.ts` — grace-period revert job processor.
- **Modify** `api/src/jobs/workers/dispatch.worker.ts` — route the new job name.
- **Modify** `api/src/modules/admin/admin.routes.ts`, `admin.controller.ts`, `admin.service.ts` — two new endpoints, thin delegation (same pattern as `force-resolve`).
- **Modify** `apps/admin/lib/admin-api.ts` — `AssignCandidate` type + two new `adminRideApi` methods.
- **Modify** `apps/admin/app/(dashboard)/rides/page.tsx` — "Assign" button on unassigned rows + drawer wiring.
- **Create** `apps/admin/app/(dashboard)/rides/AssignDriverDrawer.tsx` — the driver-picker slide-over.
- **Modify** `apps/driver/src/App.tsx` — pass `assignedByOps`/longer timeout through to the request card.
- **Modify** `apps/driver/src/components/ui/TripRequestCard.tsx` — "Assigned by Ops" info pill.

---

### Task 1: Migration — grace-period job tracking column

**Files:**
- Create: `api/src/db/migrations/086_manual_driver_assignment.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 086_manual_driver_assignment.sql
-- Tracks the BullMQ job id for a force-assign's grace-period revert check
-- (see docs/superpowers/specs/2026-08-09-admin-manual-driver-assignment-design.md).
-- Nullable/no default: only set while a force-assigned ride's grace window is open.
ALTER TABLE rides ADD COLUMN force_assign_grace_job_id TEXT NULL;
```

- [ ] **Step 2: Run the migration locally**

Run: `cd api && pnpm migrate`
Expected: output includes `086_manual_driver_assignment.sql` applied, no errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/db/migrations/086_manual_driver_assignment.sql
git commit -m "feat(rides): add force_assign_grace_job_id column"
```

---

### Task 2: Constants

**Files:**
- Modify: `api/src/constants/limits.ts:17` (after `BROADCAST_ROUND_MAX`)

- [ ] **Step 1: Add the two new constants**

```typescript
export const BROADCAST_WINDOW_SECONDS = 20
export const BROADCAST_MAX_DRIVERS = 5
export const BROADCAST_ROUND_MAX = 3
// Admin manual-assign: longer than a broadcast ping since the driver was
// deliberately picked and deserves a beat to check the trip before responding.
export const MANUAL_ASSIGN_REQUEST_TIMEOUT_SECONDS = 30
// How long a force-assigned (no accept step) driver has to show GPS activity
// before the ride auto-reverts to unassigned and flags the admin.
export const FORCE_ASSIGN_GRACE_MINUTES = 4
```

- [ ] **Step 2: Commit**

```bash
git add api/src/constants/limits.ts
git commit -m "feat(rides): add manual-assign timing constants"
```

---

### Task 3: `AssignCandidate` type

**Files:**
- Modify: `api/src/modules/rides/rides.types.ts` (append at end of file)

- [ ] **Step 1: Add the type**

```typescript
// One row per driver in a ride's city, for the admin manual-assignment picker.
// `eligible` mirrors the same gates findNearbyDrivers() encodes for broadcast,
// minus the geo-radius check (admin is intentionally picking outside auto-match range).
export interface AssignCandidate {
  driver_id: string
  driver_name: string
  driver_phone: string
  session_id: string | null
  category_id: string | null
  category_name: string | null
  is_online: boolean
  category_ok: boolean
  wallet_ok: boolean
  distance_metres: number | null
  eligible: boolean
}
```

- [ ] **Step 2: Commit**

```bash
git add api/src/modules/rides/rides.types.ts
git commit -m "feat(rides): add AssignCandidate type"
```

---

### Task 4: Repository functions

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts` (append new functions after `cancelAllAssignments`, around line 910)
- Test: `api/src/modules/rides/rides.repository.assign.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockConnect = vi.fn()
vi.mock('@/db/client', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}))

import {
  getCityBillingMode,
  hasRideGpsActivity,
  getAssignCandidates,
  setForceAssignGraceJob,
  clearForceAssignGraceJob,
  revertForceAssign,
} from './rides.repository'

describe('getCityBillingMode', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('returns the billing_mode for a known city', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ billing_mode: 'commission' }] })
    const result = await getCityBillingMode(1n)
    expect(result).toBe('commission')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM cities'), [1n])
  })

  it('throws a 404-shaped error when the city does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await expect(getCityBillingMode(999n)).rejects.toMatchObject({ httpStatus: 404 })
  })
})

describe('hasRideGpsActivity', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('returns true when gps_tracks has a row for the ride', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] })
    const result = await hasRideGpsActivity(42n)
    expect(result).toBe(true)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM gps_tracks'), [42n])
  })

  it('returns false when there are no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] })
    const result = await hasRideGpsActivity(42n)
    expect(result).toBe(false)
  })
})

describe('getAssignCandidates', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('marks eligible = true only when online, category_ok, and wallet_ok all hold', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { driver_id: '1', driver_name: 'A', driver_phone: '111', session_id: '10', category_id: '2', category_name: 'Sedan', is_online: true, category_ok: true, wallet_ok: true, distance_metres: 1200 },
        { driver_id: '2', driver_name: 'B', driver_phone: '222', session_id: null, category_id: null, category_name: null, is_online: false, category_ok: true, wallet_ok: true, distance_metres: null },
        { driver_id: '3', driver_name: 'C', driver_phone: '333', session_id: '11', category_id: '3', category_name: 'SUV', is_online: true, category_ok: false, wallet_ok: true, distance_metres: 5000 },
      ],
    })

    const result = await getAssignCandidates({
      cityId: 1n, rideLat: 20.29, rideLng: 85.82, categoryIds: [2n], minWalletBalance: 500,
    })

    expect(result.map(r => r.eligible)).toEqual([true, false, false])
  })
})

describe('setForceAssignGraceJob / clearForceAssignGraceJob', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('sets the job id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await setForceAssignGraceJob(5n, 'job-123')
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('force_assign_grace_job_id = $2'), [5n, 'job-123'])
  })

  it('clears the job id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await clearForceAssignGraceJob(5n)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('force_assign_grace_job_id = NULL'), [5n])
  })
})

describe('revertForceAssign', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockConnect.mockReset()
  })

  it('returns false and rolls back when the ride is no longer accepted by that driver', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // UPDATE ... RETURNING id (no match)
        .mockResolvedValueOnce({}), // ROLLBACK
      release: vi.fn(),
    }
    mockConnect.mockResolvedValueOnce(client)

    const result = await revertForceAssign(5n, 9n)

    expect(result).toBe(false)
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('reverts the ride and driver session, then commits', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: '5' }] }) // UPDATE rides
        .mockResolvedValueOnce({}) // UPDATE driver_sessions
        .mockResolvedValueOnce({}) // UPDATE driver_location_snapshots
        .mockResolvedValueOnce({}), // COMMIT
      release: vi.fn(),
    }
    mockConnect.mockResolvedValueOnce(client)

    const result = await revertForceAssign(5n, 9n)

    expect(result).toBe(true)
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run src/modules/rides/rides.repository.assign.test.ts`
Expected: FAIL — `getCityBillingMode` (and the rest) are not exported from `./rides.repository`.

- [ ] **Step 3: Implement the repository functions**

Append to `api/src/modules/rides/rides.repository.ts` (after `cancelAllAssignments`):

```typescript
export async function getCityBillingMode(cityId: bigint): Promise<BillingMode> {
  const res = await pool.query<{ billing_mode: BillingMode }>(
    `SELECT billing_mode FROM cities WHERE id = $1`,
    [cityId]
  )
  if (!res.rows.length) {
    throw Object.assign(new Error('City not found'), { httpStatus: 404 })
  }
  return res.rows[0]!.billing_mode
}

export async function hasRideGpsActivity(rideId: bigint): Promise<boolean> {
  const res = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM gps_tracks WHERE ride_id = $1) AS exists`,
    [rideId]
  )
  return res.rows[0]?.exists ?? false
}

// Every driver in the ride's city, eligible or not — the admin picker shows
// ineligible drivers greyed out with a reason rather than hiding them.
// Mirrors the same gates findNearbyDrivers() uses for broadcast, minus the
// geo-radius cutoff (admin is intentionally picking outside auto-match range).
export async function getAssignCandidates(params: {
  cityId: bigint
  rideLat: number
  rideLng: number
  categoryIds: bigint[]
  minWalletBalance: number
}): Promise<AssignCandidate[]> {
  const res = await pool.query<Omit<AssignCandidate, 'eligible'>>(
    `SELECT
       d.id::text AS driver_id,
       d.full_name AS driver_name,
       d.phone AS driver_phone,
       ds.id::text AS session_id,
       ds.category_id::text AS category_id,
       vc.display_name AS category_name,
       (ds.id IS NOT NULL AND ds.status = 'online' AND ds.mode = 'standard') AS is_online,
       (ds.category_id = ANY($4::bigint[])) AS category_ok,
       COALESCE(
         (dc.billing_mode = 'commission' AND COALESCE(dw.balance, 0) >= $5 AND NOT COALESCE(dw.is_frozen, false))
         OR
         (dc.billing_mode = 'package' AND COALESCE(dpw.balance, 0) > 0 AND NOT COALESCE(dpw.is_frozen, false)),
         false
       ) AS wallet_ok,
       CASE WHEN dls.location IS NOT NULL THEN
         ST_Distance(
           dls.location,
           ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography
         )
       ELSE NULL END AS distance_metres
     FROM drivers d
     JOIN cities dc ON dc.id = d.city_id AND dc.status = 'active'
     LEFT JOIN driver_sessions ds ON ds.driver_id = d.id AND ds.status = 'online'
     LEFT JOIN driver_location_snapshots dls ON dls.session_id = ds.id
     LEFT JOIN vehicle_categories vc ON vc.id = ds.category_id
     LEFT JOIN driver_wallets dw ON dw.driver_id = d.id
     LEFT JOIN driver_package_wallets dpw ON dpw.driver_id = d.id
     WHERE d.city_id = $1
     ORDER BY distance_metres ASC NULLS LAST, d.full_name ASC
     LIMIT 50`,
    [params.cityId, params.rideLat, params.rideLng, params.categoryIds, params.minWalletBalance]
  )
  return res.rows.map(r => ({ ...r, eligible: r.is_online && r.category_ok && r.wallet_ok }))
}

export async function setForceAssignGraceJob(rideId: bigint, jobId: string): Promise<void> {
  await pool.query(`UPDATE rides SET force_assign_grace_job_id = $2 WHERE id = $1`, [rideId, jobId])
}

export async function clearForceAssignGraceJob(rideId: bigint): Promise<void> {
  await pool.query(`UPDATE rides SET force_assign_grace_job_id = NULL WHERE id = $1`, [rideId])
}

// Reverts a force-assigned ride back to unassigned if the driver never showed
// activity within the grace window. CAS on (driver_id, status='accepted') so
// a ride that already progressed (driver_arrived/in_progress/etc.) is left alone.
export async function revertForceAssign(rideId: bigint, driverId: bigint): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const res = await client.query(
      `UPDATE rides
       SET status = 'requested', driver_id = NULL, accepted_at = NULL,
           force_assign_grace_job_id = NULL, updated_at = now()
       WHERE id = $1 AND driver_id = $2 AND status = 'accepted'
       RETURNING id`,
      [rideId, driverId]
    )

    if (!res.rows.length) {
      await client.query('ROLLBACK')
      return false
    }

    await client.query(
      `UPDATE driver_sessions SET status = 'online' WHERE driver_id = $1 AND status = 'on_trip'`,
      [driverId]
    )
    await client.query(
      `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
      [driverId]
    )

    await client.query('COMMIT')
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

Add `AssignCandidate` to the existing `./rides.types` import at the top of the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run src/modules/rides/rides.repository.assign.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/src/modules/rides/rides.repository.assign.test.ts
git commit -m "feat(rides): add repository functions for manual driver assignment"
```

---

### Task 5: Grace-period revert job processor

**Files:**
- Create: `api/src/jobs/processors/force-assign-grace.processor.ts`
- Modify: `api/src/jobs/workers/dispatch.worker.ts`

- [ ] **Step 1: Write the processor**

```typescript
import * as service from '@/modules/rides/rides.service'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'force-assign-grace-processor' })

export interface ForceAssignGraceJobData {
  rideId: string
  driverId: string
}

export async function processForceAssignGraceCheck(data: ForceAssignGraceJobData): Promise<void> {
  try {
    await service.forceAssignGraceCheck(BigInt(data.rideId), BigInt(data.driverId))
  } catch (err) {
    log.error({ err, rideId: data.rideId, driverId: data.driverId }, 'force-assign grace check failed')
    throw err
  }
}
```

- [ ] **Step 2: Wire it into the dispatch worker**

Modify `api/src/jobs/workers/dispatch.worker.ts`:

```typescript
import { Worker } from 'bullmq'
import { QUEUE_NAMES, redisConnection } from '@/jobs/queues'
import { processBroadcast, type BroadcastJobData } from '@/jobs/processors/broadcast.processor'
import { processAckCheck, type AckCheckJobData } from '@/jobs/processors/ack-check.processor'
import { processForceAssignGraceCheck, type ForceAssignGraceJobData } from '@/jobs/processors/force-assign-grace.processor'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('dispatch')

export const dispatchWorker = new Worker(
  QUEUE_NAMES.DISPATCH,
  async (job) => {
    if (job.name === 'broadcast_ride') {
      await processBroadcast(job.data as BroadcastJobData)
    } else if (job.name === 'broadcast_ride_ack_check') {
      await processAckCheck(job.data as AckCheckJobData)
    } else if (job.name === 'force_assign_grace_check') {
      await processForceAssignGraceCheck(job.data as ForceAssignGraceJobData)
    }
    // Unknown job names complete silently
  },
  {
    connection:  redisConnection,
    concurrency: 20,
  }
)

dispatchWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'dispatch job failed')
})
```

- [ ] **Step 3: Commit**

```bash
git add api/src/jobs/processors/force-assign-grace.processor.ts api/src/jobs/workers/dispatch.worker.ts
git commit -m "feat(rides): add force-assign grace-period revert job"
```

---

### Task 6: Service layer — `getRideAssignCandidates`, `adminAssignDriver`, `forceAssignGraceCheck`

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` (append near `forceResolveRide`)
- Test: `api/src/modules/rides/rides.service.assign.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository')
vi.mock('@/modules/payments/payments.service', () => ({ getMinWalletBalance: vi.fn().mockResolvedValue(500) }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: {
    sendRequestExpired: vi.fn(),
    sendRideRequest: vi.fn(),
    sendDriverAssigned: vi.fn(),
  },
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
  notifyAllAdmins: vi.fn(),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } },
  QUEUE_NAMES: { DISPATCH: 'dispatch' },
}))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn() } }))

import * as repo from '@/modules/rides/rides.repository'
import { adminAssignDriver, forceAssignGraceCheck } from './rides.service'

const baseRide = {
  id: 5n, status: 'requested', origin_city_id: 1n, category_id: 2n,
  origin_lat: 20.29, origin_lng: 85.82, origin_address: 'A', destination_address: 'B',
  ride_type: 'one_way', is_return_cab: false, total_estimated: '400', driver_id: null,
}

const eligibleCandidate = {
  driver_id: '9', driver_name: 'D', driver_phone: '999', session_id: '10',
  category_id: '2', category_name: 'Sedan', is_online: true, category_ok: true,
  wallet_ok: true, distance_metres: 1000, eligible: true,
}

describe('adminAssignDriver', () => {
  beforeEach(() => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide as never)
    vi.mocked(repo.getEligibleDriverCategoryIds).mockResolvedValue([2n])
    vi.mocked(repo.getAssignCandidates).mockResolvedValue([eligibleCandidate] as never)
    vi.mocked(repo.getCityBillingMode).mockResolvedValue('commission')
    vi.mocked(repo.cancelAllAssignments).mockResolvedValue([])
    vi.mocked(repo.createRideAssignment).mockResolvedValue(undefined as never)
    vi.mocked(repo.acceptAssignment).mockResolvedValue([])
    vi.mocked(repo.setForceAssignGraceJob).mockResolvedValue(undefined as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
  })

  it('rejects a ride that is not open for assignment', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'accepted' } as never)
    await expect(adminAssignDriver(5n, 9n, 'request', false, 1n)).rejects.toMatchObject({ httpStatus: 409 })
  })

  it('rejects an unknown driver', async () => {
    vi.mocked(repo.getAssignCandidates).mockResolvedValue([] as never)
    await expect(adminAssignDriver(5n, 9n, 'request', false, 1n)).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('rejects an offline driver even with overrideEligibility', async () => {
    vi.mocked(repo.getAssignCandidates).mockResolvedValue([{ ...eligibleCandidate, is_online: false, eligible: false }] as never)
    await expect(adminAssignDriver(5n, 9n, 'force', true, 1n)).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('rejects an ineligible-but-online driver without overrideEligibility', async () => {
    vi.mocked(repo.getAssignCandidates).mockResolvedValue([{ ...eligibleCandidate, category_ok: false, eligible: false }] as never)
    await expect(adminAssignDriver(5n, 9n, 'request', false, 1n)).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('force mode calls acceptAssignment and schedules a grace-period job', async () => {
    const result = await adminAssignDriver(5n, 9n, 'force', false, 1n)
    expect(result).toEqual({ success: true, mode: 'force' })
    expect(repo.acceptAssignment).toHaveBeenCalledWith(5n, 9n, 'commission')
    expect(repo.setForceAssignGraceJob).toHaveBeenCalledWith(5n, 'job-1')
  })

  it('force mode surfaces a 409 when the ride was accepted by someone else first', async () => {
    vi.mocked(repo.acceptAssignment).mockResolvedValue(false)
    await expect(adminAssignDriver(5n, 9n, 'force', false, 1n)).rejects.toMatchObject({ httpStatus: 409 })
  })

  it('request mode creates an assignment without calling acceptAssignment', async () => {
    const result = await adminAssignDriver(5n, 9n, 'request', false, 1n)
    expect(result).toEqual({ success: true, mode: 'request' })
    expect(repo.createRideAssignment).toHaveBeenCalled()
    expect(repo.acceptAssignment).not.toHaveBeenCalled()
  })

  it('flips a scheduled ride to requested before assigning', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'scheduled' } as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue({ ...baseRide, status: 'requested' } as never)
    await adminAssignDriver(5n, 9n, 'request', false, 1n)
    expect(repo.updateRideStatusCAS).toHaveBeenCalledWith(5n, 'scheduled', 'requested')
  })
})

describe('forceAssignGraceCheck', () => {
  beforeEach(() => {
    vi.mocked(repo.hasRideGpsActivity).mockResolvedValue(false)
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'accepted', driver_id: 9n } as never)
    vi.mocked(repo.revertForceAssign).mockResolvedValue(true)
    vi.mocked(repo.clearForceAssignGraceJob).mockResolvedValue(undefined as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
  })

  it('clears the grace job and does not revert when GPS activity exists', async () => {
    vi.mocked(repo.hasRideGpsActivity).mockResolvedValue(true)
    await forceAssignGraceCheck(5n, 9n)
    expect(repo.clearForceAssignGraceJob).toHaveBeenCalledWith(5n)
    expect(repo.revertForceAssign).not.toHaveBeenCalled()
  })

  it('reverts the ride when there is no GPS activity', async () => {
    await forceAssignGraceCheck(5n, 9n)
    expect(repo.revertForceAssign).toHaveBeenCalledWith(5n, 9n)
  })

  it('does nothing when the ride already moved past accepted', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'driver_arrived', driver_id: 9n } as never)
    await forceAssignGraceCheck(5n, 9n)
    expect(repo.revertForceAssign).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run src/modules/rides/rides.service.assign.test.ts`
Expected: FAIL — `adminAssignDriver`/`forceAssignGraceCheck` not exported.

- [ ] **Step 3: Implement the service functions**

Append to `api/src/modules/rides/rides.service.ts` (near `forceResolveRide`; add `notifyOwner, notifyAllAdmins` to the existing `@/modules/notifications/notifications.service` import, `rideAckKey` to the existing `@/constants/redis-keys` import, `client as redis` to the existing `@/db/redis` import, and `MANUAL_ASSIGN_REQUEST_TIMEOUT_SECONDS, FORCE_ASSIGN_GRACE_MINUTES` to the existing `@/constants/limits` import):

```typescript
export async function getRideAssignCandidates(rideId: bigint) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!ride.origin_city_id) {
    throw Object.assign(new Error('Ride has no origin city'), { httpStatus: 409 })
  }

  const categoryIds = await repo.getEligibleDriverCategoryIds(ride.category_id)
  const minWalletBalance = await getMinWalletBalance()

  return repo.getAssignCandidates({
    cityId: ride.origin_city_id,
    rideLat: ride.origin_lat,
    rideLng: ride.origin_lng,
    categoryIds,
    minWalletBalance,
  })
}

export async function adminAssignDriver(
  rideId: bigint,
  driverId: bigint,
  mode: 'request' | 'force',
  overrideEligibility: boolean,
  adminId: bigint,
): Promise<{ success: true; mode: 'request' | 'force' }> {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!['scheduled', 'requested', 'no_drivers'].includes(ride.status)) {
    throw Object.assign(new Error('Ride is not open for assignment'), { httpStatus: 409 })
  }

  const candidates = await getRideAssignCandidates(rideId)
  const candidate = candidates.find(c => c.driver_id === driverId.toString())
  if (!candidate) throw Object.assign(new Error('Driver not found in this city'), { httpStatus: 404 })

  // is_online is a hard gate — there is nowhere to route the assignment
  // without an active session — never bypassable by overrideEligibility.
  if (!candidate.is_online) {
    throw Object.assign(new Error('Driver must be online to be assigned'), { httpStatus: 422 })
  }
  if (!candidate.eligible && !overrideEligibility) {
    throw Object.assign(new Error('Driver is not eligible — pass overrideEligibility to force'), { httpStatus: 422 })
  }

  let workingRide = ride
  if (ride.status !== 'requested') {
    const updated = await repo.updateRideStatusCAS(rideId, ride.status, 'requested')
    if (!updated) throw Object.assign(new Error('Ride status changed — please refresh'), { httpStatus: 409 })
    workingRide = updated
    await repo.logStatusHistory({
      rideId, fromStatus: ride.status, toStatus: 'requested',
      actor: 'admin', actorId: adminId, note: 'Opened for manual assignment',
    })
  }

  const cancelledDriverIds = await repo.cancelAllAssignments(rideId)
  for (const id of cancelledDriverIds) socketEvents.sendRequestExpired(id, rideId.toString())

  const sessionId = BigInt(candidate.session_id!)
  const billingMode = await repo.getCityBillingMode(workingRide.origin_city_id!)

  if (mode === 'force') {
    await repo.createRideAssignment({ rideId, driverId, sessionId, expiresAt: new Date(), broadcastRound: 0 })

    const cancelledOnAccept = await repo.acceptAssignment(rideId, driverId, billingMode)
    if (cancelledOnAccept === false) {
      throw Object.assign(new Error('Ride was accepted by another driver — please refresh'), { httpStatus: 409 })
    }
    for (const id of cancelledOnAccept) socketEvents.sendRequestExpired(id, rideId.toString())

    const graceMs = FORCE_ASSIGN_GRACE_MINUTES * 60_000
    const job = await queues[QUEUE_NAMES.DISPATCH].add(
      'force_assign_grace_check',
      { rideId: rideId.toString(), driverId: driverId.toString() },
      { delay: graceMs, attempts: 1, removeOnComplete: true }
    )
    if (job.id) await repo.setForceAssignGraceJob(rideId, job.id)

    await repo.logStatusHistory({
      rideId, fromStatus: 'requested', toStatus: 'accepted',
      actor: 'admin', actorId: adminId, note: `Force-assigned to driver ${driverId}`,
    })

    socketEvents.sendDriverAssigned(rideId.toString(), { rideId: rideId.toString(), driverId: driverId.toString() })
    await notifyOwner({
      ownerType: 'driver', ownerId: driverId, type: 'ride_force_assigned',
      title: 'You have a new ride', body: 'An admin has assigned you a ride — check your active ride screen.',
      rideId, tag: `ride-${rideId}`,
    })
    return { success: true, mode: 'force' }
  }

  const timeoutSeconds = MANUAL_ASSIGN_REQUEST_TIMEOUT_SECONDS
  const expiresAt = new Date(Date.now() + timeoutSeconds * 1000)
  await repo.createRideAssignment({ rideId, driverId, sessionId, expiresAt, broadcastRound: 0 })
  await redis.set(rideAckKey(rideId.toString(), driverId.toString()), '1', 'EX', timeoutSeconds + 30)

  socketEvents.sendRideRequest(driverId.toString(), {
    rideId: rideId.toString(),
    pickup: workingRide.origin_address ?? 'Pickup location',
    drop: workingRide.destination_address ?? 'Destination',
    pickupLat: workingRide.origin_lat,
    pickupLng: workingRide.origin_lng,
    distanceToPickup: Math.round(candidate.distance_metres ?? 0),
    estimatedFare: workingRide.total_estimated != null ? parseFloat(workingRide.total_estimated) : 0,
    rideType: workingRide.ride_type,
    isReturnCab: workingRide.is_return_cab,
    expiresAt: expiresAt.toISOString(),
    timeoutSeconds,
    assignedByOps: true,
  })

  // Fallback: processBroadcast() already no-ops when the ride is no longer
  // 'requested', so firing this unconditionally is safe — it only actually
  // rebroadcasts if the manual offer above was declined/timed out.
  await queues[QUEUE_NAMES.DISPATCH].add(
    'broadcast_ride',
    {
      rideId: rideId.toString(),
      categoryId: workingRide.category_id.toString(),
      originLat: workingRide.origin_lat,
      originLng: workingRide.origin_lng,
      rideType: workingRide.ride_type,
      isReturnCab: workingRide.is_return_cab,
      broadcastRound: 1,
    },
    { delay: (timeoutSeconds + 2) * 1000, attempts: 1, removeOnComplete: true }
  )

  await repo.logStatusHistory({
    rideId, fromStatus: workingRide.status, toStatus: workingRide.status,
    actor: 'admin', actorId: adminId, note: `Manually offered to driver ${driverId}, awaiting response`,
  })
  await notifyOwner({
    ownerType: 'driver', ownerId: driverId, type: 'ride_manual_request',
    title: 'Ride assigned to you', body: 'An admin has selected you for a ride — respond within 30s.',
    rideId, tag: `ride-${rideId}`,
  })

  return { success: true, mode: 'request' }
}

export async function forceAssignGraceCheck(rideId: bigint, driverId: bigint): Promise<void> {
  const hasActivity = await repo.hasRideGpsActivity(rideId)
  if (hasActivity) {
    await repo.clearForceAssignGraceJob(rideId)
    return
  }

  const ride = await repo.getRideById(rideId)
  if (!ride || ride.status !== 'accepted' || ride.driver_id !== driverId) return

  const reverted = await repo.revertForceAssign(rideId, driverId)
  if (!reverted) return

  await repo.logStatusHistory({
    rideId, fromStatus: 'accepted', toStatus: 'requested', actor: 'system',
    note: `Force-assigned driver ${driverId} showed no activity within the grace period — reverted to unassigned`,
  })

  await notifyAllAdmins({
    type: 'force_assign_reverted',
    title: 'Force-assigned ride reverted',
    body: `Ride #${rideId} was force-assigned but the driver never responded — it's unassigned again.`,
    rideId,
  })

  await queues[QUEUE_NAMES.DISPATCH].add(
    'broadcast_ride',
    {
      rideId: rideId.toString(),
      categoryId: ride.category_id.toString(),
      originLat: ride.origin_lat,
      originLng: ride.origin_lng,
      rideType: ride.ride_type,
      isReturnCab: ride.is_return_cab,
      broadcastRound: 1,
    },
    { delay: 0, attempts: 2, removeOnComplete: true }
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run src/modules/rides/rides.service.assign.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Run the full rides test suite to check nothing broke**

Run: `cd api && npx vitest run src/modules/rides`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/src/modules/rides/rides.service.assign.test.ts
git commit -m "feat(rides): add adminAssignDriver and forceAssignGraceCheck"
```

---

### Task 7: Admin API — routes, controller, service delegation

**Files:**
- Modify: `api/src/modules/admin/admin.routes.ts:99-104`
- Modify: `api/src/modules/admin/admin.controller.ts`
- Modify: `api/src/modules/admin/admin.service.ts`

- [ ] **Step 1: Add the two routes**

In `admin.routes.ts`, after the existing `force-resolve` line:

```typescript
router.get('/rides/:id/assign-candidates', requireAdmin('super_admin', 'ops_admin', 'support_admin'), controller.getRideAssignCandidates)
router.post('/rides/:id/assign', requireAdmin('super_admin', 'ops_admin'), controller.assignDriverToRide)
```

- [ ] **Step 2: Add the controller handlers**

Append to `admin.controller.ts`:

```typescript
export async function getRideAssignCandidates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ candidates: await service.getRideAssignCandidates(BigInt(req.params['id']!)) })
  } catch (err) { next(err) }
}

export async function assignDriverToRide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { driverId?: string; mode?: string; overrideEligibility?: boolean }
    if (!body.driverId || (body.mode !== 'request' && body.mode !== 'force')) {
      res.status(400).json({ error: 'driverId and mode (request|force) are required', code: 'VALIDATION_ERROR' })
      return
    }
    const result = await service.assignDriverToRide(
      BigInt(req.params['id']!), BigInt(body.driverId), body.mode, req.admin!.id, body.overrideEligibility ?? false
    )
    res.json(result)
  } catch (err) { next(err) }
}
```

- [ ] **Step 3: Add the service delegation**

Append to `admin.service.ts` (add `getRideAssignCandidates as getAssignCandidatesForRide, adminAssignDriver` to the existing `@/modules/rides/rides.service` import — the same import line `forceResolveRide as resolveStuckRide` already comes from):

```typescript
export async function getRideAssignCandidates(rideId: bigint) {
  return getAssignCandidatesForRide(rideId)
}

export async function assignDriverToRide(
  rideId: bigint,
  driverId: bigint,
  mode: 'request' | 'force',
  adminId: bigint,
  overrideEligibility: boolean,
) {
  return adminAssignDriver(rideId, driverId, mode, overrideEligibility, adminId)
}
```

- [ ] **Step 4: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/admin.routes.ts api/src/modules/admin/admin.controller.ts api/src/modules/admin/admin.service.ts
git commit -m "feat(admin): expose manual driver assignment endpoints"
```

---

### Task 8: Admin frontend API wrapper

**Files:**
- Modify: `apps/admin/lib/admin-api.ts:341` (inside the "Rides" section, after `AdminRideStats`/before `adminRideApi`, and inside the `adminRideApi` object)

- [ ] **Step 1: Add the type and the two API methods**

```typescript
export interface AssignCandidate {
  driver_id: string
  driver_name: string
  driver_phone: string
  category_name: string | null
  is_online: boolean
  category_ok: boolean
  wallet_ok: boolean
  distance_metres: number | null
  eligible: boolean
}
```

Inside `adminRideApi`, after `forceResolve`:

```typescript
  getAssignCandidates: async (rideId: string): Promise<AssignCandidate[]> => {
    const res = await api.get(`/api/v1/admin/rides/${rideId}/assign-candidates`)
    return (res.data as { candidates: AssignCandidate[] }).candidates
  },
  assignDriver: async (rideId: string, driverId: string, mode: 'request' | 'force', overrideEligibility?: boolean): Promise<void> => {
    await api.post(`/api/v1/admin/rides/${rideId}/assign`, { driverId, mode, overrideEligibility })
  },
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/admin/lib/admin-api.ts
git commit -m "feat(admin): add assign-candidates/assign API client methods"
```

---

### Task 9: Admin frontend — `AssignDriverDrawer` component

**Files:**
- Create: `apps/admin/app/(dashboard)/rides/AssignDriverDrawer.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { adminRideApi, type AdminRideItem, type AssignCandidate } from '@/lib/admin-api'

interface Props {
  ride: AdminRideItem | null
  onClose: () => void
  onAssigned: () => void
}

export default function AssignDriverDrawer({ ride, onClose, onAssigned }: Props) {
  const reduce = useReducedMotion()
  const [candidates, setCandidates] = useState<AssignCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'request' | 'force'>('request')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ride) return
    setLoading(true)
    setError(null)
    adminRideApi.getAssignCandidates(ride.id)
      .then(setCandidates)
      .catch(() => setError('Could not load drivers for this ride.'))
      .finally(() => setLoading(false))
  }, [ride])

  async function handleSelect(candidate: AssignCandidate) {
    if (!ride) return
    if (!candidate.eligible && confirmingId !== candidate.driver_id) {
      setConfirmingId(candidate.driver_id)
      return
    }
    setAssigningId(candidate.driver_id)
    setError(null)
    try {
      await adminRideApi.assignDriver(ride.id, candidate.driver_id, mode, !candidate.eligible)
      onAssigned()
    } catch {
      setError('Assignment failed — the ride may have already been accepted.')
    } finally {
      setAssigningId(null)
      setConfirmingId(null)
    }
  }

  const filtered = candidates.filter(c =>
    !search || c.driver_name.toLowerCase().includes(search.toLowerCase()) || c.driver_phone.includes(search)
  )

  return (
    <AnimatePresence>
      {ride && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.15 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed top-0 right-0 h-full w-full max-w-md bg-surface z-50 shadow-xl flex flex-col"
            initial={reduce ? { opacity: 0 } : { x: '100%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: reduce ? 0.01 : 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">
                Assign Driver — Ride #{ride.id}
              </h2>
              <button onClick={onClose} className="text-text-muted text-sm hover:text-text-primary transition-colors duration-150">
                Close
              </button>
            </div>

            <div className="p-4 space-y-3 border-b border-border">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or phone..."
                className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-muted">Mode:</span>
                <button
                  onClick={() => setMode('request')}
                  className={`px-3 py-1.5 rounded-full font-semibold transition-colors duration-150 ${mode === 'request' ? 'bg-primary text-white' : 'bg-surface-2 text-text-muted'}`}
                >
                  Send as Request
                </button>
                <button
                  onClick={() => setMode('force')}
                  className={`px-3 py-1.5 rounded-full font-semibold transition-colors duration-150 ${mode === 'force' ? 'bg-primary text-white' : 'bg-surface-2 text-text-muted'}`}
                >
                  Force Assign
                </button>
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs">{error}</div>
            )}

            <div className="flex-1 overflow-y-auto">
              {loading && <p className="p-4 text-xs text-text-muted">Loading drivers...</p>}
              {!loading && filtered.length === 0 && (
                <p className="p-4 text-xs text-text-muted">No drivers found in this city.</p>
              )}
              {filtered.map(c => (
                <div key={c.driver_id} className="border-b border-border-light">
                  <div
                    className={`flex items-center justify-between px-4 py-3 transition-colors duration-150 ${!c.eligible ? 'opacity-50' : 'hover:bg-surface-2'}`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{c.driver_name}</p>
                      <p className="text-xs text-text-muted">
                        {c.category_name ?? 'No category'}
                        {c.distance_metres != null && ` · ${(c.distance_metres / 1000).toFixed(1)} km`}
                        {!c.is_online && ' · Offline'}
                        {c.is_online && !c.category_ok && ' · Wrong category'}
                        {c.is_online && c.category_ok && !c.wallet_ok && ' · Low balance'}
                      </p>
                    </div>
                    <button
                      disabled={assigningId === c.driver_id}
                      onClick={() => void handleSelect(c)}
                      className="px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-full disabled:opacity-50 hover:bg-primary-dark transition-colors duration-150 flex-shrink-0"
                    >
                      {c.eligible ? 'Select' : 'Select anyway'}
                    </button>
                  </div>
                  <AnimatePresence>
                    {confirmingId === c.driver_id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: reduce ? 0.01 : 0.2 }}
                        className="px-4 pb-3 overflow-hidden"
                      >
                        <div className="px-3 py-2 rounded-lg bg-warning-light text-warning text-xs flex items-center justify-between gap-2">
                          <span>{c.driver_name} is not fully eligible — assign anyway?</span>
                          <button
                            disabled={assigningId === c.driver_id}
                            onClick={() => void handleSelect(c)}
                            className="px-2 py-1 rounded-full bg-warning text-white font-semibold flex-shrink-0"
                          >
                            Confirm
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/app/(dashboard)/rides/AssignDriverDrawer.tsx"
git commit -m "feat(admin): add AssignDriverDrawer component"
```

---

### Task 10: Wire the drawer into the rides page

**Files:**
- Modify: `apps/admin/app/(dashboard)/rides/page.tsx`

- [ ] **Step 1: Add state and import**

Near the existing `const [selected, setSelected] = useState<AdminRideDetail | null>(null)` line, add:

```typescript
const [assignTarget, setAssignTarget] = useState<AdminRideItem | null>(null)
```

Add the import at the top of the file:

```typescript
import AssignDriverDrawer from './AssignDriverDrawer'
```

- [ ] **Step 2: Update the Driver column render to add the inline "Assign" button**

Replace the existing `driver` column render (the `: <span className="text-text-muted italic text-xs">Unassigned</span>` branch):

```tsx
{
  key: 'driver', header: 'Driver',
  render: (r: AdminRideItem) => r.driver_name
    ? (
      <div className="flex items-center gap-2">
        <Avatar name={r.driver_name} tone="muted" />
        <div className="min-w-0">
          <p className="font-medium text-text-secondary truncate">{r.driver_name}</p>
          <p className="text-xs text-text-muted">{r.driver_phone}</p>
        </div>
      </div>
    )
    : (
      <div className="flex items-center gap-2">
        <span className="text-text-muted italic text-xs">Unassigned</span>
        {['scheduled', 'requested', 'no_drivers'].includes(r.status) && (
          <button
            onClick={(e) => { e.stopPropagation(); setAssignTarget(r) }}
            className="px-2 py-1 text-xs font-semibold bg-primary text-white rounded-full hover:bg-primary-dark transition-colors duration-150"
          >
            Assign
          </button>
        )}
      </div>
    ),
},
```

- [ ] **Step 3: Mount the drawer**

Near the end of the component's JSX (as a sibling to the existing ride-detail drawer):

```tsx
<AssignDriverDrawer
  ride={assignTarget}
  onClose={() => setAssignTarget(null)}
  onAssigned={() => { setAssignTarget(null); void fetchRides() }}
/>
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual smoke test**

Run: `cd apps/admin && pnpm dev`, open the rides page, find (or create, via the user app) a `requested`/`scheduled`/`no_drivers` ride with no driver, click "Assign", confirm the drawer opens, lists drivers, and the mode toggle switches visually.
Expected: drawer opens with a slide-in transition, driver list loads, ineligible drivers show greyed out with a reason.

- [ ] **Step 6: Commit**

```bash
git add "apps/admin/app/(dashboard)/rides/page.tsx"
git commit -m "feat(admin): wire manual driver assignment into rides table"
```

---

### Task 11: Driver app — "Assigned by Ops" card treatment

**Files:**
- Modify: `apps/driver/src/App.tsx`
- Modify: `apps/driver/src/components/ui/TripRequestCard.tsx`

- [ ] **Step 1: Thread `assignedByOps` through the socket payload and store**

In `apps/driver/src/App.tsx`, extend the `onRideRequest` handler's data type and the `incomingReq` object (around line 220-249):

```typescript
const onRideRequest = (data: {
  rideId: string; pickup: string; drop: string; distanceToPickup: number;
  estimatedFare: number; rideType: string; isReturnCab: boolean; expiresAt: string;
  timeoutSeconds: number; pickupLat?: number; pickupLng?: number;
  destinationLat?: number; destinationLng?: number; returnAt?: string; tripHours?: number;
  stopCount?: number; rideCategoryName?: string; assignedByOps?: boolean;
}) => {
  // ...existing tripDistance calculation unchanged...
  const incomingReq: Parameters<typeof setIncomingRequest>[0] = {
    rideId: data.rideId, pickup: data.pickup, drop: data.drop,
    pickupDistance: data.distanceToPickup / 1000, tripDistance, fare: data.estimatedFare,
    timeoutSeconds: data.timeoutSeconds, pickupLat: pLat, pickupLng: pLng,
    rideType: data.rideType,
    returnAt: data.returnAt,
    tripHours: data.tripHours,
  }
  if (data.stopCount !== undefined) incomingReq.stopCount = data.stopCount
  if (data.rideCategoryName !== undefined) incomingReq.rideCategoryName = data.rideCategoryName
  if (data.assignedByOps !== undefined) incomingReq.assignedByOps = data.assignedByOps
  setIncomingRequest(incomingReq)
  socket.emit('ride:request:ack', { rideId: data.rideId })
}
```

Pass it through to the card at the existing `<TripRequestCard ... />` call site (around line 547-567):

```tsx
<TripRequestCard
  key={incomingRequest.rideId}
  pickup={incomingRequest.pickup}
  drop={incomingRequest.drop}
  pickupDistance={incomingRequest.pickupDistance}
  tripDistance={incomingRequest.tripDistance}
  fare={incomingRequest.fare}
  timeRemaining={incomingRequest.timeoutSeconds}
  rideType={incomingRequest.rideType}
  tripHours={incomingRequest.tripHours}
  returnAt={incomingRequest.returnAt}
  stopCount={incomingRequest.stopCount}
  rideCategoryName={incomingRequest.rideCategoryName}
  assignedByOps={incomingRequest.assignedByOps}
  pickupLat={incomingRequest.pickupLat}
  pickupLng={incomingRequest.pickupLng}
  isAccepting={accepting}
  accepted={acceptedBeat}
  failed={acceptFailed}
  onAccept={() => void handleAcceptRide(incomingRequest.rideId, incomingRequest.rideType)}
  onDecline={clearIncomingRequest}
/>
```

- [ ] **Step 2: Add `assignedByOps` to the `useRideStore` incoming-request shape**

In `apps/driver/src/store/useRideStore.ts`, find the `incomingRequest` type (the object shape passed to `setIncomingRequest`) and add `assignedByOps?: boolean` alongside the existing optional fields (`stopCount?: number`, `rideCategoryName?: string`).

- [ ] **Step 3: Add the info pill to `TripRequestCard`**

In `apps/driver/src/components/ui/TripRequestCard.tsx`, add `assignedByOps?: boolean` to `TripRequestCardProps` (after `rideCategoryName?: string`) and destructure it in the function signature (after `rideCategoryName,`). Then add the pill next to the existing ride-type/category badges in the header block (inside the `<motion.div variants={childVar} className="flex items-center justify-between px-5 pt-3 pb-2">` block, after the `rideCategoryName` badge):

```tsx
{assignedByOps && (
  <span
    className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
    style={{ background: 'rgba(14,165,233,0.15)', color: C.info }}
  >
    Assigned by Ops
  </span>
)}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Manual smoke test**

Run: `cd apps/driver && pnpm dev`, trigger a "Send as Request" manual assignment from the admin drawer against a real online test driver session, confirm the card shows the "Assigned by Ops" pill and counts down from 30s (not the usual 15-20s broadcast window).
Expected: pill visible, countdown starts at 30.

- [ ] **Step 6: Commit**

```bash
git add apps/driver/src/App.tsx apps/driver/src/components/ui/TripRequestCard.tsx apps/driver/src/store/useRideStore.ts
git commit -m "feat(driver): show Assigned by Ops pill for admin-initiated requests"
```

---

### Task 12: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Request-mode happy path**

Book a ride as a user (or use an existing `requested` ride with no driver), open the admin rides page, click "Assign" on that row, pick an eligible online driver in "Send as Request" mode, confirm the driver app shows the "Assigned by Ops" card, accept it on the driver side, confirm the ride shows that driver assigned in the admin table.

- [ ] **Step 2: Request-mode decline → auto-broadcast fallback**

Repeat, but decline on the driver side (or let the 30s timer expire). Confirm the ride is picked up by the normal broadcast pipeline shortly after (round 1 re-fires) and the admin can see a "declined" note in the ride's status history (`GET /admin/rides/:id`).

- [ ] **Step 3: Force-assign happy path**

Pick a driver in "Force Assign" mode. Confirm the ride immediately shows `accepted` with that driver, no accept step needed on the driver side.

- [ ] **Step 4: Force-assign grace-period revert**

Force-assign a driver whose app you keep closed (no GPS pings sent). Wait `FORCE_ASSIGN_GRACE_MINUTES` (4 min) and confirm the ride reverts to `requested`/unassigned and an admin notification fires.

- [ ] **Step 5: Scheduled-ride assignment**

Pick a `scheduled` ride from the "Upcoming scheduled rides" panel's underlying row (or any scheduled ride in the main table) and manually assign it before its dispatch buffer fires. Confirm it flips straight to `requested` → assigned, and the ride's status history shows the admin-initiated transition.

---

## Self-Review Notes

- **Spec coverage:** entry point (Task 10), driver picker + eligibility (Tasks 4, 9), mode toggle (Task 9), overlap-cancellation (Task 6, `cancelAllAssignments` call), decline/timeout fallback (Task 6, fallback broadcast job), force-assign grace period (Tasks 5, 6), audit trail (`logStatusHistory` calls throughout Task 6), driver "Assigned by Ops" treatment (Task 11) — all covered.
- **Type consistency:** `AssignCandidate` defined once in `rides.types.ts` (Task 3) and mirrored (not reused directly, since it's a cross-app boundary) in `admin-api.ts` (Task 8) — kept in sync manually since the driver-picker only needs a subset of fields; `session_id`/`category_id` are omitted from the frontend copy since the UI never uses them.
- **No placeholders:** every step has literal code; the only intentionally deferred item is the `initiated_by`/analytics distinction called out as out-of-scope in the spec.
