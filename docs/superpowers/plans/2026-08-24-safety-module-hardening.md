# Safety Module Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four safety-module gaps from §03 of the 2026-08-24 security-hardening design: SOS/dispute IDOR (§03.1), SOS flood (§03.2), the dead driver-warnings feature (§03.3), and the missing SOS/dispute SLA escalation sweep (§03.4).

**Architecture:** A shared `assertRideParticipant` guard replaces three drifting inline ownership checks. SOS gets same-ride dedup plus a per-principal hourly Redis fixed-window counter (the exact §07 primitive already used for login OTP). Dispute resolution wires the `driver_warned`/`driver_suspended` outcomes to real `driver_warnings` rows and a `system_config`-driven auto-suspend. Two new BullMQ repeatable sweeps (in the existing `scheduler.worker.ts`) escalate stale SOS alerts and breached dispute SLAs to all admins, idempotently via a new `escalated_at` column on each table.

**Tech Stack:** Express + TypeScript, `pg` pool (raw SQL), ioredis (`client` from `@/db/redis`), BullMQ (`schedulerQueue`), Vitest with `@/`-alias module mocks.

---

## Conventions this plan follows (read before starting)

- **Errors:** the safety module throws `Object.assign(new Error(<message>), { httpStatus, code })`. There is **no `AppError` class** — the design doc's `AppError(...)` is shorthand; use the `Object.assign` form to match `sos.service.ts`/`disputes.service.ts`/`ratings.service.ts`.
- **BigInt columns:** `pg` returns `bigint` columns as JS `bigint` in this codebase's fetches, but ratings coerces defensively with `BigInt(...)`. The guard coerces the same way so it is safe against `string`/`number`/`bigint`.
- **Redis:** `import { client as redis } from '@/db/redis'`. Fixed-window counter shape: `redis.incr(key)`, and `if (n === 1) await redis.expire(key, seconds)`.
- **system_config:** `import { getConfigValue } from '@/lib/system-config'` → `getConfigValue(key, fallback): Promise<string>` (reads only `status='active'` rows).
- **Notifications:** `import { notifyOwner, notifyAllAdmins } from '@/modules/notifications/notifications.service'`. Do **not** invent a new channel.
- **Migrations:** filenames run in `.sort()` (alphabetical) order; highest existing is `090_*`. Apply with `cd api && pnpm migrate`. Unit tests mock `pool.query`, so they pass without the DB migration applied — migrate is a runtime step only.
- **Test run:** `cd api && npx vitest run <path>`. Full suite: `cd api && pnpm test`.
- **Scope guard:** touch **only** files under `api/src/modules/safety/`, `api/src/jobs/workers/scheduler.worker.ts`, new migration files, and new test files under `api/tests/unit/safety/`. Do **not** edit `server.ts`, `admin.repository.ts`, `notifications.service.ts`, or any file outside the safety module — those are shared with parallel plans. (The repeatable-job registration that would normally live in `server.ts` is deliberately placed in `scheduler.worker.ts` in Task D to respect this scope.)

---

## File Structure

