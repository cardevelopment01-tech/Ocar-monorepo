# Ride OTP Brute-Force Protection & Driver Ride-Action Authorization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two ride-lifecycle security gaps from §01 of the 2026-08-24 hardening design: (A) ride OTP verification has no attempt limit or lockout, and its audit trail hardcodes `attempt_number: 1`; (B) `markArrived`/`verifyStartOTP`/`verifyEndOTP` never check the caller owns the ride (IDOR).

**Architecture:** (A) Add a fixed-window Redis counter primitive to `api/src/lib/otp.ts` (`checkRideOtpAttempts`/`clearRideOtpAttempts`) — the same `INCR` + `EXPIRE`-on-first shape `checkRateLimit` already uses — and wire it into both verify functions, using the returned attempt count for the audit insert. (B) Extract the shared `getRideById` SELECT into a reusable SQL fragment, add `getRideForDriverAction(rideId, driverId)` scoped by both columns, switch all three driver-action functions to it (a wrong/absent driver becomes a missing row → the existing 404 path), and keep an explicit belt-and-suspenders 403 guard matching the sibling functions (`startReturn`, `cancelRideAsDriver`, `collectCash`).

**Tech Stack:** TypeScript 5, Express, `pg`, `ioredis`, Vitest (`vi.mock`), path alias `@/` → `api/src`.

**Error convention (this codebase has NO `AppError` class):** throw via either `httpError(status, message, appCode)` from `@/lib/errors`, or inline `Object.assign(new Error(msg), { httpStatus })`. Match the local style of each function being edited. The design doc's `AppError(...)` is illustrative pseudocode only.

**Run all commands from the `api/` directory** unless stated otherwise. Test runner is `npx vitest run <path>`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `api/src/constants/limits.ts` | OTP/ride tunables | Add `RIDE_OTP_MAX_ATTEMPTS`, `RIDE_OTP_LOCKOUT_SECONDS` |
| `api/src/lib/otp.ts` | OTP generate/hash/attempt-limit primitives | Add `checkRideOtpAttempts`, `clearRideOtpAttempts` |
| `api/src/modules/rides/rides.repository.ts` | Ride DB access | Extract `RIDE_SELECT_SQL`; add `getRideForDriverAction` |
| `api/src/modules/rides/rides.service.ts` | Ride lifecycle | Ownership + attempt-limit wiring in `markArrived`/`verifyStartOTP`/`verifyEndOTP`; real `attempt_number` |
| `api/tests/unit/lib/ride-otp-attempts.test.ts` | New | Task 1 tests |
| `api/tests/unit/rides/get-ride-for-driver-action.test.ts` | New | Task 2 tests |
| `api/tests/unit/rides/mark-arrived-ownership.test.ts` | New | Task 3 tests |
| `api/tests/unit/rides/verify-start-otp.test.ts` | New | Task 3 + Task 4 tests |
| `api/tests/unit/rides/verify-end-otp-pending-stops.test.ts` | Modify | Update mocks (Task 3 + Task 4) |
| `api/tests/unit/rides/completion-payment-branch.test.ts` | Modify | Update mocks (Task 3 + Task 4) |

---

## Task 1: Ride OTP attempt-limiting primitive (`otp.ts`)

**Files:**
- Modify: `api/src/constants/limits.ts` (after line 7)
- Modify: `api/src/lib/otp.ts` (imports at top; new exports at end)
- Test: `api/tests/unit/lib/ride-otp-attempts.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/lib/ride-otp-attempts.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(), expire: vi.fn(), del: vi.fn() } }))

import { client as redis } from '@/db/redis'
import { checkRideOtpAttempts, clearRideOtpAttempts } from '@/lib/otp'

describe('checkRideOtpAttempts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets a 15-minute TTL on the first attempt and returns 1', async () => {
    vi.mocked(redis.incr).mockResolvedValue(1)
    const n = await checkRideOtpAttempts(BigInt(303), 'start')
    expect(n).toBe(1)
    expect(redis.incr).toHaveBeenCalledWith('ride:otp:attempts:303:start')
    expect(redis.expire).toHaveBeenCalledWith('ride:otp:attempts:303:start', 15 * 60)
  })

  it('does NOT reset the TTL on subsequent attempts and returns the count', async () => {
    vi.mocked(redis.incr).mockResolvedValue(3)
    const n = await checkRideOtpAttempts(BigInt(303), 'end')
    expect(n).toBe(3)
    expect(redis.incr).toHaveBeenCalledWith('ride:otp:attempts:303:end')
    expect(redis.expire).not.toHaveBeenCalled()
  })

  it('throws a 429 RIDE_OTP_LOCKED once the count exceeds the max (5)', async () => {
    vi.mocked(redis.incr).mockResolvedValue(6)
    await expect(checkRideOtpAttempts(BigInt(303), 'start')).rejects.toMatchObject({
      httpStatus: 429,
      appCode: 'RIDE_OTP_LOCKED',
    })
  })

  it('allows exactly the max attempts (5) without throwing', async () => {
    vi.mocked(redis.incr).mockResolvedValue(5)
    await expect(checkRideOtpAttempts(BigInt(303), 'start')).resolves.toBe(5)
  })
})

describe('clearRideOtpAttempts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the per-ride, per-type counter key', async () => {
    await clearRideOtpAttempts(BigInt(303), 'end')
    expect(redis.del).toHaveBeenCalledWith('ride:otp:attempts:303:end')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/ride-otp-attempts.test.ts`
