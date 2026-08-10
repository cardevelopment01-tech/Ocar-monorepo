# Driver Heartbeat & Auto-Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two related driver-connectivity gaps: (1) an idle "online" driver whose browser tab dies/crashes/backgrounds stays matchable forever today, and (2) a driver mid-trip on a long outstation ride gets their *entire live ride* auto-cancelled with zero fare after 30 minutes of GPS silence — which happens routinely on any multi-hour drive once the tab backgrounds (screen lock, switching to Maps for navigation).

**Architecture:** Two independent changes, no shared code path:
- **In-trip:** delete the blind GPS-staleness auto-cancel in `cleanup.worker.ts`. Keep the existing 10-minute flag-for-review — a human decides from there, a timer never force-ends a live trip again.
- **Idle:** two layers. A client-driven layer (Page Visibility API) is the primary mechanism — it reacts to a tab backgrounding instantly and pauses the driver's matching-pool availability without ending their session, then resumes just as fast. A server-driven GPS-staleness sweep is a pure backstop for the cases the client can't self-report (crash, OS-kill, battery death) — same two-tier shape (short pause, longer session-end), reusing the `driver_location_snapshots.is_available` column and the existing `goOffline()` function. A forced session-end notifies the driver once, through the notification pipeline that already exists — no new UI component.

**Tech Stack:** Express routes + BullMQ repeatable worker (`cleanup.worker.ts`, already runs every 60s) on the API side; Page Visibility API (`visibilitychange`) + `navigator.sendBeacon` (`pagehide`) on the Vite/React driver app side. No new tables, no new dependencies.

---

## File Structure

| File | Change |
|---|---|
| `api/src/constants/limits.ts` | Add 2 new threshold constants |
| `api/src/modules/rides/rides.repository.ts` | Add `setDriverAvailability()`, `findStaleOnlineDrivers()` |
| `api/src/modules/rides/rides.service.ts` | Add `pauseAvailability()`, `resumeAvailability()` |
| `api/src/modules/rides/rides.routes.ts` | Add `POST /sessions/pause`, `POST /sessions/resume` |
| `api/src/jobs/workers/cleanup.worker.ts` | Remove auto-cancel branch; add idle-heartbeat sweep |
| `apps/driver/src/lib/ride-api.ts` | Add `pause()`, `resume()` client methods |
| `apps/driver/src/App.tsx` | Add `visibilitychange` + `pagehide` listeners |
| `api/tests/unit/rides/idle-heartbeat.test.ts` | New — covers pause/resume + backstop sweep |
| `api/tests/unit/jobs/cleanup-no-auto-cancel.test.ts` | New — proves the auto-cancel branch is gone |

---

### Task 1: Remove the blind stale-GPS auto-cancel for in-progress rides

**Files:**
- Modify: `api/src/jobs/workers/cleanup.worker.ts:19-43`
- Test: `api/tests/unit/jobs/cleanup-no-auto-cancel.test.ts` (new)

**Why:** `findStaleInProgressRides` + the `CANCEL_AFTER_SECONDS` branch cancels a live ride with zero fare after 30 minutes of GPS silence. On a real multi-hour outstation trip, GPS silence past 30 minutes is close to *guaranteed* the moment the driver locks their phone or opens Maps for navigation (the driver app is a browser tab with no background-GPS capability — confirmed in `apps/driver/src/lib/useDriverLocation.ts`, `watchPosition` only resumes on `visibilitychange`). The 10-minute flag is cheap and reversible (just a `review_flagged_at` column + an admin-visible badge) and stays exactly as-is; only the automatic cancellation is removed.

- [ ] **Step 1: Read the current worker to confirm exact lines to remove**