**New files:**
- `api/src/modules/safety/safety.guards.ts` — `assertRideParticipant(ride, principal)`; the single ride-ownership rule for the whole safety module.
- `api/src/modules/safety/safety.sweeps.ts` — `sweepStaleSosAlerts()` / `sweepBreachedDisputeSlas()`; pure orchestration functions called by the scheduler worker (kept out of the worker file so they are unit-testable without importing BullMQ's `Worker`).
- `api/src/db/migrations/091_driver_warning_config.sql` — `system_config` seeds for warning-escalation policy.
- `api/src/db/migrations/092_safety_escalation_columns.sql` — `escalated_at` on `sos_alerts` and `disputes`.
- `api/tests/unit/safety/participant-guard.test.ts`
- `api/tests/unit/safety/create-dispute.test.ts`
- `api/tests/unit/safety/resolve-dispute-consequences.test.ts`
- `api/tests/unit/safety/safety-sweeps.test.ts`

**Modified files:**
- `api/src/modules/safety/sos.service.ts` — apply guard (A); dedup + hourly rate limit (B).
- `api/src/modules/safety/disputes.service.ts` — apply guard (A); warning/suspend consequences (C).
- `api/src/modules/safety/ratings.service.ts` — refactor inline ownership check to the shared guard (A).
- `api/src/modules/safety/safety.repository.ts` — new repo functions for B, C, D.
- `api/tests/unit/safety/trigger-sos.test.ts` — updated mocks + new cases (A, B).
- `api/src/jobs/workers/scheduler.worker.ts` — two new job branches + repeatable-job registration (D).

---

## Task A: Shared ride-participant guard (§03.1 IDOR)

**Files:**
- Create: `api/src/modules/safety/safety.guards.ts`
- Create: `api/tests/unit/safety/participant-guard.test.ts`
- Create: `api/tests/unit/safety/create-dispute.test.ts`
- Modify: `api/src/modules/safety/sos.service.ts`
- Modify: `api/src/modules/safety/disputes.service.ts`
- Modify: `api/src/modules/safety/ratings.service.ts`
- Modify: `api/tests/unit/safety/trigger-sos.test.ts`

- [ ] **Step 1: Write the failing guard test**

Create `api/tests/unit/safety/participant-guard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { assertRideParticipant } from '@/modules/safety/safety.guards'

describe('assertRideParticipant', () => {
  const ride = { user_id: 7n, driver_id: 42n }

  it('allows the ride rider', () => {
    expect(() => assertRideParticipant(ride, { role: 'user', id: 7n })).not.toThrow()
  })

  it('allows the ride driver', () => {
    expect(() => assertRideParticipant(ride, { role: 'driver', id: 42n })).not.toThrow()
  })

  it('rejects a different user with 403 NOT_RIDE_PARTICIPANT', () => {
    expect(() => assertRideParticipant(ride, { role: 'user', id: 8n }))
      .toThrowError(expect.objectContaining({ httpStatus: 403, code: 'NOT_RIDE_PARTICIPANT' }))
  })

  it('rejects a different driver with 403', () => {
    expect(() => assertRideParticipant(ride, { role: 'driver', id: 99n }))
      .toThrowError(expect.objectContaining({ httpStatus: 403, code: 'NOT_RIDE_PARTICIPANT' }))
  })

  it('rejects when the ride has no driver assigned and a driver claims it', () => {
    expect(() => assertRideParticipant({ user_id: 7n, driver_id: null }, { role: 'driver', id: 42n }))
      .toThrowError(expect.objectContaining({ httpStatus: 403 }))
  })

  it('coerces string/number ride ids (pg column shape) before comparing', () => {
    expect(() => assertRideParticipant({ user_id: '7', driver_id: 42 }, { role: 'user', id: 7n })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/unit/safety/participant-guard.test.ts`
Expected: FAIL — `Failed to resolve import "@/modules/safety/safety.guards"`.

- [ ] **Step 3: Create the guard**

Create `api/src/modules/safety/safety.guards.ts`:

```typescript
// The single ride-ownership rule for the safety module. SOS, disputes, and
// ratings all route their "is this caller party to this ride?" check through
// here so the three cannot drift (they did before — ratings enforced it,
// SOS/disputes did not: an IDOR gap, see 2026-08-24 hardening design §03.1).

export interface RideParties {
  user_id: bigint | number | string | null
  driver_id: bigint | number | string | null
}

export interface RidePrincipal {
  role: 'user' | 'driver'
  id: bigint
}

export function assertRideParticipant(ride: RideParties, principal: RidePrincipal): void {
  const isParticipant =
    (principal.role === 'user' && ride.user_id != null && BigInt(ride.user_id) === principal.id) ||
    (principal.role === 'driver' && ride.driver_id != null && BigInt(ride.driver_id) === principal.id)

  if (!isParticipant) {
    throw Object.assign(new Error('You are not a participant on this ride.'), {
      httpStatus: 403,
      code: 'NOT_RIDE_PARTICIPANT',
    })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run tests/unit/safety/participant-guard.test.ts`
Expected: PASS — 6 passed.

- [ ] **Step 5: Apply the guard in `triggerSos`**

In `api/src/modules/safety/sos.service.ts`, add the import at the top (below the existing imports):

```typescript
import { assertRideParticipant } from './safety.guards'
```

Then, inside `triggerSos`, insert the guard immediately after the existing status check (after the `if (ride.status !== 'in_progress' ...)` block, before `const alert = await repo.insertSosAlert(`):

```typescript
  const principal: { role: 'user' | 'driver'; id: bigint } =
    input.triggeredByUserId != null
      ? { role: 'user', id: input.triggeredByUserId }
      : { role: 'driver', id: input.triggeredByDriverId! }
  assertRideParticipant(ride, principal)
```

- [ ] **Step 6: Apply the guard in `createDispute`**

In `api/src/modules/safety/disputes.service.ts`, add the import at the top:

```typescript
import { assertRideParticipant } from './safety.guards'
```

Then, inside `createDispute`, insert the guard immediately after the existing `if (ride.status !== 'completed')` block, before `const slaHours = ...`:

```typescript
  const principal: { role: 'user' | 'driver'; id: bigint } =
    input.initiatedByUserId != null
      ? { role: 'user', id: input.initiatedByUserId }
      : { role: 'driver', id: input.initiatedByDriverId! }
  assertRideParticipant(ride, principal)
```

- [ ] **Step 7: Refactor `ratings.service.ts` onto the shared guard**

In `api/src/modules/safety/ratings.service.ts`, add the import at the top:

```typescript
import { assertRideParticipant } from './safety.guards'
```

Replace the entire inline ownership block (the `if (input.direction === 'user_to_driver') { ... } else { ... }` spanning lines ~23–33) with:

```typescript
  // Auth-presence check stays here (401 = no principal on the request);
  // the participant check itself is the shared guard (403).
  const principal: { role: 'user' | 'driver'; id: bigint } | null =
    input.direction === 'user_to_driver'
      ? (input.fromUserId ? { role: 'user', id: input.fromUserId } : null)
      : (input.fromDriverId ? { role: 'driver', id: input.fromDriverId } : null)
  if (!principal) {
    throw Object.assign(new Error('Auth required to submit a rating'), { httpStatus: 401 })
  }
  assertRideParticipant(ride, principal)
```

- [ ] **Step 8: Update `trigger-sos.test.ts` mocks so driver-triggered cases satisfy the guard**

In `api/tests/unit/safety/trigger-sos.test.ts`, the two driver-triggered cases mock a ride with no `driver_id`, which the new guard now rejects. Add `driver_id: 42n` to those two rides.

Change (the "accepts a driver-triggered SOS" case):

```typescript
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 7n } as never)
```
to:
```typescript
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 7n, driver_id: 42n } as never)
```

Change (the "skips the phone lookup ... when the ride has no user_id" case):

```typescript
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: null } as never)
```
to:
```typescript
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: null, driver_id: 42n } as never)
```

Then add `driver_id: 1n` to the remaining user-triggered `in_progress`/`driver_arrived`/`returning` mocks is **not** required (those pass a matching `triggeredByUserId: 1n` and `user_id: 1n`), but add this new IDOR test at the end of the `describe('triggerSos', ...)` block:

```typescript
  it('throws 403 NOT_RIDE_PARTICIPANT when the caller is not on the ride', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 7n, driver_id: 42n } as never)
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)

    await expect(triggerSos({ rideId: 5n, triggeredByUserId: 999n })).rejects.toMatchObject({
      httpStatus: 403, code: 'NOT_RIDE_PARTICIPANT',
    })
    expect(repo.insertSosAlert).not.toHaveBeenCalled()
  })
```

- [ ] **Step 9: Write the `createDispute` IDOR test**

Create `api/tests/unit/safety/create-dispute.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getRideBasic: vi.fn(),
  insertDispute: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('@/modules/geo/geo.service', () => ({ getRoute: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import { createDispute } from '@/modules/safety/disputes.service'

describe('createDispute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.insertDispute).mockResolvedValue({ id: 1n } as never)
  })

  const base = { rideId: 5n, type: 'fare', description: 'overcharged', initiator: 'user' as const }

  it('throws 404 when the ride does not exist', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue(null)
    await expect(createDispute({ ...base, initiatedByUserId: 7n })).rejects.toMatchObject({ httpStatus: 404 })
    expect(repo.insertDispute).not.toHaveBeenCalled()
  })

  it('throws 400 RIDE_NOT_COMPLETED for a non-completed ride', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 7n, driver_id: 42n } as never)
    await expect(createDispute({ ...base, initiatedByUserId: 7n })).rejects.toMatchObject({
      httpStatus: 400, code: 'RIDE_NOT_COMPLETED',
    })
    expect(repo.insertDispute).not.toHaveBeenCalled()
  })

  it('throws 403 NOT_RIDE_PARTICIPANT when the caller is not on the ride', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: 42n } as never)
    await expect(createDispute({ ...base, initiatedByUserId: 999n })).rejects.toMatchObject({
      httpStatus: 403, code: 'NOT_RIDE_PARTICIPANT',
    })
    expect(repo.insertDispute).not.toHaveBeenCalled()
  })

  it('creates the dispute for the ride rider', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: 42n } as never)
    const dispute = await createDispute({ ...base, initiatedByUserId: 7n })
    expect(dispute).toMatchObject({ id: 1n })
    expect(repo.insertDispute).toHaveBeenCalledWith(expect.objectContaining({ ride_id: 5n }))
  })
})
```

- [ ] **Step 10: Run all Task A tests to verify they pass**

Run: `cd api && npx vitest run tests/unit/safety/participant-guard.test.ts tests/unit/safety/create-dispute.test.ts tests/unit/safety/trigger-sos.test.ts`
Expected: PASS — all three files green (participant-guard 6, create-dispute 4, trigger-sos existing + 1 new IDOR case).

- [ ] **Step 11: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add api/src/modules/safety/safety.guards.ts api/src/modules/safety/sos.service.ts api/src/modules/safety/disputes.service.ts api/src/modules/safety/ratings.service.ts api/tests/unit/safety/participant-guard.test.ts api/tests/unit/safety/create-dispute.test.ts api/tests/unit/safety/trigger-sos.test.ts
git commit -m "fix(safety): shared assertRideParticipant guard on SOS/dispute/rating (IDOR)"
```

---

## Task B: SOS dedup + per-principal hourly rate limit (§03.2)

**Files:**
- Modify: `api/src/modules/safety/safety.repository.ts`
- Modify: `api/src/modules/safety/sos.service.ts`
- Modify: `api/tests/unit/safety/trigger-sos.test.ts`

- [ ] **Step 1: Add the dedup repo functions (write first, they're plain SQL)**

In `api/src/modules/safety/safety.repository.ts`, add these two functions in the `// ── SOS ──` section (after `insertSosAlert`):

```typescript
// Most-recent still-'triggered' alert for this ride created inside the dedup
// window — used to collapse repeat SOS presses into the existing alert instead
// of inserting a new row + re-paging admins.
export async function getActiveSosForRide(rideId: bigint, withinSeconds: number) {
  const res = await pool.query(
    `SELECT * FROM sos_alerts
     WHERE ride_id = $1
       AND status = 'triggered'
       AND created_at >= now() - make_interval(secs => $2)
     ORDER BY created_at DESC
     LIMIT 1`,
    [rideId, withinSeconds]
  )
  return res.rows[0] ?? null
}

// ponytail: "touch" reuses updated_at (bumped by the set_updated_at trigger on
// any UPDATE) rather than adding a dedicated last_triggered_at column — one
// fewer migration. Add the column only if ops needs to distinguish "first
// press" from "last press" time explicitly.
export async function touchSosAlert(id: bigint) {
  await pool.query(`UPDATE sos_alerts SET updated_at = now() WHERE id = $1`, [id])
}
```

- [ ] **Step 2: Write the failing dedup + rate-limit tests**

In `api/tests/unit/safety/trigger-sos.test.ts`, extend the mock block. Change the repository mock to include the two new functions, and add a redis mock. Update the top `vi.mock` calls:

```typescript
vi.mock('@/modules/safety/safety.repository', () => ({
  getRideBasic: vi.fn(),
  insertSosAlert: vi.fn(),
  markRideSosTriggered: vi.fn(),
  getActiveSosForRide: vi.fn(),
  touchSosAlert: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn(() => Promise.resolve()) } }))
vi.mock('@/websocket/socket.server', () => ({ getIO: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(), expire: vi.fn() } }))
```

Add the redis import alongside the others:

```typescript
import { client as redis } from '@/db/redis'
```

In `beforeEach`, add safe defaults so existing cases keep passing (no dedup hit, counter at 1):

```typescript
    vi.mocked(repo.getActiveSosForRide).mockResolvedValue(null)
    vi.mocked(redis.incr).mockResolvedValue(1 as never)
    vi.mocked(redis.expire).mockResolvedValue(1 as never)
```

Then add these new cases at the end of the `describe` block:

```typescript
  it('dedups a repeat SOS on the same ride within 30s: returns the existing alert, no new insert', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 1n, driver_id: 42n } as never)
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)
    vi.mocked(repo.getActiveSosForRide).mockResolvedValue({ id: 77n, severity: 'high' } as never)

    const alert = await triggerSos({ rideId: 5n, triggeredByUserId: 1n })

    expect(alert.id).toBe(77n)
    expect(repo.touchSosAlert).toHaveBeenCalledWith(77n)
    expect(repo.insertSosAlert).not.toHaveBeenCalled()
    expect(redis.incr).not.toHaveBeenCalled() // dedup path doesn't burn rate-limit budget
  })

  it('sets the hourly TTL on the first SOS of the window', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 1n, driver_id: 42n } as never)
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)
    vi.mocked(redis.incr).mockResolvedValue(1 as never)

    await triggerSos({ rideId: 5n, triggeredByUserId: 1n })

    expect(redis.incr).toHaveBeenCalledWith('sos:hourly:user:1')
    expect(redis.expire).toHaveBeenCalledWith('sos:hourly:user:1', 3600)
  })

  it('throws 429 SOS_RATE_LIMITED after 5 alerts in the hour', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 1n, driver_id: 42n } as never)
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)
    vi.mocked(redis.incr).mockResolvedValue(6 as never)

    await expect(triggerSos({ rideId: 5n, triggeredByUserId: 1n })).rejects.toMatchObject({
      httpStatus: 429, code: 'SOS_RATE_LIMITED',
    })
    expect(repo.insertSosAlert).not.toHaveBeenCalled()
    expect(redis.expire).not.toHaveBeenCalled() // count 6 !== 1, no TTL reset
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/unit/safety/trigger-sos.test.ts`
Expected: FAIL — the three new cases fail (`getActiveSosForRide`/`touchSosAlert`/`redis` not used by the service yet; dedup returns a new insert; no 429 thrown).

- [ ] **Step 4: Implement dedup + rate limit in `triggerSos`**

In `api/src/modules/safety/sos.service.ts`, add the redis import at the top:

```typescript
import { client as redis } from '@/db/redis'
```

Add these module-level constants below `const log = ...`:

```typescript
const SOS_DEDUP_WINDOW_SECONDS = 30
const SOS_HOURLY_CAP = 5
const SOS_HOURLY_WINDOW_SECONDS = 3600
```

Then, inside `triggerSos`, immediately after the `assertRideParticipant(ride, principal)` line added in Task A, insert:

```typescript
  // Dedup: a repeat press on the SAME ride inside the window collapses into the
  // existing alert — no new row, no re-page. Checked before the rate-limit
  // counter so a panicking rider mashing the button doesn't burn their budget.
  const existing = await repo.getActiveSosForRide(input.rideId, SOS_DEDUP_WINDOW_SECONDS)
  if (existing) {
    await repo.touchSosAlert(BigInt(existing.id))
    return existing
  }

  // Per-principal hourly fixed-window counter (§07 pattern — same shape as the
  // login-OTP limiter). Stops #03.1-enabled flooding across many rides, which
  // per-ride dedup alone can't. Five genuine SOS events/hour from one person is
  // already extreme and worth a human follow-up, not a real emergency we'd suppress.
  const rlKey = `sos:hourly:${principal.role}:${principal.id}`
  const count = await redis.incr(rlKey)
  if (count === 1) await redis.expire(rlKey, SOS_HOURLY_WINDOW_SECONDS)
  if (count > SOS_HOURLY_CAP) {
    throw Object.assign(new Error('Too many safety alerts. Contact support directly if this is urgent.'), {
      httpStatus: 429, code: 'SOS_RATE_LIMITED',
    })
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/unit/safety/trigger-sos.test.ts`
Expected: PASS — all cases green (existing + 3 new).

- [ ] **Step 6: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/safety/safety.repository.ts api/src/modules/safety/sos.service.ts api/tests/unit/safety/trigger-sos.test.ts
git commit -m "fix(safety): SOS same-ride dedup + per-principal hourly rate limit"
```

---

## Task C: Wire driver_warnings + auto-suspend (§03.3)

**Files:**
- Create: `api/src/db/migrations/091_driver_warning_config.sql`
- Modify: `api/src/modules/safety/safety.repository.ts`
- Modify: `api/src/modules/safety/disputes.service.ts`
- Create: `api/tests/unit/safety/resolve-dispute-consequences.test.ts`

- [ ] **Step 1: Write the config-seed migration**

Create `api/src/db/migrations/091_driver_warning_config.sql`:

```sql
-- §03.3: warning-escalation policy as system_config so ops can tune it live
-- (same mechanism as driver_minimum_balance / driver_payouts_enabled), no deploy.
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('driver_warning_suspend_threshold', '3',  'integer', 'Warnings within the rolling window that trigger auto-suspension'),
  ('driver_warning_window_days',       '90', 'integer', 'Rolling window (days) for warning-count escalation')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Add the warning repo functions**

In `api/src/modules/safety/safety.repository.ts`, add a new section after the `// ── DISPUTES ──` block (near `insertRefund`):

```typescript
// ── DRIVER WARNINGS (§03.3) ───────────────────────────────────────

// category/severity default to 'other'/'moderate' — a dispute-driven warning
// isn't classified by the enum's specific categories (late_arrival, speeding,
// …); those exist for admin-issued warnings. 'other' is the honest bucket here.
export async function insertDriverWarning(data: {
  driver_id:   bigint
  issued_by:   bigint
  description: string
  ride_id:     bigint | null
  dispute_id:  bigint
}) {
  const res = await pool.query(
    `INSERT INTO driver_warnings
       (driver_id, issued_by, category, severity, description, ride_id, dispute_id)
     VALUES ($1,$2,'other','moderate',$3,$4,$5)
     RETURNING *`,
    [data.driver_id, data.issued_by, data.description, data.ride_id, data.dispute_id]
  )
  return res.rows[0]
}

export async function countRecentDriverWarnings(driverId: bigint, sinceDays: number): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM driver_warnings
     WHERE driver_id = $1 AND created_at >= now() - make_interval(days => $2)`,
    [driverId, sinceDays]
  )
  return Number(res.rows[0]?.count ?? '0')
}