Expected: FAIL — `checkRideOtpAttempts`/`clearRideOtpAttempts` are not exported from `@/lib/otp` (import resolves to `undefined`, call throws `TypeError: ... is not a function`).

- [ ] **Step 3: Add the two constants**

In `api/src/constants/limits.ts`, immediately after line 7 (`export const OTP_RATE_LIMIT_MAX_REQUESTS = 10`), add:

```typescript
// Ride OTP (4-digit, DB-stored) brute-force protection. Independent of the
// login-OTP limiter (OTP_MAX_ATTEMPTS) — only the attempt COUNTER lives in
// Redis; the OTP hash itself stays in rides.start_otp_hash/end_otp_hash.
export const RIDE_OTP_MAX_ATTEMPTS = 5
export const RIDE_OTP_LOCKOUT_SECONDS = 15 * 60
```

- [ ] **Step 4: Add the primitive functions**

In `api/src/lib/otp.ts`, extend the constants import (currently lines 3–10) to also pull the two new constants — change:

```typescript
import {
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_LOCK_DURATION_MINUTES,
  OTP_RATE_LIMIT_WINDOW_MINUTES,
  OTP_RATE_LIMIT_MAX_REQUESTS,
} from '@/constants/limits'
```

to:

```typescript
import {
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  OTP_LOCK_DURATION_MINUTES,
  OTP_RATE_LIMIT_WINDOW_MINUTES,
  OTP_RATE_LIMIT_MAX_REQUESTS,
  RIDE_OTP_MAX_ATTEMPTS,
  RIDE_OTP_LOCKOUT_SECONDS,
} from '@/constants/limits'
```

Add an `httpError` import directly below the existing `import { sha256 } from '@/lib/hash'` line (currently line 11):

```typescript
import { httpError } from '@/lib/errors'
```

Then append to the END of `api/src/lib/otp.ts` (after the existing `checkRateLimit` function):

```typescript
// Ride OTP brute-force limiter. Same fixed-window-counter shape as
// checkRateLimit above (INCR, EXPIRE only on the first increment) — one mental
// model for "OTP attempt limiting" in this codebase. Unlike consumeOtp this
// only tracks the COUNTER; the OTP hash stays in the rides row. Returns the
// current attempt number so callers can record a truthful attempt_number in
// ride_otp_events instead of a hardcoded 1.
export async function checkRideOtpAttempts(
  rideId: bigint,
  otpType: 'start' | 'end'
): Promise<number> {
  const key = `ride:otp:attempts:${rideId}:${otpType}`
  const attempts = await redis.incr(key)
  if (attempts === 1) await redis.expire(key, RIDE_OTP_LOCKOUT_SECONDS)
  if (attempts > RIDE_OTP_MAX_ATTEMPTS) {
    throw httpError(429, 'Too many incorrect attempts. Try again later.', 'RIDE_OTP_LOCKED')
  }
  return attempts
}

export async function clearRideOtpAttempts(
  rideId: bigint,
  otpType: 'start' | 'end'
): Promise<void> {
  await redis.del(`ride:otp:attempts:${rideId}:${otpType}`)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/ride-otp-attempts.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add api/src/constants/limits.ts api/src/lib/otp.ts api/tests/unit/lib/ride-otp-attempts.test.ts
git commit -m "feat(otp): add Redis-backed ride OTP attempt limiter"
```

---

## Task 2: Owner-scoped ride fetch (`rides.repository.ts`)

Extract the shared SELECT so `getRideForDriverAction` returns the exact same computed columns (`origin_lat`, `dest_lat`, fare fields, etc.) as `getRideById` — do NOT write a `SELECT *`.

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts:544-594` (`getRideById`)
- Test: `api/tests/unit/rides/get-ride-for-driver-action.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/rides/get-ride-for-driver-action.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { getRideForDriverAction } from '@/modules/rides/rides.repository'