Current `api/src/jobs/workers/cleanup.worker.ts`:
```ts
import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import * as repo from '@/modules/rides/rides.repository'
import {
  forceResolveRide,
  expireStaleRequestedRide,
  expireStaleAcceptedOrArrivedRide,
} from '@/modules/rides/rides.service'
import { socketEvents } from '@/websocket/socket.server'
import {
  STALE_REQUESTED_MINUTES,
  STALE_ACCEPTED_HOURS,
  STALE_DRIVER_ARRIVED_HOURS,
} from '@/constants/limits'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('cleanup')

// Ride stuck in_progress with no driver heartbeat (driver_location_snapshots.recorded_at):
//  - past FLAG_AFTER_SECONDS  -> flag for review, notify rider + admin ops
//  - past CANCEL_AFTER_SECONDS -> auto-cancel (no fare — the trip was never verifiable)
const FLAG_AFTER_SECONDS   = 10 * 60
const CANCEL_AFTER_SECONDS = 30 * 60

export const cleanupWorker = new Worker(
  QUEUE_NAMES.CLEANUP,
  async () => {
    const staleRides = await repo.findStaleInProgressRides(FLAG_AFTER_SECONDS)

    for (const ride of staleRides) {
      const rideId = BigInt(ride.id)

      if (!ride.review_flagged_at) {
        await repo.flagRideForReview(rideId, 'gps_stale')
        socketEvents.sendStuckRideFlagged(ride.id, { reason: 'gps_stale' })
        continue
      }

      const flaggedForSeconds = (Date.now() - new Date(ride.review_flagged_at).getTime()) / 1000
      if (flaggedForSeconds > CANCEL_AFTER_SECONDS - FLAG_AFTER_SECONDS) {
        await forceResolveRide(rideId, 'cancelled', 'timeout', 'auto-cancelled: no driver heartbeat')
      }
    }
    // ...
```

- [ ] **Step 2: Replace the sweep body — flag only, never auto-cancel**

```ts
import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import * as repo from '@/modules/rides/rides.repository'
import {
  expireStaleRequestedRide,
  expireStaleAcceptedOrArrivedRide,
} from '@/modules/rides/rides.service'
import { socketEvents } from '@/websocket/socket.server'
import {
  STALE_REQUESTED_MINUTES,
  STALE_ACCEPTED_HOURS,
  STALE_DRIVER_ARRIVED_HOURS,
} from '@/constants/limits'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('cleanup')

// Ride stuck in_progress with no driver heartbeat (driver_location_snapshots.recorded_at):
// past FLAG_AFTER_SECONDS -> flag for review, notify rider + admin ops.
// Deliberately does NOT auto-cancel past any further threshold — the driver app
// is a browser tab with no background-GPS capability, so GPS silence past 30
// minutes is close to guaranteed on any real multi-hour trip once the tab
// backgrounds (screen lock, switching to Maps for turn-by-turn). Auto-cancelling
// a live ride on that signal alone force-ends real trips with zero fare to the
// driver. A flagged ride is resolved by a human at ops, never by a timer.
const FLAG_AFTER_SECONDS = 10 * 60

export const cleanupWorker = new Worker(
  QUEUE_NAMES.CLEANUP,
  async () => {
    const staleRides = await repo.findStaleInProgressRides(FLAG_AFTER_SECONDS)

    for (const ride of staleRides) {
      if (!ride.review_flagged_at) {
        await repo.flagRideForReview(BigInt(ride.id), 'gps_stale')
        socketEvents.sendStuckRideFlagged(ride.id, { reason: 'gps_stale' })
      }
    }
```

The rest of the worker (orphaned `requested`/`accepted`/`driver_arrived` sweeps) is unrelated to this change — leave untouched.

- [ ] **Step 3: Write the regression test**