export async function getDriverStatus(driverId: bigint): Promise<string | null> {
  const res = await pool.query<{ status: string }>(
    `SELECT status FROM drivers WHERE id = $1`,
    [driverId]
  )
  return res.rows[0]?.status ?? null
}
```

- [ ] **Step 3: Write the failing consequences test**

Create `api/tests/unit/safety/resolve-dispute-consequences.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getRideBasic: vi.fn(),
  insertDriverWarning: vi.fn(),
  countRecentDriverWarnings: vi.fn(),
  getDriverStatus: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('@/modules/geo/geo.service', () => ({ getRoute: vi.fn() }))
vi.mock('@/modules/admin/admin.repository', () => ({ updateDriverStatus: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: vi.fn(), notifyAllAdmins: vi.fn() }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import * as adminRepo from '@/modules/admin/admin.repository'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { getConfigValue } from '@/lib/system-config'
import { applyDisputeOutcomeConsequences } from '@/modules/safety/disputes.service'

const dispute = { id: 1n, ride_id: 5n }

describe('applyDisputeOutcomeConsequences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: 42n } as never)
    vi.mocked(repo.getDriverStatus).mockResolvedValue('active')
    vi.mocked(getConfigValue).mockImplementation(async (key: string, fallback: string) => fallback)
  })

  it('does nothing for a non-driver outcome', async () => {
    await applyDisputeOutcomeConsequences(dispute, 'full_refund', 9n, 'refunded')
    expect(repo.insertDriverWarning).not.toHaveBeenCalled()
    expect(adminRepo.updateDriverStatus).not.toHaveBeenCalled()
  })

  it('inserts a warning on driver_warned and notifies the driver, no suspend below threshold', async () => {
    vi.mocked(repo.countRecentDriverWarnings).mockResolvedValue(2)
    await applyDisputeOutcomeConsequences(dispute, 'driver_warned', 9n, 'rude to rider')

    expect(repo.insertDriverWarning).toHaveBeenCalledWith(expect.objectContaining({
      driver_id: 42n, issued_by: 9n, dispute_id: 1n, ride_id: 5n, description: 'rude to rider',
    }))
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: 42n }))
    expect(adminRepo.updateDriverStatus).not.toHaveBeenCalled()
  })

  it('auto-suspends when warning count reaches the threshold', async () => {
    vi.mocked(repo.countRecentDriverWarnings).mockResolvedValue(3)
    await applyDisputeOutcomeConsequences(dispute, 'driver_warned', 9n, 'third strike')

    expect(adminRepo.updateDriverStatus).toHaveBeenCalledWith(
      42n, 9n, 'active', 'suspended', expect.stringContaining('warning'), undefined, null
    )
  })

  it('reads a custom threshold from system_config', async () => {
    vi.mocked(getConfigValue).mockImplementation(async (key: string) =>
      key === 'driver_warning_suspend_threshold' ? '2' : '90')
    vi.mocked(repo.countRecentDriverWarnings).mockResolvedValue(2)
    await applyDisputeOutcomeConsequences(dispute, 'driver_warned', 9n, 'second strike, tuned threshold')

    expect(adminRepo.updateDriverStatus).toHaveBeenCalled()
  })

  it('suspends directly on driver_suspended outcome', async () => {
    await applyDisputeOutcomeConsequences(dispute, 'driver_suspended', 9n, 'severe misconduct')
    expect(adminRepo.updateDriverStatus).toHaveBeenCalledWith(
      42n, 9n, 'active', 'suspended', 'severe misconduct', undefined, null
    )
    expect(repo.insertDriverWarning).not.toHaveBeenCalled()
  })

  it('no-ops when the ride has no driver assigned', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'completed', user_id: 7n, driver_id: null } as never)
    await applyDisputeOutcomeConsequences(dispute, 'driver_warned', 9n, 'no driver')
    expect(repo.insertDriverWarning).not.toHaveBeenCalled()
  })

  it('does not re-suspend an already-suspended driver', async () => {
    vi.mocked(repo.getDriverStatus).mockResolvedValue('suspended')
    await applyDisputeOutcomeConsequences(dispute, 'driver_suspended', 9n, 'already out')
    expect(adminRepo.updateDriverStatus).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/unit/safety/resolve-dispute-consequences.test.ts`
Expected: FAIL — `applyDisputeOutcomeConsequences` is not exported from `disputes.service`.

- [ ] **Step 5: Implement `applyDisputeOutcomeConsequences` and call it from `resolveDispute`**

In `api/src/modules/safety/disputes.service.ts`, add these imports at the top:

```typescript
import * as adminRepo from '@/modules/admin/admin.repository'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { getConfigValue } from '@/lib/system-config'
import type { DisputeOutcome } from './safety.types'
import type { DriverStatus } from '@/modules/admin/admin.types'
```

(`DisputeOutcome` is exported from `./safety.types`; `DriverStatus` is exported from `@/modules/admin/admin.types` — verified: `'pending_docs' | 'pending_approval' | 'active' | 'suspended' | 'banned' | 'docs_rejected'`.)

Add this exported function at the end of the file:

```typescript
// §03.3: turns the driver_warned / driver_suspended dispute outcomes into real
// consequences — a driver_warnings row and, past a system_config threshold, an
// auto-suspension through the existing admin driver-status-change path. Runs
// AFTER resolveDispute's transaction commits: a rolled-back resolution must not
// warn or suspend anyone. Its own failure is logged, not fatal, so a
// notification hiccup never un-resolves an already-resolved dispute.
export async function applyDisputeOutcomeConsequences(
  dispute: { id: bigint; ride_id: bigint },
  outcome: DisputeOutcome,
  adminId: bigint,
  note: string,
): Promise<void> {
  if (outcome !== 'driver_warned' && outcome !== 'driver_suspended') return

  const ride = await repo.getRideBasic(dispute.ride_id)
  const driverId = ride?.driver_id != null ? BigInt(ride.driver_id) : null
  if (driverId == null) return

  const suspend = async (reason: string): Promise<void> => {
    const current = await repo.getDriverStatus(driverId)
    if (!current || current === 'suspended' || current === 'banned') return
    await adminRepo.updateDriverStatus(driverId, adminId, current as DriverStatus, 'suspended', reason, undefined, null)
    await notifyOwner({
      ownerType: 'driver', ownerId: driverId, type: 'account_suspended',
      title: 'Account suspended', body: reason,
    })
  }

  if (outcome === 'driver_suspended') {
    await suspend(note)
    return
  }

  // outcome === 'driver_warned'
  await repo.insertDriverWarning({
    driver_id: driverId, issued_by: adminId, dispute_id: dispute.id,
    ride_id: ride?.id != null ? BigInt(ride.id) : null, description: note,
  })
  await notifyOwner({
    ownerType: 'driver', ownerId: driverId, type: 'driver_warning',
    title: 'You have received a warning', body: note,
  })

  const threshold = parseInt(await getConfigValue('driver_warning_suspend_threshold', '3'), 10)
  const windowDays = parseInt(await getConfigValue('driver_warning_window_days', '90'), 10)
  const recent = await repo.countRecentDriverWarnings(driverId, windowDays)
  if (recent >= threshold) {
    await suspend(`${recent} warning(s) in ${windowDays} days`)
  }
}
```

Then wire it into `resolveDispute`: change the final `return repo.getDisputeById(id)` to call the consequences function first. Replace:

```typescript
  return repo.getDisputeById(id)
}
```
with:
```typescript
  try {
    await applyDisputeOutcomeConsequences({ id, ride_id: dispute.ride_id }, input.outcome, input.adminId, input.note)
  } catch (err) {
    // Consequences run post-commit; the dispute is already resolved. A failure
    // here (e.g. notification outage) must not surface as a resolve failure.
    log.error({ err, disputeId: id }, 'applyDisputeOutcomeConsequences failed')
  }

  return repo.getDisputeById(id)
}
```

And add a module logger near the top of `disputes.service.ts` if one does not already exist:

```typescript
import { logger } from '@/lib/logger'
const log = logger.child({ module: 'disputes-service' })
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd api && npx vitest run tests/unit/safety/resolve-dispute-consequences.test.ts`
Expected: PASS — 7 passed.

- [ ] **Step 7: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Apply the migration (dev DB) and verify the seed**

Run: `cd api && pnpm migrate`
Expected: `091_driver_warning_config.sql` runs; output lists it as applied.

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT key, value FROM system_config WHERE key LIKE 'driver_warning%';"`
Expected: two rows — `driver_warning_suspend_threshold | 3` and `driver_warning_window_days | 90`.