describe('getRideForDriverAction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('scopes the query by BOTH ride id and driver id', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: BigInt(101) }], rowCount: 1 } as never)

    await getRideForDriverAction(BigInt(101), BigInt(9))

    const [sql, params] = vi.mocked(pool.query).mock.calls[0]!
    expect(sql).toContain('r.driver_id = $2')
    expect(sql).toContain('WHERE r.id = $1')
    expect(params).toEqual([BigInt(101), BigInt(9)])
  })

  it('keeps the computed origin/destination columns from the shared SELECT', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)

    await getRideForDriverAction(BigInt(101), BigInt(9))

    const [sql] = vi.mocked(pool.query).mock.calls[0]!
    expect(sql).toContain('AS origin_lat')
    expect(sql).toContain('AS dest_lat')
    expect(sql).toContain('fs.total_estimated')
  })

  it('returns null when no row matches (wrong driver or unknown ride)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    const result = await getRideForDriverAction(BigInt(101), BigInt(9))
    expect(result).toBeNull()
  })

  it('returns the row when it matches', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: BigInt(101), driver_id: 9 }], rowCount: 1 } as never)
    const result = await getRideForDriverAction(BigInt(101), BigInt(9))
    expect(result).toMatchObject({ id: BigInt(101) })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/rides/get-ride-for-driver-action.test.ts`
Expected: FAIL — `getRideForDriverAction` is not exported (import is `undefined`).

- [ ] **Step 3: Extract the shared SELECT and add the new function**

In `api/src/modules/rides/rides.repository.ts`, replace the entire `getRideById` function (currently lines 544–594) with the following. This lifts the SELECT/FROM/JOIN body verbatim into `RIDE_SELECT_SQL` (no WHERE clause) so both functions share it:

```typescript
// Shared column list + joins for a fully-hydrated ride row. Both getRideById
// and getRideForDriverAction append their own WHERE clause to this so the two
// return identical computed columns (origin_lat, dest_lat, fare fields, ...).
const RIDE_SELECT_SQL = `SELECT
       r.*,
       ST_Y(r.origin::geometry)      AS origin_lat,
       ST_X(r.origin::geometry)      AS origin_lng,
       ST_Y(r.destination::geometry) AS dest_lat,
       ST_X(r.destination::geometry) AS dest_lng,
       u.phone      AS user_phone,
       u.name       AS user_name,
       u.rating_avg AS user_rating,
       d.full_name  AS driver_name,
       d.phone      AS driver_phone,
       d.rating_avg           AS driver_rating,
       d.reference_selfie_url AS driver_photo,
       fs.total_estimated,
       fs.total_final, fs.base_fare, fs.distance_fare, fs.time_fare, fs.stop_fare,
       fs.hour_surcharge, fs.overage_fare, fs.surge_fare, fs.surge_multiplier,
       fs.actual_km, fs.actual_min,
       rc.reason      AS cancellation_reason,
       rc.reason_code AS cancellation_reason_code,
       ur.score AS user_rating_given,
       dv.number_plate  AS vehicle_number_plate,
       dv.color         AS vehicle_color,
       dv.vehicle_name  AS vehicle_name,
       vm.name          AS vehicle_model,
       vb.name          AS vehicle_brand,
       bvc.display_name AS booked_category_name,
       avc.display_name AS assigned_category_name,
       ST_Y(dls.location::geometry) AS driver_current_lat,
       ST_X(dls.location::geometry) AS driver_current_lng,
       p.status AS payment_status,
       p.commission_percent, p.commission_amount, p.driver_earning
     FROM rides r
     LEFT JOIN users u             ON u.id = r.user_id
     LEFT JOIN drivers d           ON d.id = r.driver_id
     LEFT JOIN fare_snapshots fs   ON fs.ride_id = r.id
     LEFT JOIN ride_cancellations rc ON rc.ride_id = r.id
     LEFT JOIN ratings ur ON ur.ride_id = r.id AND ur.direction = 'user_to_driver'
     LEFT JOIN driver_vehicles dv  ON dv.driver_id = r.driver_id AND dv.is_primary = true AND dv.status != 'blacklisted'
     LEFT JOIN vehicle_models vm   ON vm.id = dv.model_id
     LEFT JOIN vehicle_brands vb   ON vb.id = dv.brand_id
     LEFT JOIN vehicle_categories bvc ON bvc.id = r.category_id
     LEFT JOIN vehicle_categories avc ON avc.id = dv.category_id
     LEFT JOIN driver_location_snapshots dls ON dls.driver_id = r.driver_id
     LEFT JOIN payments p          ON p.ride_id = r.id`

export async function getRideById(rideId: bigint): Promise<Ride | null> {
  const res = await pool.query<Ride>(`${RIDE_SELECT_SQL} WHERE r.id = $1`, [rideId])
  return res.rows[0] ?? null
}

// Fail-closed-by-construction ownership: scoping the fetch by (id, driver_id)
// makes "not your ride" indistinguishable from "no such ride" — a missing
// ownership check becomes a missing row (existing 404 path) instead of a silent
// IDOR. Used by every driver-scoped ride-action service function.
export async function getRideForDriverAction(
  rideId: bigint,
  driverId: bigint
): Promise<Ride | null> {
  const res = await pool.query<Ride>(
    `${RIDE_SELECT_SQL} WHERE r.id = $1 AND r.driver_id = $2`,
    [rideId, driverId]
  )
  return res.rows[0] ?? null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/rides/get-ride-for-driver-action.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Confirm `getRideById` behaviour is unchanged**

Run: `npx vitest run tests/unit/rides/rides.repository.test.ts`
Expected: PASS (existing `getGpsTrackedDistanceKm` tests unaffected).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/tests/unit/rides/get-ride-for-driver-action.test.ts
git commit -m "feat(rides): add owner-scoped getRideForDriverAction repository fn"
```

---

## Task 3: Ownership enforcement on the three driver-action functions

Switch `markArrived`, `verifyStartOTP`, `verifyEndOTP` to `getRideForDriverAction` (structural fix) and keep an explicit 403 guard right after the fetch (belt-and-suspenders, matching `startReturn`/`cancelRideAsDriver`/`collectCash`).

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` — `markArrived` (~745), `verifyStartOTP` (~814), `verifyEndOTP` (~1669)
- Modify: `api/tests/unit/rides/verify-end-otp-pending-stops.test.ts` (mocks)
- Modify: `api/tests/unit/rides/completion-payment-branch.test.ts` (mocks)
- Test: `api/tests/unit/rides/mark-arrived-ownership.test.ts` (create)
- Test: `api/tests/unit/rides/verify-start-otp.test.ts` (create)

### Sub-part 3a — `markArrived`

Note: `markArrived` currently fetches the ride only at the END (to read `user_id` for the rider emit) and never checks ownership. Move that fetch to the TOP as an owner-scoped fetch and reuse the row.

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/rides/mark-arrived-ownership.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'HASH') }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendUserUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideForDriverAction: vi.fn(),
  updateRideStatus:       vi.fn().mockResolvedValue(undefined),
  logStatusHistory:       vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
  confirmRidePayment: vi.fn(), payFromUserWallet: vi.fn(), createRidePaymentOrder: vi.fn(),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(), notifyOwner: vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { markArrived } from '@/modules/rides/rides.service'