```ts
// api/tests/unit/jobs/cleanup-no-auto-cancel.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  findStaleInProgressRides:        vi.fn(),
  flagRideForReview:               vi.fn(),
  findStaleRequestedRides:         vi.fn().mockResolvedValue([]),
  findStaleAcceptedOrArrivedRides: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/modules/rides/rides.service', () => ({
  forceResolveRide:               vi.fn(),
  expireStaleRequestedRide:       vi.fn(),
  expireStaleAcceptedOrArrivedRide: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendStuckRideFlagged: vi.fn() },
}))
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((_name, processor) => ({ on: vi.fn(), __processor: processor })),
}))

import * as repo from '@/modules/rides/rides.repository'
import { forceResolveRide } from '@/modules/rides/rides.service'

describe('cleanup worker — in-progress ride sweep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a ride flagged 45 minutes ago is NOT auto-cancelled', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([
      { id: '1', driver_id: '9', review_flagged_at: new Date(Date.now() - 45 * 60_000).toISOString() },
    ] as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(forceResolveRide).not.toHaveBeenCalled()
    // Already flagged — flagRideForReview must not be called a second time
    expect(repo.flagRideForReview).not.toHaveBeenCalled()
  })

  it('an unflagged stale ride gets flagged exactly once', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([
      { id: '2', driver_id: '9', review_flagged_at: null },
    ] as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(repo.flagRideForReview).toHaveBeenCalledWith(BigInt(2), 'gps_stale')
    expect(forceResolveRide).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run it**

Run: `cd api && npx vitest run tests/unit/jobs/cleanup-no-auto-cancel.test.ts`
Expected: both tests PASS, `forceResolveRide` never called.

- [ ] **Step 5: Commit**

```bash
git add api/src/jobs/workers/cleanup.worker.ts api/tests/unit/jobs/cleanup-no-auto-cancel.test.ts
git commit -m "fix(rides): stop auto-cancelling in-progress rides on GPS silence alone"
```

---

### Task 2: Add idle-heartbeat threshold constants

**Files:**
- Modify: `api/src/constants/limits.ts:76-79`

- [ ] **Step 1: Add two constants next to the existing STALE_* group**

```ts
export const STALE_REQUESTED_MINUTES = 20
export const STALE_ACCEPTED_HOURS = 3
export const STALE_DRIVER_ARRIVED_HOURS = 1
export const STALE_IN_PROGRESS_CEILING_HOURS = 12

// Idle "online" (not on_trip) driver whose GPS ping has gone stale — see
// cleanup.worker.ts's idle-heartbeat sweep. Two tiers: pull from the matching
// pool fast (cheap, reversible — a driver's tab backgrounding is the primary,
// client-reported path, this is only the backstop for a real crash/OS-kill),
// end the session only after a much longer silence.
export const IDLE_HEARTBEAT_PAUSE_SECONDS = 90
export const IDLE_HEARTBEAT_OFFLINE_MINUTES = 10
```

- [ ] **Step 2: Commit**

```bash
git add api/src/constants/limits.ts
git commit -m "feat(rides): add idle-heartbeat threshold constants"
```

(No standalone test — these are plain constants, exercised by Task 5's tests.)

---

### Task 3: Repository — availability toggle + stale-online-driver query

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts` (add near `findStaleInProgressRides`, ~line 747)

- [ ] **Step 1: Add `setDriverAvailability`**

Reuses the exact `driver_location_snapshots.is_available` column already flipped by `goOnline`/`goOffline`/`updateLocation`/`acceptRide` — no schema change.

```ts
export async function setDriverAvailability(driverId: bigint, isAvailable: boolean): Promise<void> {
  await pool.query(
    `UPDATE driver_location_snapshots SET is_available = $2 WHERE driver_id = $1`,
    [driverId, isAvailable]
  )
}
```

- [ ] **Step 2: Add `findStaleOnlineDrivers`, modeled directly on `findStaleInProgressRides`**

```ts
// Idle (status = 'online', never 'on_trip' — that's the separate in-progress-ride
// sweep above) drivers whose GPS has gone stale. Same staleSeconds param is reused
// for both the short pause-from-pool tier and the longer force-offline tier —
// see cleanup.worker.ts.
export async function findStaleOnlineDrivers(staleSeconds: number): Promise<{ driver_id: string }[]> {
  const res = await pool.query<{ driver_id: string }>(
    `SELECT ds.driver_id::text
     FROM driver_sessions ds
     JOIN driver_location_snapshots dls ON dls.driver_id = ds.driver_id
     WHERE ds.status = 'online'
       AND now() - dls.recorded_at > ($1 || ' seconds')::interval`,
    [staleSeconds]
  )
  return res.rows
}
```

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts
git commit -m "feat(rides): add setDriverAvailability + findStaleOnlineDrivers queries"
```

---

### Task 4: Service + routes — pause/resume availability

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` (add near `goOffline`, ~line 248)
- Modify: `api/src/modules/rides/rides.routes.ts:106-114` (insert after `/sessions/location`)
- Test: `api/tests/unit/rides/idle-heartbeat.test.ts` (new — covers this + Task 5)

