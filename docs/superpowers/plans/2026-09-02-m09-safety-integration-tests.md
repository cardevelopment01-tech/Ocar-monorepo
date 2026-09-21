# M09 (Safety) Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 9 `it.todo()` stubs in `api/tests/integration/m09.test.ts` with real supertest-driven integration tests (real Express app, real Postgres test DB, real Redis) covering ratings, SOS alerts, and disputes — the safety/legal-exposure module, the next-highest priority after M07 (rides) and M08 (payments), which are both already done on this branch.

**Architecture:** Same pattern as M07/M08: `createApp()`, real OTP login via `loginUser`/`loginDriver` (from `api/tests/helpers/fixtures/rides.fixture.ts`), a completed ride via `setupOnlineDriver` + booking + `driveRideToCompletion` (all already built and reused, not reinvented), admin JWT via a real `POST /api/v1/auth/admin/login` call (pattern already proven in `m02.test.ts:231-239`), assert both HTTP response and DB rows. `cleanupRideAndDriverData`'s FK-cleanup already covers every table this plan touches (`ratings`, `rating_tags`, `sos_alerts`, `disputes`, `dispute_evidence`, `dispute_actions`, `driver_warnings`) — confirmed via a fresh `information_schema` pass in research, not assumed. Reuse it as-is.

**Tech Stack:** Vitest, Supertest, real Postgres test DB (`TEST_DATABASE_URL`, `postgres_test` container port 5433), real Redis, real admin auth.