- [ ] **Step 9: Commit**

```bash
git add api/src/db/migrations/091_driver_warning_config.sql api/src/modules/safety/safety.repository.ts api/src/modules/safety/disputes.service.ts api/tests/unit/safety/resolve-dispute-consequences.test.ts
git commit -m "feat(safety): wire driver_warnings + config-driven auto-suspend on dispute resolution"
```

---

## Task D: SOS/dispute SLA escalation sweeps (§03.4)

**Files:**
- Create: `api/src/db/migrations/092_safety_escalation_columns.sql`
- Modify: `api/src/modules/safety/safety.repository.ts`
- Create: `api/src/modules/safety/safety.sweeps.ts`
- Create: `api/tests/unit/safety/safety-sweeps.test.ts`
- Modify: `api/src/jobs/workers/scheduler.worker.ts`

- [ ] **Step 1: Write the escalation-column migration**

Create `api/src/db/migrations/092_safety_escalation_columns.sql`:

```sql
-- §03.4: escalated_at makes the SLA sweeps idempotent — once an alert/dispute
-- has been escalated to admins, the next sweep tick skips it (WHERE escalated_at
-- IS NULL) instead of re-paging every 5 minutes forever.
ALTER TABLE sos_alerts ADD COLUMN escalated_at TIMESTAMPTZ NULL;
ALTER TABLE disputes   ADD COLUMN escalated_at TIMESTAMPTZ NULL;
```