**Why the guard:** `is_available` is also flipped `false` by `acceptRide` the moment a driver takes a ride (`rides.repository.ts:880`). If the client's `visibilitychange` "resume" fires while the driver is actually mid-trip (tab regains visibility during a ride — completely normal), it must NOT stomp that back to `true`. Both functions no-op unless the driver's session is `'online'` (idle) — mirrors the guard `goOffline` already implicitly gets from `getActiveSession`.

- [ ] **Step 1: Add the two service functions**

```ts
export async function pauseAvailability(driverId: bigint): Promise<void> {
  const session = await repo.getActiveSession(driverId)
  if (!session || session.status !== 'online') return
  await repo.setDriverAvailability(driverId, false)
}

export async function resumeAvailability(driverId: bigint): Promise<void> {
  const session = await repo.getActiveSession(driverId)
  if (!session || session.status !== 'online') return
  await repo.setDriverAvailability(driverId, true)
}
```

- [ ] **Step 2: Add the two routes**

```ts
router.post('/sessions/pause', authenticate(), async (req, res, next) => {
  try {
    await service.pauseAvailability(req.driver!.id)
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/sessions/resume', authenticate(), async (req, res, next) => {
  try {
    await service.resumeAvailability(req.driver!.id)
    res.json({ success: true })
  } catch (err) { next(err) }
})
```

- [ ] **Step 3: Write the test**

```ts
// api/tests/unit/rides/idle-heartbeat.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getActiveSession:       vi.fn(),
  setDriverAvailability:  vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { pauseAvailability, resumeAvailability } from '@/modules/rides/rides.service'

const DRIVER_ID = BigInt(42)

describe('pauseAvailability / resumeAvailability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pauses an idle online driver', async () => {
    vi.mocked(repo.getActiveSession).mockResolvedValue({ id: 1, status: 'online' } as never)
    await pauseAvailability(DRIVER_ID)
    expect(repo.setDriverAvailability).toHaveBeenCalledWith(DRIVER_ID, false)
  })

  it('resumes an idle online driver', async () => {
    vi.mocked(repo.getActiveSession).mockResolvedValue({ id: 1, status: 'online' } as never)
    await resumeAvailability(DRIVER_ID)
    expect(repo.setDriverAvailability).toHaveBeenCalledWith(DRIVER_ID, true)
  })

  it('no-ops a driver mid-trip — resume must never override the accept-ride unavailability flip', async () => {
    vi.mocked(repo.getActiveSession).mockResolvedValue({ id: 1, status: 'on_trip' } as never)
    await resumeAvailability(DRIVER_ID)
    expect(repo.setDriverAvailability).not.toHaveBeenCalled()
  })

  it('no-ops a driver with no session at all', async () => {
    vi.mocked(repo.getActiveSession).mockResolvedValue(null)
    await pauseAvailability(DRIVER_ID)
    expect(repo.setDriverAvailability).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run it**

Run: `cd api && npx vitest run tests/unit/rides/idle-heartbeat.test.ts`
Expected: all 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/src/modules/rides/rides.routes.ts api/tests/unit/rides/idle-heartbeat.test.ts
git commit -m "feat(rides): add pause/resume-availability endpoints for idle drivers"
```

---

### Task 5: Backstop sweep in cleanup.worker.ts + driver notification

**Files:**
- Modify: `api/src/jobs/workers/cleanup.worker.ts` (add to the same worker from Task 1)
- Modify: `api/tests/unit/jobs/cleanup-no-auto-cancel.test.ts` → rename in this task to `api/tests/unit/jobs/cleanup-idle-heartbeat.test.ts` and extend