**A note on the plan's own scope discipline**: TC-M09-006's original description ("dispute created with evidence uploads") doesn't match reality — research confirmed there is no `POST` endpoint anywhere in the app that inserts into `dispute_evidence`. Task 4 below tests dispute creation for real and renames the evidence-upload half honestly rather than faking coverage that doesn't exist (same principle applied to M07's deferred stubs). TC-M09-009 (trip-replay) depends on `geoService.getRoute`, which calls the real Google Directions API in production — Task 5 mocks it, matching how M03 mocks `@/lib/storage` for S3.

**Known pre-existing condition, not this plan's problem to fix**: `api/vitest.config.ts` already has `fileParallelism: false` (set during the M07/M08 work, after a real cross-file DB race was found) — new integration test files inherit this automatically, no action needed here.

---

## Before you start

Confirm the test containers are up (same ones M07/M08 already use):
```powershell
docker ps --filter "name=ocar_postgres_test" --filter "name=ocar_redis"
```
If not running: `docker start ocar_postgres_test ocar_redis`. `api/.env` should already exist in this worktree from the M07/M08 work (`TEST_DATABASE_URL`, `RAZORPAY_*` dummy values) — confirm before assuming you need to recreate it.

Confirm the seeded super_admin credentials still work locally: `email: 'admin@ocar.app', password: 'Admin@1234'` (per `m02.test.ts:231-239`) — if this worktree's DB was reseeded differently, adjust.

---

## Task 1: Safety-specific fixture helpers

**Files:**
- Create: `api/tests/helpers/fixtures/safety.fixture.ts`

- [ ] **Step 1: Write the helper module**

```typescript
// api/tests/helpers/fixtures/safety.fixture.ts
import type { Express } from 'express'
import request from 'supertest'

/** Real admin login — mirrors m02.test.ts's proven pattern (TC-M02 admin tests). */
export async function loginAdmin(
  app: Express,
  email = 'admin@ocar.app',
  password = 'Admin@1234'
) {
  const res = await request(app)
    .post('/api/v1/auth/admin/login')
    .send({ email, password })
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Admin login failed: ${JSON.stringify(res.body)}`)
  }
  const { tokens, admin } = res.body as {
    tokens: { accessToken: string }
    admin: { id: string; role: string }
  }
  return { accessToken: tokens.accessToken, adminId: admin.id, role: admin.role }
}
```

- [ ] **Step 2: Typecheck it**

Run: `cd api && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add api/tests/helpers/fixtures/safety.fixture.ts
git commit -m "test: add admin-login fixture helper for M09 safety integration tests"
```

---

## Task 2: Ratings tests (TC-M09-001, 002, 003)

**Files:**
- Modify: `api/tests/integration/m09.test.ts`

High confidence — `submitRating`'s full behavior (participant checks, dedup, tag insert, rating-avg update) was independently confirmed against `ratings.service.ts` and `safety.repository.ts` line-by-line in research.

- [ ] **Step 1: Replace the file header and add these tests**

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import {
  loginUser, setupOnlineDriver, driveRideToCompletion, cleanupRideAndDriverData, DEFAULT_BOOKING,
} from '../helpers/fixtures/rides.fixture'
import { loginAdmin } from '../helpers/fixtures/safety.fixture'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://storage.test/put-url'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://storage.test/x.jpg'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(url)),
}))

const app = createApp()

const PHONES = {
  ratingUser1: '+919700000041',
  ratingDriver1: '+919700000042',
  ratingUser2: '+919700000043',
  ratingDriver2: '+919700000044',
} as const

let categoryId: number

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1"
  )
  categoryId = Number(rows[0]!.id)
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:user:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.end()
  redis.disconnect()
})

async function bookAndCompleteRide(userPhone: string, driverPhone: string) {
  const driver = await setupOnlineDriver(app, pool, redis, driverPhone, { categorySlug: 'sedan' })
  const { accessToken: userToken, userId } = await loginUser(app, redis, userPhone)
  const bookRes = await request(app)
    .post('/api/v1/rides')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ categoryId, ...DEFAULT_BOOKING })
  if (bookRes.status !== 201) throw new Error(`Booking failed: ${JSON.stringify(bookRes.body)}`)
  const rideId = bookRes.body.rideId as string
  await driveRideToCompletion(app, rideId, driver, userToken)
  return { rideId, userToken, userId, driver }
}

describe('M09 — Safety', () => {
  describe('Ratings', () => {
    it('TC-M09-001: user submits rating after ride completion', async () => {
      const { rideId, userToken } = await bookAndCompleteRide(PHONES.ratingUser1, PHONES.ratingDriver1)

      const { rows: tagRows } = await pool.query<{ id: string }>(
        "SELECT id FROM rating_tag_definitions WHERE applies_to IN ('driver','both') AND is_active = true LIMIT 1"
      )

      const res = await request(app)
        .post('/api/v1/safety/ratings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rideId, direction: 'user_to_driver', score: 5, comment: 'Great ride', tagIds: [tagRows[0]!.id] })
      expect(res.status, JSON.stringify(res.body)).toBe(201)
      expect(res.body.score).toBe(5)

      const { rows } = await pool.query(
        'SELECT direction, score, to_driver_id FROM ratings WHERE ride_id = $1', [rideId]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.direction).toBe('user_to_driver')

      const { rows: tagLinkRows } = await pool.query(
        'SELECT * FROM rating_tags WHERE rating_id = $1', [res.body.id]
      )
      expect(tagLinkRows).toHaveLength(1)
    })

    it('TC-M09-002: driver submits rating after ride completion', async () => {
      const { rideId, driver } = await bookAndCompleteRide(PHONES.ratingUser2, PHONES.ratingDriver2)

      const res = await request(app)
        .post('/api/v1/safety/ratings')
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ rideId, direction: 'driver_to_user', score: 4 })
      expect(res.status, JSON.stringify(res.body)).toBe(201)

      const { rows } = await pool.query(
        'SELECT direction, score FROM ratings WHERE ride_id = $1 AND direction = $2', [rideId, 'driver_to_user']
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.score).toBe(4)

      // Duplicate submission on the same ride+direction must 409, not double-insert.
      const dupRes = await request(app)
        .post('/api/v1/safety/ratings')
        .set('Authorization', `Bearer ${driver.accessToken}`)
        .send({ rideId, direction: 'driver_to_user', score: 3 })
      expect(dupRes.status, JSON.stringify(dupRes.body)).toBe(409)

      const { rows: afterDup } = await pool.query(
        'SELECT count(*)::int AS n FROM ratings WHERE ride_id = $1 AND direction = $2', [rideId, 'driver_to_user']
      )
      expect(afterDup[0]?.n).toBe(1)
    })

    it('TC-M09-003: rating average updates on driver profile', async () => {
      const { rideId, driver, userToken } = await bookAndCompleteRide(PHONES.ratingUser1 + '9', PHONES.ratingDriver1 + '9')
      // NOTE: '+9' suffix above is a placeholder — replace with a real distinct
      // phone constant (e.g. add ratingUser3/ratingDriver3 to PHONES) before
      // running; string-concatenating a phone number is not a valid E.164 value.

      const { rows: before } = await pool.query<{ rating_avg: string; total_ratings: number }>(
        'SELECT rating_avg, total_ratings FROM drivers WHERE id = $1', [driver.driverId]
      )

      const res = await request(app)
        .post('/api/v1/safety/ratings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rideId, direction: 'user_to_driver', score: 5 })
      expect(res.status, JSON.stringify(res.body)).toBe(201)

      const { rows: after } = await pool.query<{ rating_avg: string; total_ratings: number }>(
        'SELECT rating_avg, total_ratings FROM drivers WHERE id = $1', [driver.driverId]
      )
      expect(after[0]!.total_ratings).toBe((before[0]?.total_ratings ?? 0) + 1)
      expect(Number(after[0]!.rating_avg)).toBeGreaterThan(0)
    })
  })
})
```