- [ ] **Step 2: Add the sweep repo functions**

In `api/src/modules/safety/safety.repository.ts`, add a new section at the end of the file:

```typescript
// ── SLA ESCALATION SWEEPS (§03.4) ─────────────────────────────────

// SOS alerts still 'triggered' (never acknowledged) past the staleness window
// and not yet escalated. Bounded by the sos_alerts_status_idx partial index.
export async function getStaleSosAlerts(olderThanMinutes: number) {
  const res = await pool.query<{ id: string; ride_id: string; created_at: Date }>(
    `SELECT id, ride_id, created_at
     FROM sos_alerts
     WHERE status = 'triggered'
       AND escalated_at IS NULL
       AND created_at < now() - make_interval(mins => $1)`,
    [olderThanMinutes]
  )
  return res.rows
}

export async function markSosEscalated(id: bigint) {
  await pool.query(`UPDATE sos_alerts SET escalated_at = now() WHERE id = $1`, [id])
}

// Disputes past their SLA deadline, not in a terminal state, not yet escalated.
export async function getBreachedDisputes() {
  const res = await pool.query<{ id: string }>(
    `SELECT id
     FROM disputes
     WHERE escalated_at IS NULL
       AND sla_due_at < now()
       AND status NOT IN ('resolved', 'withdrawn')`
  )
  return res.rows
}

export async function markDisputeSlaEscalated(id: bigint) {
  await pool.query(`UPDATE disputes SET escalated_at = now() WHERE id = $1`, [id])
}
```