**Why `notifyOwner`, not a new UI component:** `notifications.service.ts`'s `notifyOwner()` already persists an in-app feed row, sends a push, and socket-emits `notification:new` in one call — which `apps/driver/src/App.tsx:207-213` already listens for and feeds into `useNotificationsStore`, which `NotificationToast` (mounted globally in `App.tsx:596`) already renders. Reusing it means the "you went offline" message is a toast the driver would see whether the app happened to have a bespoke banner for this or not — zero new driver-app code for this piece.

- [ ] **Step 1: Extend the worker's imports and processor**

```ts
import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import * as repo from '@/modules/rides/rides.repository'
import {
  expireStaleRequestedRide,
  expireStaleAcceptedOrArrivedRide,
  pauseAvailability,
  goOffline,
} from '@/modules/rides/rides.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { socketEvents } from '@/websocket/socket.server'
import {
  STALE_REQUESTED_MINUTES,
  STALE_ACCEPTED_HOURS,
  STALE_DRIVER_ARRIVED_HOURS,
  IDLE_HEARTBEAT_PAUSE_SECONDS,
  IDLE_HEARTBEAT_OFFLINE_MINUTES,
} from '@/constants/limits'
import { createWorkerLogger } from '@/lib/worker-logger'

const log = createWorkerLogger('cleanup')

const FLAG_AFTER_SECONDS = 10 * 60

export const cleanupWorker = new Worker(
  QUEUE_NAMES.CLEANUP,
  async () => {
    const staleRides = await repo.findStaleInProgressRides(FLAG_AFTER_SECONDS)
    for (const ride of staleRides) {
      if (!ride.review_flagged_at) {
        await repo.flagRideForReview(BigInt(ride.id), 'gps_stale')
        socketEvents.sendStuckRideFlagged(ride.id, { reason: 'gps_stale' })
      }
    }

    for (const ride of await repo.findStaleRequestedRides(STALE_REQUESTED_MINUTES)) {
      await expireStaleRequestedRide(BigInt(ride.id))
    }
    for (const ride of await repo.findStaleAcceptedOrArrivedRides(STALE_ACCEPTED_HOURS, STALE_DRIVER_ARRIVED_HOURS)) {
      await expireStaleAcceptedOrArrivedRide(BigInt(ride.id), ride.status, BigInt(ride.driver_id))
    }

    // Idle-driver heartbeat: the client's own visibilitychange/pagehide handlers
    // (apps/driver/src/App.tsx) are the primary signal and react within a second —
    // this sweep only catches drivers who never got to report anything (real crash,
    // OS-killed process, battery death). Short tier pulls them out of the matching
    // pool; only the long tier actually ends the session.
    for (const d of await repo.findStaleOnlineDrivers(IDLE_HEARTBEAT_PAUSE_SECONDS)) {
      await pauseAvailability(BigInt(d.driver_id))
    }
    for (const d of await repo.findStaleOnlineDrivers(IDLE_HEARTBEAT_OFFLINE_MINUTES * 60)) {
      await goOffline(BigInt(d.driver_id), 'stale_heartbeat')
      await notifyOwner({
        ownerType: 'driver',
        ownerId:   BigInt(d.driver_id),
        type:      'session_ended_stale',
        title:     'You went offline',
        body:      "We lost connection to your device and paused your online status. Tap Go Online to start again.",
        tag:       'session-status',
      }).catch((err: unknown) => log.error({ err, driverId: d.driver_id }, 'stale-offline notify failed'))
    }
  },
  { connection: redisConnection }
)

cleanupWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'cleanup job failed')
})
```

- [ ] **Step 2: Rename and extend the test file**

```bash
git mv api/tests/unit/jobs/cleanup-no-auto-cancel.test.ts api/tests/unit/jobs/cleanup-idle-heartbeat.test.ts
```

Add to it (same mock setup as Task 1, plus these additions):