- [ ] **Step 2: Fix the placeholder phone number before running**

Add a real `ratingUser3: '+919700000045'` / `ratingDriver3: '+919700000046'` to `PHONES` and use them in TC-M09-003 instead of the `+ '9'` placeholder — the code above deliberately flags this rather than silently shipping an invalid phone value (same discipline as the M07 plan's own self-caught mistake).

- [ ] **Step 3: Run it**

Run: `cd api && npx vitest run tests/integration/m09.test.ts -t "TC-M09-001|TC-M09-002|TC-M09-003"`
Expected: 3 passing. Run at least twice back-to-back before moving on — this codebase has repeatedly had tests that pass once and fail on rerun due to incomplete cleanup or accumulated state (see M07/M08 plan history). If `rating_sum` (referenced in `updateDriverRatingAvg` per research but not found in `009_m7_safety.sql`) turns out to not exist as a column, the rating-avg update will fail with a real DB error — if that happens, grep all migrations for `rating_sum` to find where it's actually defined before assuming a test-authoring mistake.

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m09.test.ts
git commit -m "test(M09): add ratings integration tests (submit, dedup, average update)"
```

---

## Task 3: SOS tests (TC-M09-004, 005)

**Files:**
- Modify: `api/tests/integration/m09.test.ts`

High confidence — `triggerSos`'s dedup window, hourly cap, and status guard were all confirmed against `sos.service.ts` with exact line numbers, and the existing unit test `trigger-sos.test.ts` already validates the same logic against mocks (this task adds the real-DB/HTTP layer on top).

- [ ] **Step 1: Add this describe block**

```typescript
// Add inside describe('M09 — Safety', ...), as a new nested describe.
describe('SOS alerts', () => {
  it('TC-M09-004: SOS triggered creates sos_alert with high severity', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.sosDriver)
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.sosUser)

    const bookRes = await request(app)
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ categoryId, ...DEFAULT_BOOKING })
    expect(bookRes.status, JSON.stringify(bookRes.body)).toBe(201)
    const rideId = bookRes.body.rideId as string

    // SOS requires an *active* ride (in_progress/driver_arrived/returning) —
    // drive it to in_progress only, not all the way to completed, using the
    // same accept->arrived->start-otp steps driveRideToCompletion uses
    // internally. Since driveRideToCompletion doesn't expose a partial variant,
    // inline the first 3 steps here rather than modifying the shared helper's
    // contract (it may be reused elsewhere expecting full completion).
    const acceptRes = await request(app)
      .post(`/api/v1/rides/${rideId}/accept`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
    expect(acceptRes.status, JSON.stringify(acceptRes.body)).toBe(200)
    const arrivedRes = await request(app)
      .post(`/api/v1/rides/${rideId}/arrived`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
    expect(arrivedRes.status, JSON.stringify(arrivedRes.body)).toBe(200)
    const rideAsUser = await request(app)
      .get(`/api/v1/rides/${rideId}`)
      .set('Authorization', `Bearer ${userToken}`)
    const startOtp = rideAsUser.body.startOtp as string
    const startOtpRes = await request(app)
      .post(`/api/v1/rides/${rideId}/start-otp`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ otp: startOtp })
    expect(startOtpRes.status, JSON.stringify(startOtpRes.body)).toBe(200)

    const sosRes = await request(app)
      .post('/api/v1/safety/sos')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rideId, severity: 'high', notes: 'Test SOS' })
    expect(sosRes.status, JSON.stringify(sosRes.body)).toBe(201)
    expect(sosRes.body.severity).toBe('high')

    const { rows } = await pool.query(
      'SELECT severity, status FROM sos_alerts WHERE ride_id = $1', [rideId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.severity).toBe('high')
    expect(rows[0]?.status).toBe('triggered')

    // Stash for TC-M09-005 via module-level state would be fragile across
    // test order — instead TC-M09-005 books its own ride/SOS from scratch.
  })

  it('TC-M09-005: SOS acknowledged updates status', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.sosDriver2)
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.sosUser2)

    const bookRes = await request(app)
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ categoryId, ...DEFAULT_BOOKING })
    const rideId = bookRes.body.rideId as string

    await request(app).post(`/api/v1/rides/${rideId}/accept`).set('Authorization', `Bearer ${driver.accessToken}`)
    await request(app).post(`/api/v1/rides/${rideId}/arrived`).set('Authorization', `Bearer ${driver.accessToken}`)
    const rideAsUser = await request(app).get(`/api/v1/rides/${rideId}`).set('Authorization', `Bearer ${userToken}`)
    await request(app)
      .post(`/api/v1/rides/${rideId}/start-otp`)
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({ otp: rideAsUser.body.startOtp })

    const sosRes = await request(app)
      .post('/api/v1/safety/sos')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rideId })
    expect(sosRes.status, JSON.stringify(sosRes.body)).toBe(201)
    const sosId = sosRes.body.id as string

    const admin = await loginAdmin(app)
    const ackRes = await request(app)
      .patch(`/api/v1/admin/safety/sos/${sosId}/acknowledge`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
    expect(ackRes.status, JSON.stringify(ackRes.body)).toBe(200)

    const { rows } = await pool.query(
      'SELECT status, acknowledged_by FROM sos_alerts WHERE id = $1', [sosId]
    )
    expect(rows[0]?.status).toBe('acknowledged')
    expect(rows[0]?.acknowledged_by).toBe(admin.adminId)
  })
})
```

Add `sosDriver`, `sosUser`, `sosDriver2`, `sosUser2` to `PHONES` with fresh, non-colliding numbers (e.g. `+919700000051` through `54`).

- [ ] **Step 2: Run and verify twice**

Run: `cd api && npx vitest run tests/integration/m09.test.ts -t "TC-M09-004|TC-M09-005"` twice back-to-back.

- [ ] **Step 3: Commit**

```bash
git add api/tests/integration/m09.test.ts
git commit -m "test(M09): add SOS trigger and admin-acknowledge integration tests"
```

---

## Task 4: Dispute creation and resolution (TC-M09-006, 007, 008)

**Files:**
- Modify: `api/tests/integration/m09.test.ts`

Medium confidence — the create/assign/resolve HTTP flow and refund-cap transaction logic were confirmed against source, but this task's real risk is the `applyDisputeOutcomeConsequences` post-commit side effects (driver_warnings insert, auto-suspend threshold) which run fire-and-forget after the resolve transaction commits — same class of timing issue M08 hit repeatedly with `settleRideCompletionPayment`. Poll for the async side effect rather than asserting immediately after the resolve response.

- [ ] **Step 1: Confirm the `applyDisputeOutcomeConsequences` timing before writing assertions**

Read `api/src/modules/safety/disputes.service.ts`'s `resolveDispute` function (around lines 79-154 per research) to confirm whether `applyDisputeOutcomeConsequences` is awaited before the HTTP response returns, or truly fire-and-forget (not awaited). If awaited, TC-M09-008 can assert immediately after the resolve call. If fire-and-forget, add a short poll (same `waitFor*` pattern used in `m08.test.ts`) for the `driver_warnings` row rather than asserting immediately — don't guess, the M08 plan hit exactly this class of bug (a race with a fire-and-forget write) twice already.

- [ ] **Step 2: Write the tests**

```typescript
// Add inside describe('M09 — Safety', ...), as a new nested describe.
describe('Disputes', () => {
  it('TC-M09-006: dispute created after ride completion', async () => {
    // NOTE: the original stub text said "with evidence uploads" — no such
    // endpoint exists anywhere in the app (research confirmed: dispute_evidence
    // has a table and a column set, but zero routes insert into it). This test
    // covers real dispute *creation* only; evidence upload is untested because
    // it isn't implemented, not because of a test gap.
    const { rideId, userToken } = await bookAndCompleteRide(PHONES.disputeUser1, PHONES.disputeDriver1)

    const res = await request(app)
      .post('/api/v1/safety/disputes')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rideId, type: 'fare_overcharge', description: 'Charged more than the estimate', priority: 2 })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.status).toBe('open')

    const { rows } = await pool.query(
      'SELECT type, status, sla_hours FROM disputes WHERE ride_id = $1', [rideId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('fare_overcharge')
    expect(rows[0]?.sla_hours).toBe(48) // priority 2 -> 48h, per disputes.service.ts

    // Disputing before ride completion must be rejected.
    const { rideId: activeRideId, userToken: activeUserToken } = await (async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.disputeDriver2)
      const { accessToken, userId: _userId } = await loginUser(app, redis, PHONES.disputeUser2)
      const b = await request(app)
        .post('/api/v1/rides')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ categoryId, ...DEFAULT_BOOKING })
      return { rideId: b.body.rideId as string, userToken: accessToken }
    })()
    const earlyDisputeRes = await request(app)
      .post('/api/v1/safety/disputes')
      .set('Authorization', `Bearer ${activeUserToken}`)
      .send({ rideId: activeRideId, type: 'other', description: 'too early' })
    expect(earlyDisputeRes.status, JSON.stringify(earlyDisputeRes.body)).toBe(400)
  })

  it('TC-M09-007: dispute resolution applies fare adjustment (partial refund)', async () => {
    const { rideId, userToken } = await bookAndCompleteRide(PHONES.disputeUser3, PHONES.disputeDriver3)

    const disputeRes = await request(app)
      .post('/api/v1/safety/disputes')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rideId, type: 'fare_overcharge', description: 'Overcharged', priority: 1 })
    const disputeId = disputeRes.body.id as string

    const { rows: paymentRows } = await pool.query<{ id: string; amount: string }>(
      'SELECT id, amount FROM payments WHERE ride_id = $1', [rideId]
    )
    expect(paymentRows.length).toBeGreaterThan(0)
    const paymentAmount = Number(paymentRows[0]!.amount)
    const refundAmount = Math.min(50, paymentAmount)

    const admin = await loginAdmin(app)
    const resolveRes = await request(app)
      .patch(`/api/v1/admin/safety/disputes/${disputeId}/resolve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ outcome: 'partial_refund', note: 'Partial refund approved', refundAmount })
    expect(resolveRes.status, JSON.stringify(resolveRes.body)).toBe(200)

    const { rows: disputeRows } = await pool.query(
      'SELECT status, outcome FROM disputes WHERE id = $1', [disputeId]
    )
    expect(disputeRows[0]?.status).toBe('resolved')
    expect(disputeRows[0]?.outcome).toBe('partial_refund')

    const { rows: refundRows } = await pool.query(
      'SELECT amount, status FROM refunds WHERE dispute_id = $1', [disputeId]
    )
    expect(refundRows).toHaveLength(1)
    expect(Number(refundRows[0]!.amount)).toBe(refundAmount)

    // Refund exceeding the remaining balance must be rejected — proves the
    // FOR UPDATE cap check, not just the happy path.
    const overRes = await request(app)
      .patch(`/api/v1/admin/safety/disputes/${disputeId}/resolve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ outcome: 'partial_refund', note: 'try again', refundAmount: paymentAmount + 1000 })
    expect(overRes.status, JSON.stringify(overRes.body)).toBe(400)
  })

  it('TC-M09-008: driver warning issued increments warning count', async () => {
    const { rideId, userToken, driver } = await bookAndCompleteRide(PHONES.disputeUser4, PHONES.disputeDriver4)

    const disputeRes = await request(app)
      .post('/api/v1/safety/disputes')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rideId, type: 'driver_behaviour', description: 'Rude driver', priority: 1 })
    const disputeId = disputeRes.body.id as string

    const admin = await loginAdmin(app)
    const resolveRes = await request(app)
      .patch(`/api/v1/admin/safety/disputes/${disputeId}/resolve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ outcome: 'driver_warned', note: 'First warning' })
    expect(resolveRes.status, JSON.stringify(resolveRes.body)).toBe(200)

    // If Step 1 found this is fire-and-forget, replace this immediate query
    // with a short poll (see m08.test.ts's waitFor* helpers for the pattern)
    // instead of asserting right away.
    const { rows } = await pool.query(
      'SELECT category, severity, dispute_id FROM driver_warnings WHERE driver_id = $1 AND ride_id = $2',
      [driver.driverId, rideId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.category).toBe('other')
    expect(rows[0]?.severity).toBe('moderate')
    expect(rows[0]?.dispute_id).toBe(disputeId)
  })
})
```

Add `disputeUser1-4`/`disputeDriver1-4` to `PHONES` with fresh, non-colliding numbers.

- [ ] **Step 3: Run and verify at least twice back-to-back**

Run: `cd api && npx vitest run tests/integration/m09.test.ts -t "TC-M09-006|TC-M09-007|TC-M09-008"`

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m09.test.ts
git commit -m "test(M09): add dispute creation, refund resolution, and driver-warning integration tests"
```

---

## Task 5: Trip replay (TC-M09-009)

**Files:**
- Modify: `api/tests/integration/m09.test.ts`

Lower confidence — depends on `geoService.getRoute` (real Google Directions API call in production) and on seeding real `gps_tracks` rows. Requires a mock and a read-first step.

- [ ] **Step 1: Confirm the geo service mock point**

Read `api/src/modules/safety/disputes.service.ts`'s `getTripReplay` (around lines 207-232 per research) and `api/src/modules/geo/geo.service.ts`'s `getRoute` export. Confirm the exact import path to mock (`vi.mock('@/modules/geo/geo.service', ...)`, matching the same pattern used for `@/lib/storage` elsewhere) and its return shape, so the mock's return value actually satisfies what `getTripReplay` expects for `plannedRoute.polyline`.

- [ ] **Step 2: Write the test**

```typescript
// Add near the top of the file, alongside the existing vi.mock('@/lib/storage', ...) block.
vi.mock('@/modules/geo/geo.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/geo/geo.service')>()
  return {
    ...actual,
    getRoute: vi.fn().mockResolvedValue({ polyline: 'mock_encoded_polyline' }),
  }
})