describe('markArrived — ownership', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws 404 when the ride is not assigned to this driver (owner-scoped fetch returns null)', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(null)
    await expect(markArrived(BigInt(9), BigInt(101))).rejects.toMatchObject({ httpStatus: 404 })
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })

  it('throws 403 (defense-in-depth guard) if a mismatched-driver row is somehow returned', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue({ id: BigInt(101), driver_id: 999, user_id: 42 } as never)
    await expect(markArrived(BigInt(9), BigInt(101))).rejects.toMatchObject({ httpStatus: 403 })
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })

  it('proceeds for the owning driver', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue({ id: BigInt(101), driver_id: 9, user_id: 42 } as never)
    const res = await markArrived(BigInt(9), BigInt(101))
    expect(res).toEqual({ success: true })
    expect(repo.updateRideStatus).toHaveBeenCalledWith(BigInt(101), 'driver_arrived', expect.anything())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/rides/mark-arrived-ownership.test.ts`
Expected: FAIL — `markArrived` still calls `repo.getRideById` (not mocked here → `undefined`), and has no ownership guard, so the 404/403 tests fail.

- [ ] **Step 3: Rewrite `markArrived` to fetch owner-scoped at the top**

In `api/src/modules/rides/rides.service.ts`, replace the `markArrived` function (currently lines 745–778) with:

```typescript
export async function markArrived(driverId: bigint, rideId: bigint) {
  const ride = await repo.getRideForDriverAction(rideId, driverId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!ride.driver_id || BigInt(ride.driver_id) !== driverId) {
    throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  }

  const otp  = generateOtp(RIDE_OTP_LENGTH)
  const hash = hashOtp(otp)

  await repo.updateRideStatus(rideId, 'driver_arrived', {
    driver_arrived_at: new Date().toISOString(),
    start_otp_hash:    hash,
  })

  await repo.logStatusHistory({
    rideId,
    fromStatus: 'accepted',
    toStatus:   'driver_arrived',
    actor:      'driver',
    actorId:    driverId,
  })

  await redis.set(startOtpKey(rideId.toString()), otp, 'EX', 7200)

  socketEvents.sendRideStatusUpdate(rideId.toString(), {
    status: 'driver_arrived',
  })

  // Rider-only channel: the OTP must never reach the driver's socket.
  socketEvents.sendUserUpdate(ride.user_id.toString(), {
    status:   'driver_arrived',
    startOtp: otp,
  })

  return { success: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/rides/mark-arrived-ownership.test.ts`
Expected: PASS (3 tests).

### Sub-part 3b — `verifyStartOTP`

- [ ] **Step 5: Write the failing test**

Create `api/tests/unit/rides/verify-start-otp.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '5678'),
  hashOtp: vi.fn((v: string) => (v === '1234' ? 'HASH' : 'WRONG')),
  checkRideOtpAttempts: vi.fn().mockResolvedValue(1),
  clearRideOtpAttempts: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendUserUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideForDriverAction: vi.fn(),
  updateRideStatus:       vi.fn().mockResolvedValue(undefined),
  logStatusHistory:       vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
  confirmRidePayment: vi.fn(), payFromUserWallet: vi.fn(), createRidePaymentOrder: vi.fn(),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(), notifyOwner: vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { pool } from '@/db/client'
import { verifyStartOTP } from '@/modules/rides/rides.service'

function baseRide(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(303), driver_id: 9, user_id: 42, status: 'driver_arrived',
    start_otp_hash: 'HASH', origin_lat: 20.3, origin_lng: 85.8,
    dest_lat: null, dest_lng: null,
    ...over,
  }
}

describe('verifyStartOTP — ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
  })

  it('throws 404 when the owner-scoped fetch returns null (not this driver)', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(null)
    await expect(verifyStartOTP(BigInt(9), BigInt(303), '1234')).rejects.toMatchObject({ httpStatus: 404 })
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })

  it('throws 403 (defense-in-depth) if a mismatched-driver row is returned', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(baseRide({ driver_id: 999 }) as never)
    await expect(verifyStartOTP(BigInt(9), BigInt(303), '1234')).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('completes for the owning driver with a valid OTP', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(baseRide() as never)
    const res = await verifyStartOTP(BigInt(9), BigInt(303), '1234')
    expect(res).toEqual({ success: true })
    expect(repo.updateRideStatus).toHaveBeenCalledWith(BigInt(303), 'in_progress', expect.anything())
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/unit/rides/verify-start-otp.test.ts`
Expected: FAIL — `verifyStartOTP` calls `repo.getRideById` (not mocked → `undefined`) and has no ownership guard.

- [ ] **Step 7: Add ownership to `verifyStartOTP`**

In `api/src/modules/rides/rides.service.ts`, in `verifyStartOTP` (currently lines 814–819), replace:

```typescript
export async function verifyStartOTP(driverId: bigint, rideId: bigint, otp: string) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (ride.status !== 'driver_arrived') {
    throw Object.assign(new Error('Ride not in correct state'), { httpStatus: 409 })
  }
```

with:

```typescript
export async function verifyStartOTP(driverId: bigint, rideId: bigint, otp: string) {
  const ride = await repo.getRideForDriverAction(rideId, driverId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!ride.driver_id || BigInt(ride.driver_id) !== driverId) {
    throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  }
  if (ride.status !== 'driver_arrived') {
    throw Object.assign(new Error('Ride not in correct state'), { httpStatus: 409 })
  }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/unit/rides/verify-start-otp.test.ts`
Expected: PASS (3 tests).

### Sub-part 3c — `verifyEndOTP`

- [ ] **Step 9: Update the existing `verifyEndOTP` test mocks**

`verify-end-otp-pending-stops.test.ts` mocks `getRideById` and its `baseRide()` has no `driver_id`. Update it so `verifyEndOTP` (now using `getRideForDriverAction`) still works.

In `api/tests/unit/rides/verify-end-otp-pending-stops.test.ts`:

a) In the `@/modules/rides/rides.repository` mock (currently lines 14–20), add `getRideForDriverAction` — change:

```typescript
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:      vi.fn(),
  getRideStops:     vi.fn(),
  getStopWaitTotal: vi.fn().mockResolvedValue(0),
  updateRideStatus: vi.fn().mockResolvedValue(undefined),
  logStatusHistory: vi.fn().mockResolvedValue(undefined),
}))
```

to:

```typescript
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:            vi.fn(),
  getRideForDriverAction: vi.fn(),
  getRideStops:           vi.fn(),
  getStopWaitTotal:       vi.fn().mockResolvedValue(0),
  updateRideStatus:       vi.fn().mockResolvedValue(undefined),
  logStatusHistory:       vi.fn().mockResolvedValue(undefined),
}))
```

b) Add `driver_id: 9` to `baseRide()` (currently lines 40–47) so the belt-guard passes for the `BigInt(9)` caller — change the `id: BigInt(303), status: ...` line to include it:

```typescript
function baseRide(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(303), driver_id: 9, status: 'in_progress', end_otp_hash: 'HASH',
    ride_type: 'one_way', user_id: 42, user_phone: null,
    origin_lat: 20.2961, origin_lng: 85.8245,
    ...over,
  }
}
```

c) In the `beforeEach` (currently lines 50–53), add a delegation so every existing `repo.getRideById(...).mockResolvedValue(...)` per-test setup also drives `getRideForDriverAction` — change:

```typescript
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getStopWaitTotal).mockResolvedValue(0)
  })