```ts
// add to the existing vi.mock('@/modules/rides/rides.repository', ...) factory:
//   findStaleOnlineDrivers: vi.fn().mockResolvedValue([]),
// add to the existing vi.mock('@/modules/rides/rides.service', ...) factory:
//   pauseAvailability: vi.fn(),
//   goOffline:         vi.fn(),
// add a new mock:
//   vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: vi.fn().mockResolvedValue(undefined) }))

import { pauseAvailability, goOffline } from '@/modules/rides/rides.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'

describe('cleanup worker — idle heartbeat sweep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pauses a driver stale past the short tier without ending their session', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([])
    vi.mocked(repo.findStaleOnlineDrivers)
      .mockResolvedValueOnce([{ driver_id: '7' }] as never)  // short-tier call
      .mockResolvedValueOnce([] as never)                     // long-tier call

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(pauseAvailability).toHaveBeenCalledWith(BigInt(7))
    expect(goOffline).not.toHaveBeenCalled()
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('ends the session and notifies the driver once past the long tier', async () => {
    vi.mocked(repo.findStaleInProgressRides).mockResolvedValue([])
    vi.mocked(repo.findStaleOnlineDrivers)
      .mockResolvedValueOnce([{ driver_id: '7' }] as never)
      .mockResolvedValueOnce([{ driver_id: '7' }] as never)

    const { cleanupWorker } = await import('@/jobs/workers/cleanup.worker')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (cleanupWorker as any).__processor()

    expect(goOffline).toHaveBeenCalledWith(BigInt(7), 'stale_heartbeat')
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'driver',
      ownerId:   BigInt(7),
      type:      'session_ended_stale',
    }))
  })
})
```

(This requires updating the `bullmq` mock's `Worker` stub from Task 1 to also work here — it already does, no change needed since it's the same file/mock.)

- [ ] **Step 3: Run the full test file**

Run: `cd api && npx vitest run tests/unit/jobs/cleanup-idle-heartbeat.test.ts`
Expected: all 4 tests PASS (2 from Task 1 + 2 new).

- [ ] **Step 4: Commit**

```bash
git add api/src/jobs/workers/cleanup.worker.ts api/tests/unit/jobs/cleanup-idle-heartbeat.test.ts
git commit -m "feat(rides): add idle-driver heartbeat backstop sweep with driver notification"
```

---

### Task 6: Driver app — client API methods

**Files:**
- Modify: `apps/driver/src/lib/ride-api.ts` (add next to `goOffline`, ~line 118)

- [ ] **Step 1: Add `pause`/`resume`, fire-and-forget style matching `updateLocation`'s error swallowing**

```ts
  pause: async (): Promise<void> => {
    await api.post('/api/v1/rides/sessions/pause')
  },

  resume: async (): Promise<void> => {
    await api.post('/api/v1/rides/sessions/resume')
  },
```

- [ ] **Step 2: Commit**

```bash
git add apps/driver/src/lib/ride-api.ts
git commit -m "feat(driver): add pause/resume session API client methods"
```

---

### Task 7: Driver app — visibilitychange + pagehide wiring

> **Post-implementation note:** the `pagehide`/`sendBeacon` sub-step below was dropped during implementation — this app's driver auth is a Bearer JWT attached via an axios interceptor (not a cookie), and `sendBeacon` cannot set custom headers, so that call would 401 silently every time. The server-side idle-heartbeat backstop sweep (Task 5, 90s tier) already covers the tab-close case with zero client cooperation, so the dead code was removed rather than fixed. Only the `visibilitychange` effect was implemented. Don't reimplement the sendBeacon path from the text below without addressing the auth gap first.

**Files:**
- Modify: `apps/driver/src/App.tsx` (add a new effect near the existing wake-lock effect, ~line 297)

**UX requirement — must be completely silent for the common case:** no toast, no navigation, no visible state change when the tab backgrounds/foregrounds while idle. The driver should never perceive this happening. It must also never fire while a ride is active — `activeRide` already comes from `useRideStore`, imported at the top of `App.tsx`.

- [ ] **Step 1: Add the effect**

Insert after the existing wake-lock effect (`App.tsx:282-297`):