- [ ] **Step 3: Write the failing sweep tests**

Create `api/tests/unit/safety/safety-sweeps.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getStaleSosAlerts: vi.fn(),
  markSosEscalated: vi.fn(),
  getBreachedDisputes: vi.fn(),
  markDisputeSlaEscalated: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyAllAdmins: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { sweepStaleSosAlerts, sweepBreachedDisputeSlas } from '@/modules/safety/safety.sweeps'

describe('sweepStaleSosAlerts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('notifies admins once per stale alert and marks each escalated', async () => {
    vi.mocked(repo.getStaleSosAlerts).mockResolvedValue([
      { id: '10', ride_id: '5', created_at: new Date('2026-08-24T10:00:00Z') },
      { id: '11', ride_id: '6', created_at: new Date('2026-08-24T10:01:00Z') },
    ] as never)

    await sweepStaleSosAlerts()

    expect(repo.getStaleSosAlerts).toHaveBeenCalledWith(5)
    expect(notifyAllAdmins).toHaveBeenCalledTimes(2)
    expect(notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'sos_unacknowledged', rideId: 5n }))
    expect(repo.markSosEscalated).toHaveBeenCalledWith(10n)
    expect(repo.markSosEscalated).toHaveBeenCalledWith(11n)
  })

  it('does nothing when there are no stale alerts', async () => {
    vi.mocked(repo.getStaleSosAlerts).mockResolvedValue([] as never)
    await sweepStaleSosAlerts()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
    expect(repo.markSosEscalated).not.toHaveBeenCalled()
  })
})

describe('sweepBreachedDisputeSlas', () => {
  beforeEach(() => vi.clearAllMocks())

  it('notifies admins once per breached dispute and marks each escalated', async () => {
    vi.mocked(repo.getBreachedDisputes).mockResolvedValue([{ id: '3' }, { id: '4' }] as never)

    await sweepBreachedDisputeSlas()

    expect(notifyAllAdmins).toHaveBeenCalledTimes(2)
    expect(notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'dispute_sla_breached' }))
    expect(repo.markDisputeSlaEscalated).toHaveBeenCalledWith(3n)
    expect(repo.markDisputeSlaEscalated).toHaveBeenCalledWith(4n)
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/unit/safety/safety-sweeps.test.ts`
Expected: FAIL — `Failed to resolve import "@/modules/safety/safety.sweeps"`.