```

to:

```typescript
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getStopWaitTotal).mockResolvedValue(0)
    // verifyEndOTP now fetches via getRideForDriverAction; mirror whatever each
    // test set on getRideById so the existing per-test setups keep working.
    vi.mocked(repo.getRideForDriverAction).mockImplementation(
      ((rideId: bigint) => vi.mocked(repo.getRideById)(rideId)) as never
    )
  })
```

- [ ] **Step 10: Update the `completion-payment-branch.test.ts` mocks**

This file exercises `verifyEndOTP` (which switches to `getRideForDriverAction`) AND `startReturn` (which stays on `getRideById`). Add the mock and delegate ONLY within the `verifyEndOTP` describe block.

In `api/tests/unit/rides/completion-payment-branch.test.ts`:

a) In the `@/modules/rides/rides.repository` mock (currently lines 15–24), add `getRideForDriverAction: vi.fn(),` directly under the `getRideById: vi.fn(),` line:

```typescript
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:              vi.fn(),
  getRideForDriverAction:   vi.fn(),
  getRideStops:             vi.fn().mockResolvedValue([]),
  updateRideStatus:         vi.fn(),
  updateRideStatusCAS:      vi.fn(),
  logStatusHistory:         vi.fn(),
  getStopWaitTotal:         vi.fn().mockResolvedValue(0),
  getGpsTrackedDistanceKm:  vi.fn().mockResolvedValue(null),
  flagRideForReview:        vi.fn().mockResolvedValue(undefined),
}))
```

b) In the `describe('verifyEndOTP — payment channel branch', ...)` block's `beforeEach` (currently lines 53–60), add the same delegation line at the end of the callback (leave the `startReturn` describe block untouched — it keeps using `getRideById`):

```typescript
    vi.mocked(repo.getRideForDriverAction).mockImplementation(
      ((rideId: bigint) => vi.mocked(repo.getRideById)(rideId)) as never
    )