// Add inside describe('M09 — Safety', ...), as a new nested describe.
describe('Trip replay', () => {
  it('TC-M09-009: dispute trip-replay returns actual GPS trail and planned route', async () => {
    const { rideId, userToken } = await bookAndCompleteRide(PHONES.replayUser, PHONES.replayDriver)

    // Seed a couple of real gps_tracks points for this ride — driveRideToCompletion
    // doesn't generate GPS breadcrumbs on its own (that's a separate driver-app
    // location-ping flow, not part of the OTP-driven test sequence).
    await pool.query(
      `INSERT INTO gps_tracks (ride_id, location, speed_kmph, heading, recorded_at)
       VALUES
         ($1, ST_SetSRID(ST_MakePoint(85.82, 20.29), 4326)::geography, 20, 90, now() - interval '10 minutes'),
         ($1, ST_SetSRID(ST_MakePoint(85.85, 20.35), 4326)::geography, 25, 95, now() - interval '5 minutes')`,
      [rideId]
    )

    const disputeRes = await request(app)
      .post('/api/v1/safety/disputes')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rideId, type: 'trip_manipulation', description: 'Route looked wrong', priority: 1 })
    const disputeId = disputeRes.body.id as string

    const admin = await loginAdmin(app)
    const replayRes = await request(app)
      .get(`/api/v1/admin/safety/disputes/${disputeId}/trip-replay`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
    expect(replayRes.status, JSON.stringify(replayRes.body)).toBe(200)
    expect(Array.isArray(replayRes.body.actualTrail)).toBe(true)
    expect(replayRes.body.actualTrail.length).toBeGreaterThanOrEqual(2)
    // plannedRoute depends on the ride having non-null origin/destination lat/lng
    // (DEFAULT_BOOKING sets both) — if it comes back null instead of the mocked
    // polyline, read getTripReplay's exact null-check condition before assuming
    // the mock is wired wrong.
    expect(replayRes.body.plannedRoute).toEqual({ polyline: 'mock_encoded_polyline' })
  })
})
```

Add `replayUser: '+919700000061'`, `replayDriver: '+919700000062'` to `PHONES`.

Note on `gps_tracks` cleanup: check whether `cleanupRideAndDriverData` already handles `gps_tracks` (it wasn't mentioned in the M09 research's FK list because that research only covered safety tables — `gps_tracks.ride_id` almost certainly FKs `rides(id)` given the table's purpose; confirm via the same `information_schema` query pattern used throughout this plan, and add a delete for it if missing, following the exact pattern of every prior fix in `deleteRideAndDescendantsOnce`).

- [ ] **Step 3: Run and verify at least twice back-to-back**

Run: `cd api && npx vitest run tests/integration/m09.test.ts -t "TC-M09-009"`

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m09.test.ts
git commit -m "test(M09): add dispute trip-replay integration test with mocked geo service"
```