- [ ] **Step 5: Create the sweep module**

Create `api/src/modules/safety/safety.sweeps.ts`:

```typescript
import * as repo from './safety.repository'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'safety-sweeps' })

const SOS_STALE_MINUTES = 5

// §03.4: SOS alerts triggered but never acknowledged for 5+ minutes get pushed
// to every admin (in-app + push + socket via notifyAllAdmins) — a durable
// escalation that doesn't depend on an admin socket being connected at trigger
// time. escalated_at makes it fire once, not every tick.
export async function sweepStaleSosAlerts(): Promise<void> {
  const stale = await repo.getStaleSosAlerts(SOS_STALE_MINUTES)
  for (const alert of stale) {
    try {
      await notifyAllAdmins({
        type: 'sos_unacknowledged',
        title: 'SOS alert unacknowledged for 5+ minutes',
        body: `Ride ${alert.ride_id} — SOS triggered ${new Date(alert.created_at).toISOString()}`,
        rideId: BigInt(alert.ride_id),
      })
      await repo.markSosEscalated(BigInt(alert.id))
    } catch (err) {
      // One bad alert must not abort the rest of the sweep; the next tick retries
      // it (escalated_at still NULL).
      log.error({ err, alertId: alert.id }, 'failed to escalate stale SOS alert')
    }
  }
}

// §03.4: disputes past sla_due_at, not resolved, escalated to all admins once.
export async function sweepBreachedDisputeSlas(): Promise<void> {
  const breached = await repo.getBreachedDisputes()
  for (const dispute of breached) {
    try {
      await notifyAllAdmins({
        type: 'dispute_sla_breached',
        title: 'Dispute SLA breached',
        body: `Dispute ${dispute.id} has passed its SLA deadline`,
      })
      await repo.markDisputeSlaEscalated(BigInt(dispute.id))
    } catch (err) {
      log.error({ err, disputeId: dispute.id }, 'failed to escalate breached dispute SLA')
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/unit/safety/safety-sweeps.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 7: Wire the sweeps into the scheduler worker + register the repeatable jobs**

In `api/src/jobs/workers/scheduler.worker.ts`:

Add the imports below the existing imports:

```typescript
import { schedulerQueue } from '@/jobs/queues'
import { sweepStaleSosAlerts, sweepBreachedDisputeSlas } from '@/modules/safety/safety.sweeps'
```

Add two job branches inside the worker's handler, after the existing `if (job.name === 'sweep_document_expiry') { ... }` block:

```typescript
    if (job.name === 'sweep_stale_sos') {
      await sweepStaleSosAlerts()
      return
    }

    if (job.name === 'sweep_dispute_sla') {
      await sweepBreachedDisputeSlas()
      return
    }