```

The full edited `beforeEach` becomes:

```typescript
  beforeEach(() => {
    vi.clearAllMocks()
    // fare_snapshots amount lookup + any other pool.query → generic amount row
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '500.00' }], rowCount: 1 } as never)
    vi.mocked(repo.updateRideStatus).mockResolvedValue(undefined as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(getConfigValue).mockResolvedValue('true')
    vi.mocked(repo.getRideForDriverAction).mockImplementation(
      ((rideId: bigint) => vi.mocked(repo.getRideById)(rideId)) as never
    )
  })
```

- [ ] **Step 11: Add ownership to `verifyEndOTP`**

In `api/src/modules/rides/rides.service.ts`, in `verifyEndOTP` (currently lines 1678–1682), replace:

```typescript
  const ride = await repo.getRideById(rideId)
  if (!ride) throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  if (ride.status !== 'in_progress' && ride.status !== 'returning') {
    throw httpError(409, 'Ride not in progress', 'RIDE_NOT_IN_PROGRESS')
  }
```

with:

```typescript
  const ride = await repo.getRideForDriverAction(rideId, driverId)
  if (!ride) throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  if (!ride.driver_id || BigInt(ride.driver_id) !== driverId) {
    throw httpError(403, 'Not your ride', 'FORBIDDEN')
  }
  if (ride.status !== 'in_progress' && ride.status !== 'returning') {
    throw httpError(409, 'Ride not in progress', 'RIDE_NOT_IN_PROGRESS')
  }
```

- [ ] **Step 12: Run all affected ride tests**

Run: `npx vitest run tests/unit/rides/verify-end-otp-pending-stops.test.ts tests/unit/rides/completion-payment-branch.test.ts tests/unit/rides/mark-arrived-ownership.test.ts tests/unit/rides/verify-start-otp.test.ts`
Expected: PASS (all suites green; the `verifyEndOTP` and `startReturn` suites still pass because `getRideForDriverAction` mirrors `getRideById`, and `startReturn` continues to use `getRideById` directly).

- [ ] **Step 13: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 14: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/mark-arrived-ownership.test.ts api/tests/unit/rides/verify-start-otp.test.ts api/tests/unit/rides/verify-end-otp-pending-stops.test.ts api/tests/unit/rides/completion-payment-branch.test.ts
git commit -m "fix(rides): enforce driver ownership on markArrived/verifyStartOTP/verifyEndOTP (IDOR)"
```

---

## Task 4: Wire attempt-limiting into OTP verification + fix `attempt_number`