```tsx
  // Idle-driver availability follows tab visibility: pause matching the instant
  // the tab backgrounds (screen lock, app switch — the driver app is a browser
  // tab with no background-GPS capability, so this is the primary signal, not
  // just a nicety), resume the instant it's visible again. Silent both ways —
  // no toast, no navigation. Only applies while online with no active ride;
  // mid-trip visibility changes (screen off while driving) are left alone —
  // that's governed entirely by the server-side ride sweep, not this.
  useEffect(() => {
    if (!isOnline || activeRide) return
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        driverRideApi.pause().catch(() => {})
      } else {
        driverRideApi.resume().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [isOnline, activeRide])

  // Tab close / navigate away while idle-online: best-effort pause via
  // sendBeacon, the one API that reliably fires during unload where fetch is
  // not guaranteed to. No body needed — the endpoint reads driverId from the
  // auth cookie/header already attached by the browser for same-origin requests.
  useEffect(() => {
    if (!isOnline || activeRide) return
    const onPageHide = () => {
      navigator.sendBeacon('/api/v1/rides/sessions/pause')
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [isOnline, activeRide])
```

- [ ] **Step 2: Manual verification (no automated test — this is a thin browser-event wire-up, see Task 8 for why)**

Run the driver app locally (`cd apps/driver && pnpm dev`), go online with no active ride, open devtools:
1. Switch to a different browser tab → Network tab shows a `POST /sessions/pause` fire immediately.
2. Switch back → `POST /sessions/resume` fires immediately.
3. Accept a ride, then switch tabs → confirm neither call fires (guarded by `activeRide`).
4. Close the tab while online and idle → confirm (via server logs or a DB check on `driver_location_snapshots.is_available`) the beacon landed.

- [ ] **Step 3: Commit**

```bash
git add apps/driver/src/App.tsx
git commit -m "feat(driver): pause/resume matching-pool availability on tab visibility change"
```

---

### Task 8: Full verification pass

- [ ] **Step 1: Run the full API unit suite**

Run: `cd api && pnpm test`
Expected: all unit tests PASS (integration tests remain excluded per existing project convention — see CLAUDE.md's "Running Things" section).

- [ ] **Step 2: Typecheck all four packages**

Run: `cd api && npx tsc --noEmit`
Run: `cd apps/driver && npx tsc --noEmit` (or the package's existing typecheck script)
Expected: no errors.

- [ ] **Step 3: Manual end-to-end check of the removed auto-cancel**

Using a local driver + rider session: start a ride, then stop sending GPS pings (devtools → disable geolocation, or just background the tab) for >10 minutes. Confirm: the ride gets flagged (`review_flagged_at` set, `admin:ops` receives `ride:stuck_flagged`) but stays `in_progress` indefinitely — it must NOT flip to `cancelled` on its own no matter how long GPS silence continues.

- [ ] **Step 4: Commit any fixes found during verification, otherwise done**

---

## Self-Review

**Spec coverage:**
- Remove blind in-trip auto-cancel, keep the flag → Task 1. ✅
- Idle driver never goes offline until proven unreachable → Tasks 2-5. ✅
- Client-first (visibility-driven), server as backstop only → Task 4 (server primitives) + Task 7 (client, primary path) + Task 5 (server backstop sweep). ✅
- Never penalize/notify the driver for the common silent pause/resume path → Task 7 explicitly fires no toast/notification; only Task 5's long-tier force-offline notifies, once, via the existing notification pipeline. ✅
- Never hamper a driver mid-trip with either mechanism → both `pauseAvailability`/`resumeAvailability` (Task 4) and the client effects (Task 7) are guarded on `session.status === 'online'` / `!activeRide` respectively; the in-trip ride sweep (Task 1) is untouched except for deleting the harmful branch. ✅
- Premium UX: reuse the driver app's existing toast/notification system instead of inventing new UI → Task 5, `notifyOwner()`. ✅

**Placeholder scan:** no TBD/TODO, every step has real code, no "similar to Task N" hand-waving.

**Type consistency:** `driver_id`/`driverId` — repository functions take `bigint` and return `string` rows exactly matching the existing `findStaleInProgressRides` convention; service functions take `bigint`; routes convert via `req.driver!.id` (already `bigint`, matching every other route in the file). `setDriverAvailability(driverId: bigint, isAvailable: boolean)` signature is used identically in both `pauseAvailability` and `resumeAvailability`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-driver-heartbeat-offline.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