```

Then register the two repeatable jobs at the bottom of the file (after `schedulerWorker.on('failed', ...)`). Registration lives here rather than in `server.ts` to keep this plan within its file scope; `server.ts` already imports `schedulerWorker`, so importing this module triggers registration. BullMQ repeatable jobs are keyed by name+options, so re-import does not duplicate them:

```typescript
// §03.4: register the two safety SLA sweeps on the same 5-minute cadence the
// call-masking mask sweep uses. Kept in this file (not server.ts) to stay within
// the safety-hardening plan's file scope; move alongside the other server.ts
// registrations later if the team prefers them centralized.
void schedulerQueue.add(
  'sweep_stale_sos',
  {},
  { repeat: { every: 5 * 60 * 1000 }, removeOnComplete: true, removeOnFail: true }
)
void schedulerQueue.add(
  'sweep_dispute_sla',
  {},
  { repeat: { every: 5 * 60 * 1000 }, removeOnComplete: true, removeOnFail: true }
)
```

- [ ] **Step 8: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Apply the migration (dev DB) and verify the columns**

Run: `cd api && pnpm migrate`
Expected: `092_safety_escalation_columns.sql` runs.

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "\d sos_alerts" | grep escalated_at`
Expected: `escalated_at | timestamp with time zone`.

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "\d disputes" | grep escalated_at`
Expected: `escalated_at | timestamp with time zone`.

- [ ] **Step 10: Run the full safety test suite**

Run: `cd api && npx vitest run tests/unit/safety`
Expected: PASS — participant-guard, create-dispute, trigger-sos, resolve-dispute-consequences, safety-sweeps all green.

- [ ] **Step 11: Commit**

```bash
git add api/src/db/migrations/092_safety_escalation_columns.sql api/src/modules/safety/safety.repository.ts api/src/modules/safety/safety.sweeps.ts api/tests/unit/safety/safety-sweeps.test.ts api/src/jobs/workers/scheduler.worker.ts
git commit -m "feat(safety): BullMQ sweeps to escalate stale SOS alerts and breached dispute SLAs"
```

---

## Final verification

- [ ] **Run the whole safety suite + typecheck together**

Run: `cd api && npx vitest run tests/unit/safety && npx tsc --noEmit`
Expected: all safety tests pass; no type errors.

- [ ] **Update the graph**

Run: `graphify update .`

---

## Self-Review (completed by plan author)

**1. Spec coverage (§03 + §07):**
- §03.1 IDOR → Task A (guard + applied in `triggerSos`/`createDispute`, `ratings.service` refactored onto it). ✅
- §03.2 SOS flood → Task B (30s same-ride dedup + per-principal hourly Redis counter, cap 5 → 429). ✅
- §03.3 dead warnings → Task C (insert `driver_warnings` on `driver_warned`, config-driven count + auto-suspend via existing `adminRepo.updateDriverStatus`; `driver_suspended` handled directly; `system_config` seeds in migration 091). ✅
- §03.4 no sweep → Task D (two BullMQ repeatable sweeps in `scheduler.worker.ts`, `escalated_at` columns for idempotency in migration 092, `notifyAllAdmins` reused). ✅
- §07.1 fixed-window Redis counter → Task B uses the exact `incr`/`expire`-on-first shape. ✅
- §07.4 `system_config`-driven thresholds → Task C reads `driver_warning_suspend_threshold`/`driver_warning_window_days` live via `getConfigValue`. ✅

**2. Placeholder scan:** No TBD/"handle edge cases"/"similar to". Every code + test step is complete. ✅

**3. Type consistency:** `assertRideParticipant(ride, principal)` signature identical across all call sites (`{ role, id: bigint }`). Repo functions referenced in services/tests match their definitions: `getActiveSosForRide`, `touchSosAlert`, `insertDriverWarning`, `countRecentDriverWarnings`, `getDriverStatus`, `getStaleSosAlerts`, `markSosEscalated`, `getBreachedDisputes`, `markDisputeSlaEscalated`. `applyDisputeOutcomeConsequences(dispute, outcome, adminId, note)` arg order matches its test. `adminRepo.updateDriverStatus(driverId, adminId, fromStatus, toStatus, reason, undefined, null)` matches the real 7-arg signature in `admin.repository.ts`.

**Deviations from the design doc, and why:**
- Design uses `AppError('CODE', status, msg)`; real codebase has no such class — used the `Object.assign(new Error(msg), { httpStatus, code })` form the safety module already uses.
- Design's `touchSosAlert` bumps a `last_triggered_at` column; reused `updated_at` (already trigger-maintained) to avoid a needless column/migration — flagged with a `ponytail:` comment and an upgrade note.
- Sweep repeatable-job registration placed in `scheduler.worker.ts` rather than `server.ts` to honor the plan's exclusive file scope (server.ts is shared with parallel plans); noted inline with a move-later comment.
- `driver_warnings.category/severity` set to `'other'/'moderate'` (valid enum members) since dispute-driven warnings don't map to the specific admin-issued categories.