Call `checkRideOtpAttempts` before the hash comparison, `clearRideOtpAttempts` on success, and record the real attempt count in `ride_otp_events` instead of the hardcoded `1`.

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` — import line (~15), `verifyStartOTP` (~814+), `verifyEndOTP` (~1669+)
- Modify: `api/tests/unit/rides/verify-start-otp.test.ts` (add lockout + attempt_number tests)
- Modify: `api/tests/unit/rides/verify-end-otp-pending-stops.test.ts` (add otp mock fns + a wiring test)
- Modify: `api/tests/unit/rides/completion-payment-branch.test.ts` (add otp mock fns)

- [ ] **Step 1: Extend the import in `rides.service.ts`**

In `api/src/modules/rides/rides.service.ts`, change line 15:

```typescript
import { generateOtp, hashOtp } from '@/lib/otp'
```

to:

```typescript
import { generateOtp, hashOtp, checkRideOtpAttempts, clearRideOtpAttempts } from '@/lib/otp'
```

- [ ] **Step 2: Write the failing tests for `verifyStartOTP`**

Append these two tests inside the `describe('verifyStartOTP — ownership', ...)` block in `api/tests/unit/rides/verify-start-otp.test.ts` (before the closing `})` of the describe). Also add the needed imports of the otp mock at the top import section:

At the top of the file, add to the existing imports:

```typescript
import * as otpLib from '@/lib/otp'
```

Then append inside the describe block:

```typescript
  it('locks out with 429 when the attempt limiter throws (over the cap)', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(baseRide() as never)
    vi.mocked(otpLib.checkRideOtpAttempts).mockRejectedValueOnce(
      Object.assign(new Error('Too many incorrect attempts. Try again later.'), {
        httpStatus: 429, appCode: 'RIDE_OTP_LOCKED',
      })
    )
    await expect(verifyStartOTP(BigInt(9), BigInt(303), '1234')).rejects.toMatchObject({ httpStatus: 429 })
    // hash comparison / status flip must not happen once locked out
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })

  it('records the real attempt_number (from the limiter) in ride_otp_events, not a hardcoded 1', async () => {
    vi.mocked(repo.getRideForDriverAction).mockResolvedValue(baseRide() as never)
    vi.mocked(otpLib.checkRideOtpAttempts).mockResolvedValueOnce(3)
    await verifyStartOTP(BigInt(9), BigInt(303), '1234')

    const insert = vi.mocked(pool.query).mock.calls.find(
      c => /INSERT INTO ride_otp_events/.test(c[0] as string)
    )
    expect(insert).toBeTruthy()
    // params: [rideId, event, attemptNumber]
    expect(insert![1]).toEqual([BigInt(303), 'verified', 3])
    expect(otpLib.clearRideOtpAttempts).toHaveBeenCalledWith(BigInt(303), 'start')
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/rides/verify-start-otp.test.ts`
Expected: FAIL — `verifyStartOTP` does not yet call `checkRideOtpAttempts`/`clearRideOtpAttempts`, and the insert still hardcodes `attempt_number` = `1` (params are `[BigInt(303), 'verified']`, not `[..., 3]`).

- [ ] **Step 4: Wire the limiter into `verifyStartOTP`**

In `api/src/modules/rides/rides.service.ts`, in `verifyStartOTP`, replace this block (currently lines 821–830):

```typescript
  const valid = ride.start_otp_hash != null && hashOtp(otp) === ride.start_otp_hash

  await pool.query(
    `INSERT INTO ride_otp_events
       (ride_id, otp_type, event, actor_role, attempt_number)
     VALUES ($1,'trip_start',$2,'driver',1)`,
    [rideId, valid ? 'verified' : 'failed']
  )

  if (!valid) throw Object.assign(new Error('Invalid OTP'), { httpStatus: 422 })
```

with:

```typescript
  const attemptNumber = await checkRideOtpAttempts(rideId, 'start')

  const valid = ride.start_otp_hash != null && hashOtp(otp) === ride.start_otp_hash

  await pool.query(
    `INSERT INTO ride_otp_events
       (ride_id, otp_type, event, actor_role, attempt_number)
     VALUES ($1,'trip_start',$2,'driver',$3)`,
    [rideId, valid ? 'verified' : 'failed', attemptNumber]
  )

  if (!valid) throw Object.assign(new Error('Invalid OTP'), { httpStatus: 422 })

  await clearRideOtpAttempts(rideId, 'start')
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/rides/verify-start-otp.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 6: Add otp mock fns + a wiring test to the `verifyEndOTP` suites**

`verifyEndOTP`'s test files mock `@/lib/otp` without the new functions — the real (unmocked) functions would run against a redis mock that has no `incr`. Add them.

In `api/tests/unit/rides/verify-end-otp-pending-stops.test.ts`, change the otp mock (currently line 35):

```typescript
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'HASH') }))
```

to:

```typescript
vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '1234'),
  hashOtp: vi.fn(() => 'HASH'),
  checkRideOtpAttempts: vi.fn().mockResolvedValue(1),
  clearRideOtpAttempts: vi.fn().mockResolvedValue(undefined),
}))
```

In `api/tests/unit/rides/completion-payment-branch.test.ts`, change the otp mock (currently line 5):

```typescript
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h') }))
```

to:

```typescript
vi.mock('@/lib/otp', () => ({
  generateOtp: vi.fn(() => '1234'),
  hashOtp: vi.fn(() => 'h'),
  checkRideOtpAttempts: vi.fn().mockResolvedValue(1),
  clearRideOtpAttempts: vi.fn().mockResolvedValue(undefined),
}))
```

Then, in `verify-end-otp-pending-stops.test.ts`, add a wiring test. First extend the top imports to include the otp mock and `pool`:

```typescript
import * as otpLib from '@/lib/otp'
import { pool } from '@/db/client'
```

Then append inside the `describe('verifyEndOTP — pending stops guard', ...)` block:

```typescript
  it('records the real attempt_number from the limiter and clears on success', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue([] as never)
    vi.mocked(otpLib.checkRideOtpAttempts).mockResolvedValueOnce(2)

    await verifyEndOTP(BigInt(9), BigInt(303), '1234')

    const insert = vi.mocked(pool.query).mock.calls.find(
      c => /INSERT INTO ride_otp_events/.test(c[0] as string)
    )
    expect(insert![1]).toEqual([BigInt(303), 'verified', 2])
    expect(otpLib.clearRideOtpAttempts).toHaveBeenCalledWith(BigInt(303), 'end')
  })

  it('lets a 429 lockout from the limiter propagate before any status change', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide() as never)
    vi.mocked(repo.getRideStops).mockResolvedValue([] as never)
    vi.mocked(otpLib.checkRideOtpAttempts).mockRejectedValueOnce(
      Object.assign(new Error('locked'), { httpStatus: 429, appCode: 'RIDE_OTP_LOCKED' })
    )
    await expect(verifyEndOTP(BigInt(9), BigInt(303), '1234')).rejects.toMatchObject({ httpStatus: 429 })
    expect(repo.updateRideStatus).not.toHaveBeenCalled()
  })
```

Note: `verify-end-otp-pending-stops.test.ts` mocks `@/db/redis` as `{ client: { del } }`; because `checkRideOtpAttempts`/`clearRideOtpAttempts` are mocked here, the real redis `incr`/`expire` are never invoked — no redis mock change is needed.

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/rides/verify-end-otp-pending-stops.test.ts`
Expected: FAIL — `verifyEndOTP` still hardcodes `attempt_number` = `1` (insert params are `[BigInt(303), 'verified']`) and never calls the limiter, so the new attempt_number/lockout tests fail.

- [ ] **Step 8: Wire the limiter into `verifyEndOTP`**

In `api/src/modules/rides/rides.service.ts`, in `verifyEndOTP`, replace this block (currently lines 1689–1700):

```typescript
  const valid = ride.end_otp_hash != null && hashOtp(otp) === ride.end_otp_hash

  await pool.query(
    `INSERT INTO ride_otp_events
       (ride_id, otp_type, event, actor_role, attempt_number)
     VALUES ($1,'trip_end',$2,'driver',1)`,
    [rideId, valid ? 'verified' : 'failed']
  )

  if (!valid) throw httpError(422, 'Invalid OTP', 'INVALID_OTP')

  await redis.del(endOtpKey(rideId.toString()))
```

with:

```typescript
  const attemptNumber = await checkRideOtpAttempts(rideId, 'end')

  const valid = ride.end_otp_hash != null && hashOtp(otp) === ride.end_otp_hash

  await pool.query(
    `INSERT INTO ride_otp_events
       (ride_id, otp_type, event, actor_role, attempt_number)
     VALUES ($1,'trip_end',$2,'driver',$3)`,
    [rideId, valid ? 'verified' : 'failed', attemptNumber]
  )

  if (!valid) throw httpError(422, 'Invalid OTP', 'INVALID_OTP')

  await clearRideOtpAttempts(rideId, 'end')
  await redis.del(endOtpKey(rideId.toString()))
```

- [ ] **Step 9: Run all affected ride tests**

Run: `npx vitest run tests/unit/rides/verify-start-otp.test.ts tests/unit/rides/verify-end-otp-pending-stops.test.ts tests/unit/rides/completion-payment-branch.test.ts`
Expected: PASS (all suites green).

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Run the full unit suite to catch regressions**

Run: `npx vitest run`
Expected: PASS (no other suite depends on the old `attempt_number: 1` or the old `getRideById` call in the three functions; if any pre-existing integration suites fail only due to a missing live `TEST_DATABASE_URL`, that is the known baseline noted in CLAUDE.md and unrelated to this change).

- [ ] **Step 12: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/verify-start-otp.test.ts api/tests/unit/rides/verify-end-otp-pending-stops.test.ts api/tests/unit/rides/completion-payment-branch.test.ts
git commit -m "feat(rides): brute-force limit ride OTP verification + record real attempt_number"
```

---

## Self-Review

**1. Spec coverage (design §01):**
- §01.1 Redis attempt counter (`checkRideOtpAttempts`/`clearRideOtpAttempts`, `INCR`+`EXPIRE`-on-first) → Task 1. ✅
- §01.1 wired into `verifyStartOTP` + `verifyEndOTP` (check before hash, clear on success) → Task 4 Steps 4, 8. ✅
- §01.1 replace hardcoded `attempt_number: 1` with real count → Task 4 Steps 4, 8 (uses the value returned by `checkRideOtpAttempts`, i.e. "read attempts off the Redis counter", the design's cheaper option). ✅
- §01.2 immediate 403 ownership guard matching siblings → Task 3 Steps 3, 7, 11. ✅
- §01.2 structural `getRideForDriverAction(rideId, driverId)` scoped by both columns, reusing the shared SELECT → Task 2. ✅
- §01.2 adopted by all three driver-scoped functions → Task 3 (markArrived, verifyStartOTP, verifyEndOTP). ✅
- §07 cross-cutting fixed-window counter convention followed (mirrors `checkRateLimit`) → Task 1. ✅
- Every affected test file's mocks updated → Task 3 Steps 9–10 (repo mock), Task 4 Step 6 (otp mock). ✅
- `collectCash`/`startReturn`/`cancelRideAsDriver`/`endRideEarlyAsDriver` deliberately NOT switched (already own their guard; `startReturn` in `completion-payment-branch.test.ts` intentionally keeps `getRideById`). ✅

**2. Placeholder scan:** No `TBD`/`TODO`/"add error handling"/"similar to Task N" — every code and test step contains full literal content. ✅

**3. Type consistency:**
- `checkRideOtpAttempts(rideId: bigint, otpType: 'start' | 'end'): Promise<number>` — defined Task 1 Step 4, called with `'start'`/`'end'` and its return assigned to `attemptNumber` in Task 4. Consistent. (Deviates from the design's `Promise<void>` pseudocode on purpose, to return the count for the truthful `attempt_number` — the design explicitly endorses reading the count off the counter.) ✅
- `clearRideOtpAttempts(...): Promise<void>` — consistent across definition and calls. ✅
- `getRideForDriverAction(rideId: bigint, driverId: bigint): Promise<Ride | null>` — same name/signature in repository (Task 2), service call sites (Task 3), and every test mock. ✅
- Error style per function: `Object.assign(new Error(...), { httpStatus })` for `markArrived`/`verifyStartOTP` (matches their siblings), `httpError(...)` for `verifyEndOTP` and the otp limiter (matches `collectCash`/local style). No `AppError` used anywhere. ✅
- Redis key string `ride:otp:attempts:${rideId}:${otpType}` identical in Task 1 implementation and its test assertions. ✅

No issues found requiring rework.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-24-ride-otp-and-driver-action-authorization.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