---

## Task 6: Full-file stability verification

**Files:**
- No new files — verification pass, same shape as the M07/M08 plan's Task 8.

- [ ] **Step 1: Run the complete file 3+ times back-to-back**

```powershell
cd api
npx vitest run tests/integration/m09.test.ts
```
Run at least 3 times. All 9 test cases must pass every time (0 remaining `it.todo()`).

- [ ] **Step 2: Run the full integration suite once**

```powershell
npx vitest run tests/integration
```
Confirm no regression in M01-M08's existing tests, and note the wall-clock time (informational only — `fileParallelism: false` is already accepted project-wide from the M07/M08 work, nothing new to decide here).

- [ ] **Step 3: Check `ci.yml` needs no further changes**

M07/M08's Task 8 already added `RAZORPAY_KEY_ID`/`SECRET`/`WEBHOOK_SECRET` and confirmed the `postgres` service + `TEST_DATABASE_URL` provisioning. M09 introduces no new external dependency (no new env vars, no new service) — confirm this is actually true by checking whether `geo.service.ts`'s `getRoute` needs a `GOOGLE_MAPS_API_KEY`-equivalent env var that might be unset in CI (it's mocked in Task 5's test, but confirm nothing else in the M09 test file accidentally exercises the real geo service unmocked).

- [ ] **Step 4: Commit if anything changed**

Only if Step 3 found a real gap — otherwise this task produces no commit, just a verification report.

---

## Self-review notes

- **Spec coverage**: all 9 original stubs get real tests. TC-M09-006's scope was corrected (evidence-upload half removed, explained why) rather than faked.
- **No placeholders**: Task 2's Step 2 explicitly flags and fixes the one intentional placeholder (`+ '9'` phone concatenation) before it would ever run — left visible in Step 1's code block deliberately, as a flag for the implementing engineer, not shipped as final.
- **Reuse discipline**: every task reuses `loginUser`/`loginDriver`/`setupOnlineDriver`/`driveRideToCompletion`/`cleanupRideAndDriverData`/`DEFAULT_BOOKING` from the existing M07/M08 fixture rather than re-deriving ride-completion setup a fourth time — the file-local-duplication mistake from the M07/M08 plan's Task 5/6 is not repeated here.
- **Known risk areas flagged, not guessed past**: Task 4's fire-and-forget timing question and Task 5's geo-service mock point are both explicit read-first steps, not assumed code — matching the discipline that caught two real races and one real production bug in the M07/M08 plan.
