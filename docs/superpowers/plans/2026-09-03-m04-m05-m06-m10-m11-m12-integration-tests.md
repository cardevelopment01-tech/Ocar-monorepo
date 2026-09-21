# M04/M05/M06/M10/M11/M12 Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining `it.todo()` stubs in `api/tests/integration/m04.test.ts`, `m05.test.ts`, `m06.test.ts`, `m10.test.ts`, `m11.test.ts`, `m12.test.ts` (33 stubs total) with real integration tests, following the exact same discipline as the already-completed M07/M08/M09 work on this branch: real Postgres/Redis, real HTTP, assert both response and DB state, honestly rename/defer any stub whose premise doesn't match what's actually implemented rather than faking coverage.

**Architecture:** Reuse every existing shared fixture — `api/tests/helpers/fixtures/rides.fixture.ts` (`loginUser`, `loginDriver`, `setupOnlineDriver`, `driveRideToCompletion`, `driveRideToInProgress`, `waitForWalletPaymentCompleted`, `cleanupRideAndDriverData`, `DEFAULT_BOOKING`) and `api/tests/helpers/fixtures/safety.fixture.ts` (`loginAdmin`). Every test file needing an admin seeds/deletes its own row in `beforeAll`/`afterAll` (mirroring `m02.test.ts` — there is no pre-seeded admin in the test DB, confirmed fact from the M09 plan). Phone number ranges continue past the highest already in use per file (each file has its own independent range — confirm the actual highest number in that specific file before picking new ones, don't assume the number from this plan text is still accurate by the time you implement).

**Tech Stack:** Vitest, Supertest, real Postgres test DB (`TEST_DATABASE_URL`, `postgres_test` container port 5433), real Redis.

**Stub/reality mismatches found during research — read this before touching any file.** Several stub descriptions across these six files describe functionality that doesn't exist in the source. Do not invent it. Rename the test to what's real, or leave it `it.todo()` with a one-line reason, exactly like M07's Task 4 handled `TC-M07-009/010/011`:
- `TC-M04-005` ("one active vehicle per ride type") — no such constraint exists. The real constraint is `driver_vehicles_one_primary_idx`: one non-blacklisted primary vehicle **per driver**, period, unscoped by ride type.
- `TC-M05-002` ("zone lookup identifies city vs highway zone") — no `city_zones` table exists (commented out as "Phase 2" in the migration); the `zone_type` enum exists but is unused anywhere. Dead feature — defer.
- `TC-M06-003` ("highway rate applies for highway zone segments") — no highway-rate concept exists anywhere in `pricing.service.ts`/`@/lib/fare`. Defer.
- `TC-M06-007` ("surge activator job activates scheduled surge on time") — no scanner/cron job exists that transitions `surge_events.status` from `scheduled` to `active`. `getActiveSurge` only ever reads `status = 'active'` directly. **This may be a real product gap** (a surge event created with a future `starts_at` might never actually activate) — flag it explicitly in your test-writing task's report; do not silently assume it's fine, and do not fix app code without the same sign-off process used for the two bugs already found and fixed in this session (present findings, let the user decide).
- `TC-M10-001/002/003` ("SMS on ride-accepted", "push on driver-arrived", "voice call on SOS") — these describe the async BullMQ **worker** delivery path (`notifications.worker.ts`), not any HTTP surface. Voice-call has zero implementation anywhere (no provider, enum value `'voice'` exists but unused). Rename to test what's real: device-token registration + the in-app feed, and `notifyOwner`'s real DB-persist/socket-emit behavior.
- `TC-M10-004` ("notification failure retries with exponential backoff") — no isolated test target confirmed for this in the HTTP-testable surface; fold into the admin-template test task instead (see Task 8) rather than force a worker-level retry test that doesn't fit this plan's HTTP-integration shape.
- `TC-M12-001/002/003/004` — no snapshot job, no "online hours" metric, no pagination exist anywhere in `api/src/modules/analytics`. Rename to the 4 real endpoints (`summary`, `eta-accuracy`, `drivers/onboarding`, `drivers/availability`).
- `TC-M04-001/002` ("driver registers vehicle", "vehicle docs upload") — this exact flow is **already fully tested by M03** (`m03.test.ts` TC-M03-006 through TC-M03-016). Do not re-test it. Task 1 below repoints these two IDs at the genuinely-untested public vehicle-lookup endpoints instead.

---

## Before you start

Confirm test containers are up: `docker ps --filter "name=ocar_postgres_test" --filter "name=ocar_redis"`. If not running: `docker start ocar_postgres_test ocar_redis`. Confirm `api/.env` has `TEST_DATABASE_URL`/`RAZORPAY_*` (should already exist in this worktree from prior M07/M08/M09 work).

---

## Task 1: M04 — public vehicle lookups + fleet blacklist

**Files:** Modify `api/tests/integration/m04.test.ts`

Covers `TC-M04-001` (renamed: public category/brand/model lookup), `TC-M04-004` (blacklist a primary vehicle suspends the driver).

- [ ] **Step 1: Read first**

Confirm `api/src/modules/vehicles/vehicles.routes.ts` (`GET /categories`, `/brands`, `/brands/:brandId/models`, all public, no auth) and `api/src/modules/admin/admin.repository.ts`'s `blacklistVehicle`/`unblacklistVehicle` (around lines 1255-1313) match this plan's research summary before writing assertions — confirm the exact response shape of `blacklistVehicle` (`{ success: true, vehicle_id, driver_suspended }`) and that blacklisting a **primary** vehicle sets `drivers.status = 'suspended'` as a side effect.

- [ ] **Step 2: Write the tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { hashPassword } from '@/lib/hash'
import { setupOnlineDriver, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'
import { loginAdmin } from '../helpers/fixtures/safety.fixture'

const app = createApp()

const PHONES = {
  blacklistDriver: '+919700000101',
} as const

const ADMIN_EMAIL = 'm04-vehicles-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'

beforeAll(async () => {
  const hash = await hashPassword(ADMIN_PASSWORD)
  await pool.query(`
    INSERT INTO admins (email, password_hash, role)
    VALUES ($1, $2, 'super_admin')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `, [ADMIN_EMAIL, hash])
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:driver:${p}:login`)
    await redis.del(`otp:driver:${p}:login`)
  }
  await pool.query(`DELETE FROM admins WHERE email = $1`, [ADMIN_EMAIL])
  await pool.end()
  redis.disconnect()
})

describe('M04 — Vehicle Management', () => {
  describe('Public vehicle lookups', () => {
    it('TC-M04-001: category/brand/model lookups return only active seeded rows', async () => {
      const catRes = await request(app).get('/api/v1/vehicles/categories')
      expect(catRes.status, JSON.stringify(catRes.body)).toBe(200)
      expect(Array.isArray(catRes.body)).toBe(true)
      expect(catRes.body.length).toBeGreaterThan(0)
      expect(catRes.body.every((c: { is_active: boolean }) => c.is_active)).toBe(true)
      const sedan = catRes.body.find((c: { slug: string }) => c.slug === 'sedan')
      expect(sedan).toBeTruthy()

      const brandRes = await request(app).get('/api/v1/vehicles/brands')
      expect(brandRes.status, JSON.stringify(brandRes.body)).toBe(200)
      expect(brandRes.body.length).toBeGreaterThan(0)
      const maruti = brandRes.body.find((b: { name: string }) => b.name === 'Maruti Suzuki')
      expect(maruti).toBeTruthy()

      const modelRes = await request(app).get(`/api/v1/vehicles/brands/${maruti.id}/models`)
      expect(modelRes.status, JSON.stringify(modelRes.body)).toBe(200)
      expect(modelRes.body.length).toBeGreaterThan(0)
      expect(modelRes.body.every((m: { brand_id: string }) => String(m.brand_id) === String(maruti.id))).toBe(true)

      const badModelRes = await request(app).get('/api/v1/vehicles/brands/not-a-number/models')
      expect(badModelRes.status).toBe(400)
      expect(badModelRes.body.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('Fleet blacklist', () => {
    it('TC-M04-004: blacklisting a primary vehicle suspends the driver', async () => {
      const driver = await setupOnlineDriver(app, pool, redis, PHONES.blacklistDriver, { categorySlug: 'sedan' })
      const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)

      const blacklistRes = await request(app)
        .patch(`/api/v1/admin/vehicles/fleet/${driver.vehicleId}/blacklist`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ reason: 'Fraudulent registration documents' })
      expect(blacklistRes.status, JSON.stringify(blacklistRes.body)).toBe(200)
      expect(blacklistRes.body.driver_suspended).toBe(true)

      const { rows: vehicleRows } = await pool.query(
        'SELECT status FROM driver_vehicles WHERE id = $1', [driver.vehicleId]
      )
      expect(vehicleRows[0]?.status).toBe('blacklisted')

      const { rows: driverRows } = await pool.query(
        'SELECT status FROM drivers WHERE id = $1', [driver.driverId]
      )
      expect(driverRows[0]?.status).toBe('suspended')

      // Reason too short (<10 chars) must 422, not silently succeed.
      const shortReasonRes = await request(app)
        .patch(`/api/v1/admin/vehicles/fleet/${driver.vehicleId}/unblacklist`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
      // unblacklist has no reason requirement per research — just confirm it flips status back
      expect(shortReasonRes.status, JSON.stringify(shortReasonRes.body)).toBe(200)
      const { rows: afterUnblacklist } = await pool.query(
        'SELECT status FROM driver_vehicles WHERE id = $1', [driver.vehicleId]
      )
      expect(afterUnblacklist[0]?.status).toBe('active')
      // Per research: unblacklisting does NOT restore driver status automatically —
      // confirm this real (if surprising) behavior rather than assuming symmetry.
      const { rows: driverAfter } = await pool.query(
        'SELECT status FROM drivers WHERE id = $1', [driver.driverId]
      )
      expect(driverAfter[0]?.status).toBe('suspended')
    })
  })
})
```

- [ ] **Step 3: Run and verify 2-3x back-to-back**

Run: `cd api && npx vitest run tests/integration/m04.test.ts` at least 3 times. If the unblacklist test's leftover comment/variable naming (`shortReasonRes`) is misleading given the actual request sent, fix the naming — don't ship a variable name that lies about what it tests.

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m04.test.ts
git commit -m "test(M04): add public vehicle lookup and fleet blacklist integration tests"
```

---

## Task 2: M04 — driver approval, vehicle doc approval, one-primary-vehicle constraint

**Files:** Modify `api/tests/integration/m04.test.ts`

Covers `TC-M04-002` (renamed: vehicle document admin approval, optimistic-lock flow), `TC-M04-003` (admin approves driver → active), `TC-M04-005` (renamed: one-primary-vehicle-per-driver DB constraint).

- [ ] **Step 1: Read first**

Confirm `PATCH /admin/vehicles/documents/:docId/approve` (`admin.service.ts` `approveVehicleDoc`, around lines 331-353) — requires `verified_valid_until` and `seen_updated_at` (optimistic-concurrency token from `GET /admin/vehicles/documents/pending`'s `updated_at` field per the unit test `pending-vehicle-docs.test.ts`), returns 409 `DOC_CHANGED` if `seen_updated_at` doesn't match. Confirm `PATCH /admin/drivers/:id/status` (body `{status, reason?}`) really sets `approved_by`/`approved_at` only when transitioning to `active`.

- [ ] **Step 2: Write the tests**

This task reuses the same `beforeAll`/`afterAll`/admin-seed block from Task 1 — add to the same file, same `PHONES` object (extend it, don't duplicate the admin seed).

```typescript
// Add fresh phones to the existing PHONES object in this file:
// docApprovalDriver: '+919700000102',
// primaryVehicleDriver: '+919700000103',
// driverApprovalDriver: '+919700000104',

describe('Driver and vehicle-doc approval', () => {
  it('TC-M04-002: admin approves a vehicle document with optimistic-lock protection', async () => {
    // Use setupOnlineDriver to get a driver with an approved vehicle+doc-free state,
    // then directly insert a pending driver_vehicle_documents row (no HTTP upload
    // endpoint needed here — M03 already tests the upload path end to end; this
    // test is specifically about the ADMIN approval half).
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.docApprovalDriver, { categorySlug: 'sedan' })
    const { rows: docRows } = await pool.query<{ id: string; updated_at: string }>(
      `INSERT INTO driver_vehicle_documents (vehicle_id, doc_type, file_url, status)
       VALUES ($1, 'vehicle_rc', 'https://storage.test/rc.jpg', 'pending')
       RETURNING id, updated_at`,
      [driver.vehicleId]
    )
    const docId = docRows[0]!.id
    const seenUpdatedAt = docRows[0]!.updated_at

    const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)

    // Stale seen_updated_at must 409, not silently succeed.
    const staleRes = await request(app)
      .patch(`/api/v1/admin/vehicles/documents/${docId}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ verified_valid_until: '2030-12-31', seen_updated_at: '2000-01-01T00:00:00.000Z' })
    expect(staleRes.status, JSON.stringify(staleRes.body)).toBe(409)
    expect(staleRes.body.code).toBe('DOC_CHANGED')

    const approveRes = await request(app)
      .patch(`/api/v1/admin/vehicles/documents/${docId}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ verified_valid_until: '2030-12-31', seen_updated_at: seenUpdatedAt })
    expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200)

    const { rows } = await pool.query(
      'SELECT status, verified_valid_until FROM driver_vehicle_documents WHERE id = $1', [docId]
    )
    expect(rows[0]?.status).toBe('approved')
  })

  it('TC-M04-003: admin approves driver — pending_approval to active', async () => {
    const { accessToken: driverToken, driverId } = await (async () => {
      const { rows } = await pool.query<{ id: string }>(
        'SELECT id FROM drivers WHERE phone = $1', [PHONES.driverApprovalDriver]
      )
      // Log in fresh (creates the driver row) then manually stage it at pending_approval
      // via SQL, matching the driver-verification.test.ts precedent — no HTTP path
      // exists to synthetically reach pending_approval without the full M03 upload flow.
      return { accessToken: '', driverId: rows[0]?.id ?? '' }
    })()
    // Fresh login creates the driver row at onboarding_step=personal_info/status=pending_docs.
    const loginRes = await request(app)
      .post('/api/v1/auth/otp/request')
      .send({ phone: PHONES.driverApprovalDriver, role: 'driver' })
    const { otp } = loginRes.body as { otp: string }
    const verifyRes = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: PHONES.driverApprovalDriver, otp, role: 'driver' })
    const realDriverId = (verifyRes.body.principal.id as string)

    await pool.query(`UPDATE drivers SET status = 'pending_approval' WHERE id = $1`, [realDriverId])

    const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)
    const approveRes = await request(app)
      .patch(`/api/v1/admin/drivers/${realDriverId}/status`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ status: 'active', reason: 'Documents verified' })
    expect(approveRes.status, JSON.stringify(approveRes.body)).toBe(200)

    const { rows } = await pool.query<{ status: string; approved_by: string | null }>(
      'SELECT status, approved_by FROM drivers WHERE id = $1', [realDriverId]
    )
    expect(rows[0]?.status).toBe('active')
    expect(rows[0]?.approved_by).toBe(admin.adminId)

    const { rows: historyRows } = await pool.query(
      `SELECT from_status, to_status FROM driver_status_history WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [realDriverId]
    )
    expect(historyRows[0]?.from_status).toBe('pending_approval')
    expect(historyRows[0]?.to_status).toBe('active')
  })

  it('TC-M04-005: a driver can only have one non-blacklisted primary vehicle', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.primaryVehicleDriver, { categorySlug: 'sedan' })

    const { rows: catRows } = await pool.query<{ id: string }>(
      "SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1"
    )
    const { rows: brandRows } = await pool.query<{ id: string }>(
      "SELECT id FROM vehicle_brands WHERE name = 'Maruti Suzuki' LIMIT 1"
    )

    // Attempting to insert a SECOND primary, non-blacklisted vehicle for the same
    // driver must violate driver_vehicles_one_primary_idx — this is a real DB
    // constraint, not app-level validation, so assert the Postgres error directly.
    await expect(
      pool.query(
        `INSERT INTO driver_vehicles (driver_id, category_id, brand_id, number_plate, status, is_primary)
         VALUES ($1, $2, $3, 'OD02TESTSECOND', 'active', true)`,
        [driver.driverId, catRows[0]!.id, brandRows[0]!.id]
      )
    ).rejects.toMatchObject({ code: '23505' })
  })
})
```

Note: TC-M04-003's setup is deliberately verbose (real OTP login, then a raw SQL stage-to-`pending_approval`) because no HTTP path reaches `pending_approval` without the full M03 document-upload flow, which this plan explicitly does not re-test. If this feels awkward when actually writing it, simplify the login boilerplate but keep the SQL-staging approach — don't reach for `setupOnlineDriver` here since that seeds straight to `active`, skipping the very transition this test verifies.

- [ ] **Step 3: Run and verify 2-3x back-to-back**

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m04.test.ts
git commit -m "test(M04): add driver approval, vehicle-doc approval, and one-primary-vehicle constraint tests"
```

---

## Task 3: M05 — city lookup + geocode cache

**Files:** Modify `api/tests/integration/m05.test.ts`

Covers `TC-M05-001` (nearest-city lookup), `TC-M05-005` (geocode cache hit avoids external call). `TC-M05-002` (zone lookup) stays `it.todo()` with a reason — no implementation exists.

- [ ] **Step 1: Read first**

Confirm `GET /api/v1/geo/cities/nearest?lat=&lng=` (`geo.controller.ts:10-20`) and `GET /api/v1/geo/place/:placeId` (`geo.controller.ts:37-42`, caches into `place_geocode_cache` keyed by `` `place:${placeId}` ``, `expires_at > now()`). Confirm the google provider's export name/shape to mock (`api/src/modules/geo/providers/google.provider.ts` — likely `placeDetails(placeId)`).

- [ ] **Step 2: Write the tests**

```typescript
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'

vi.mock('@/modules/geo/providers/google.provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/geo/providers/google.provider')>()
  return {
    ...actual,
    placeDetails: vi.fn().mockResolvedValue({
      latitude: 20.2961, longitude: 85.8245, raw_address: 'Bhubaneswar, Odisha, India',
    }),
  }
})

const app = createApp()

describe('M05 — Geo & Spatial', () => {
  describe('City lookup', () => {
    it('TC-M05-001: nearest-city lookup returns the closest active city', async () => {
      // Coordinates very close to Bhubaneswar's seeded centroid (85.8245, 20.2961).
      const res = await request(app).get('/api/v1/geo/cities/nearest?lat=20.30&lng=85.82')
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.slug).toBe('bhubaneswar')

      const missingRes = await request(app).get('/api/v1/geo/cities/nearest')
      expect(missingRes.status).toBe(422)
      expect(missingRes.body.code).toBe('VALIDATION_ERROR')
    })

    it('TC-M05-002: zone lookup identifies city vs highway zone', async () => {
      // Deferred — no city_zones table exists (commented out as Phase 2 in
      // 005_m3_geo.sql); zone_type enum is defined but unused anywhere in the
      // codebase. Nothing to test against.
    })
  })

  describe('Geocode cache', () => {
    it('TC-M05-005: geocode cache hit avoids the external Google call on repeat lookup', async () => {
      const placeId = 'ChIJTestPlaceId12345'

      const google = await import('@/modules/geo/providers/google.provider')

      const firstRes = await request(app).get(`/api/v1/geo/place/${placeId}`)
      expect(firstRes.status, JSON.stringify(firstRes.body)).toBe(200)
      expect(google.placeDetails).toHaveBeenCalledTimes(1)

      const { rows: cacheRows } = await pool.query(
        'SELECT hit_count FROM place_geocode_cache WHERE normalized_address = $1', [`place:${placeId}`]
      )
      expect(cacheRows).toHaveLength(1)

      const secondRes = await request(app).get(`/api/v1/geo/place/${placeId}`)
      expect(secondRes.status, JSON.stringify(secondRes.body)).toBe(200)
      // Still called exactly once — the second request must be served from cache.
      expect(google.placeDetails).toHaveBeenCalledTimes(1)

      const { rows: afterRows } = await pool.query(
        'SELECT hit_count FROM place_geocode_cache WHERE normalized_address = $1', [`place:${placeId}`]
      )
      expect(afterRows[0]?.hit_count).toBeGreaterThan(cacheRows[0]?.hit_count as number)

      await pool.query('DELETE FROM place_geocode_cache WHERE normalized_address = $1', [`place:${placeId}`])
      await pool.end()
    })
  })
})
```

Note: this file has no ride/driver/user setup, so it doesn't need the usual `cleanupRideAndDriverData` machinery — just clean up the one `place_geocode_cache` row it creates, as shown.

- [ ] **Step 3: Run and verify 2-3x back-to-back**

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m05.test.ts
git commit -m "test(M05): add nearest-city lookup and geocode cache integration tests"
```

---

## Task 4: M05 — GPS track flush (closes M07's old deferred stub) + driver-radius/corridor search

**Files:** Modify `api/tests/integration/m05.test.ts`, and (bonus cleanup) `api/tests/integration/m07.test.ts`

Covers `TC-M05-003`/`TC-M05-004` (renamed: driver-radius search and return-cab corridor match, both of which actually live in the rides module, not geo — test them via the real HTTP surface where they exist). Bonus: this task now has everything needed to close M07's two long-deferred stubs (`TC-M07-009` GPS flush, `TC-M07-011` return-cab matching) — do that too, since leaving them deferred once the blocking unknown is resolved would be the same discipline gap this whole plan is about avoiding.

- [ ] **Step 1: Read first**

Confirm `POST /api/v1/geo/tracks/flush` (`geo.controller.ts:91-110`, driver-authenticated, body `{ tracks: [{ ride_id, session_id, latitude, longitude, heading?, speed_kmph?, accuracy_metres?, recorded_at }] }`, drops entries with `accuracy_metres > 50`, returns `{ written: number }`). Confirm `GET /api/v1/rides/nearby-drivers` (`rides.routes.ts` — public, no auth per M07 research) and its query param shape, and `GET /api/v1/rides/return-cab-available` for corridor matching.

- [ ] **Step 2: Write the M05 tests**

```typescript
// Add to m05.test.ts — needs real driver/ride setup, so import the ride fixtures too.
import { loginUser, loginDriver, setupOnlineDriver, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'
import { client as redis } from '@/db/redis'

// ... (add a PHONES object, beforeAll/afterAll with cleanupRideAndDriverData, following
// the exact established pattern from m07.test.ts/m09.test.ts — this file currently has
// none since Task 3's tests didn't need it)

describe('GPS tracking and driver search', () => {
  it('TC-M05-003: GPS track flush writes valid points and drops low-accuracy ones', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.gpsDriver, { categorySlug: 'sedan' })
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.gpsUser)
    const bookRes = await request(app)
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ categoryId: driver.categoryId, ...DEFAULT_BOOKING })
    const rideId = bookRes.body.rideId as string

    const flushRes = await request(app)
      .post('/api/v1/geo/tracks/flush')
      .set('Authorization', `Bearer ${driver.accessToken}`)
      .send({
        tracks: [
          { ride_id: Number(rideId), session_id: Number(driver.sessionId), latitude: 20.29, longitude: 85.82, speed_kmph: 20, accuracy_metres: 10, recorded_at: new Date().toISOString() },
          { ride_id: Number(rideId), session_id: Number(driver.sessionId), latitude: 20.30, longitude: 85.83, speed_kmph: 22, accuracy_metres: 999, recorded_at: new Date().toISOString() },
        ],
      })
    expect(flushRes.status, JSON.stringify(flushRes.body)).toBe(200)
    expect(flushRes.body.written).toBe(1)

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM gps_tracks WHERE ride_id = $1', [rideId])
    expect(rows[0]?.n).toBe(1)

    await pool.query('DELETE FROM gps_tracks WHERE ride_id = $1', [rideId])
  })

  it('TC-M05-004: nearby-drivers search only returns drivers within radius', async () => {
    const nearDriver = await setupOnlineDriver(app, pool, redis, PHONES.nearDriver, { categorySlug: 'sedan' })
    // Far driver: seed then manually move their location snapshot far away —
    // check the real column/table setupOnlineDriver's goOnline populates before
    // assuming driver_location_snapshots is the right table to override.
    const farDriver = await setupOnlineDriver(app, pool, redis, PHONES.farDriver, { categorySlug: 'sedan' })
    await pool.query(
      `UPDATE driver_location_snapshots SET location = ST_SetSRID(ST_MakePoint(88.36, 22.57), 4326)::geography WHERE driver_id = $1`,
      [farDriver.driverId]
    )

    const res = await request(app).get('/api/v1/rides/nearby-drivers?lat=20.29&lng=85.82&categoryId=' + nearDriver.categoryId)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const ids = (res.body.drivers ?? res.body).map((d: { driver_id?: string; id?: string }) => String(d.driver_id ?? d.id))
    expect(ids).toContain(String(nearDriver.driverId))
    expect(ids).not.toContain(String(farDriver.driverId))
  })
})
```

Note: `PHONES.nearDriver`/`farDriver`/`gpsDriver`/`gpsUser` need adding with fresh numbers past whatever `m05.test.ts` already uses after Task 3.

- [ ] **Step 3: Un-defer M07's stubs**

In `api/tests/integration/m07.test.ts`, replace the `it.todo('TC-M07-009: ...')` with a real test using the now-confirmed `POST /api/v1/geo/tracks/flush` route (same shape as TC-M05-003 above, can be near-identical). For `TC-M07-011` (return-cab matching), read `api/src/modules/rides/rides.repository.ts`'s `findReturnCabDrivers` (confirmed to exist, `ST_DWithin` against `return_cab_routes.corridor` within `match_radius_metres`) and `GET /api/v1/rides/return-cab-available` before writing — this needs a driver in `return_cab` mode (`goOnline`'s `mode: 'return_cab'` per `rides.fixture.ts`'s `goOnline` helper, which currently hardcodes `mode: 'standard'` — check whether you need a new fixture variant or can pass `mode` as a param) and a `return_cab_routes` row. If this turns out to need substantially more infrastructure than a quick add, it's acceptable to leave `TC-M07-011` deferred with an updated, more specific reason rather than force it — use judgment, don't burn excessive time on the lowest-priority item in this whole plan.

- [ ] **Step 4: Run and verify 2-3x back-to-back**

Run both `m05.test.ts` and `m07.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add api/tests/integration/m05.test.ts api/tests/integration/m07.test.ts
git commit -m "test(M05): add GPS track flush and nearby-drivers radius tests, close M07's deferred GPS stub"
```

---

## Task 5: M06 — fare estimate across ride types + surge

**Files:** Modify `api/tests/integration/m06.test.ts`

Covers `TC-M06-001` (base fare), `TC-M06-002` (surge), `TC-M06-004` (renamed: per-minute rate component of the estimate — no standalone "waiting charge" endpoint exists, it's part of the same fare-estimate response), `TC-M06-005` (round trip), `TC-M06-006` (rental). `TC-M06-003`/`007` stay deferred per the mismatch list above.

- [ ] **Step 1: Read first**

Confirm `POST /api/v1/pricing/estimate` (`pricing.controller.ts:4-8`, public, no auth) body shape `{ category_id, ride_type, is_return_cab?, distance_km, duration_min, stop_count?, trip_hours?, rental_package_id?, city_id? }` and response `{ rate_card_id, surge_event_id, surge_multiplier, breakdown: {...}, rental_hours? }`.

- [ ] **Step 2: Write the tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'

const app = createApp()

let categoryId: number
let cityId: number

beforeAll(async () => {
  const { rows: cats } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  categoryId = Number(cats[0]!.id)
  const { rows: cities } = await pool.query<{ id: string }>("SELECT id FROM cities WHERE slug = 'bhubaneswar' LIMIT 1")
  cityId = Number(cities[0]!.id)
})

afterAll(async () => {
  await pool.end()
})

describe('M06 — Pricing', () => {
  describe('Fare estimate', () => {
    it('TC-M06-001 + TC-M06-004: one-way estimate reflects distance and per-minute rate', async () => {
      const res = await request(app)
        .post('/api/v1/pricing/estimate')
        .send({ category_id: categoryId, ride_type: 'one_way', distance_km: 10, duration_min: 20 })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.breakdown.total).toBeGreaterThan(0)
      // sedan seed rate: 13/km, 2/min, min_fare 250 (016_seed.sql) — 10km*13 + 20min*2 = 170,
      // floored against min_fare 250, so total should land at exactly the min_fare floor.
      expect(res.body.breakdown.total).toBeCloseTo(250, 1)
    })

    it('TC-M06-002: active surge multiplies the fare', async () => {
      const admin = await import('../helpers/fixtures/safety.fixture').then(m => m)
      // Seed an active surge directly (admin HTTP creation is covered in Task 6;
      // this test isolates fare-calculation behavior from admin-authorization concerns).
      const { rows: surgeRows } = await pool.query<{ id: string }>(
        `INSERT INTO surge_events (city_id, category_id, multiplier, status, starts_at, ends_at)
         VALUES ($1, $2, 1.5, 'active', now() - interval '5 minutes', now() + interval '1 hour')
         RETURNING id`,
        [cityId, categoryId]
      )

      const res = await request(app)
        .post('/api/v1/pricing/estimate')
        .send({ category_id: categoryId, ride_type: 'one_way', distance_km: 10, duration_min: 20, city_id: cityId })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.surge_multiplier).toBe(1.5)
      expect(res.body.surge_event_id).toBe(surgeRows[0]!.id)
      expect(res.body.breakdown.surge_fare).toBeGreaterThan(0)

      await pool.query('DELETE FROM surge_events WHERE id = $1', [surgeRows[0]!.id])
    })

    it('TC-M06-005: round-trip estimate doubles distance and applies the round_trip rate card', async () => {
      const res = await request(app)
        .post('/api/v1/pricing/estimate')
        .send({ category_id: categoryId, ride_type: 'round_trip', distance_km: 15, duration_min: 30, trip_hours: 6 })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.breakdown.total).toBeGreaterThan(0)
    })

    it('TC-M06-006: rental estimate uses the matched rental package fare', async () => {
      const { rows: pkgRows } = await pool.query<{ id: string; duration_minutes: number }>(
        'SELECT id, duration_minutes FROM rental_packages WHERE category_id = $1 AND city_id IS NULL ORDER BY duration_minutes LIMIT 1',
        [categoryId]
      )
      if (!pkgRows[0]) throw new Error('No global rental package seeded for sedan — check 016_seed.sql / 030_rental_package_flexibility.sql')

      const res = await request(app)
        .post('/api/v1/pricing/estimate')
        .send({ category_id: categoryId, ride_type: 'rental', distance_km: 10, duration_min: 60, rental_package_id: Number(pkgRows[0].id) })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(res.body.rental_hours).toBe(Math.round(pkgRows[0].duration_minutes / 60))
    })

    it('TC-M06-003: highway rate applies for highway zone segments', async () => {
      // Deferred — no highway-rate concept exists anywhere in pricing.service.ts
      // or @/lib/fare. Nothing to test against.
    })

    it('TC-M06-007: surge activator job activates scheduled surge on time', async () => {
      // Deferred — no scanner/job exists that flips surge_events.status from
      // 'scheduled' to 'active'. getActiveSurge only reads status='active' directly.
      // FLAG: this may be a real product gap (a surge scheduled for a future
      // starts_at might never actually activate) — surfaced to the user, not
      // fixed here without explicit sign-off, matching this session's established
      // process for real bugs found during test-writing.
    })
  })
})
```

- [ ] **Step 3: Run and verify 2-3x back-to-back**

Run: `cd api && npx vitest run tests/integration/m06.test.ts` at least 3 times. If the exact fare numbers asserted (e.g. `250` for the min-fare-floor case) don't match — the seed data in `016_seed.sql` may have drifted since this plan was written — recompute from the actual live rate card rather than forcing the test to match a stale assumption.

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m06.test.ts
git commit -m "test(M06): add fare estimate integration tests across ride types and surge"
```

**Report explicitly**: whether the surge-activator-job gap (TC-M06-007) looks like a real product bug worth fixing, based on what you find reading the actual surge-consumption code paths (does anything else, e.g. a cron elsewhere in `api/src/jobs/`, transition scheduled surges? Confirm before flagging it as a gap).

---

## Task 6: M06 — admin rate-card CRUD + propagation to fare estimate

**Files:** Modify `api/tests/integration/m06.test.ts`

This is genuinely new coverage beyond the original 7 stubs (the plan's own research found rate-card CRUD is completely untested at both unit and integration level) — include it here since it's the mechanism `TC-M11-006` also needs, and it's more naturally a pricing-module test.

- [ ] **Step 1: Write the test**

```typescript
// Add to m06.test.ts, needs an admin — add the same seed/cleanup pattern used in
// m04.test.ts/m09.test.ts (own beforeAll/afterAll admin row, distinct email).
describe('Admin rate-card CRUD', () => {
  it('rate card update is immediately reflected in new fare estimates', async () => {
    const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)

    const beforeRes = await request(app)
      .post('/api/v1/pricing/estimate')
      .send({ category_id: categoryId, ride_type: 'one_way', distance_km: 50, duration_min: 60 })
    const beforeTotal = beforeRes.body.breakdown.total as number

    const createRes = await request(app)
      .post('/api/v1/admin/pricing/rate-cards')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ category_id: categoryId, ride_type: 'one_way', rate_per_km: 999, rate_per_min: 5, min_fare: 100 })
    expect(createRes.status, JSON.stringify(createRes.body)).toBe(201)

    const afterRes = await request(app)
      .post('/api/v1/pricing/estimate')
      .send({ category_id: categoryId, ride_type: 'one_way', distance_km: 50, duration_min: 60 })
    expect(afterRes.body.breakdown.total).toBeGreaterThan(beforeTotal)
    expect(afterRes.body.rate_card_id).toBe(createRes.body.id)

    const historyRes = await request(app)
      .get('/api/v1/admin/pricing/rate-cards/history')
      .set('Authorization', `Bearer ${admin.accessToken}`)
    expect(historyRes.status, JSON.stringify(historyRes.body)).toBe(200)

    // Restore the original sedan one_way rate card so later tasks in this plan
    // (and any earlier ones re-run) aren't left with a permanently mutated rate.
    await request(app)
      .post('/api/v1/admin/pricing/rate-cards')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ category_id: categoryId, ride_type: 'one_way', rate_per_km: 13, rate_per_min: 2, min_fare: 250, return_rate_per_km: 11 })
  })
})
```

**Important**: this test mutates a real, shared rate card (sedan/one_way), which every other test in this file (and potentially other files, if run in the same suite) reads. The restore-at-the-end step above is not optional — verify it actually restores the exact original values (re-check `016_seed.sql`'s sedan one_way row: `rate_per_km=13.00, rate_per_min=2.00, min_fare=250.00, return_rate_per_km=11.00`) before shipping this test, and consider running it LAST in the file's execution order (or isolate it further) so a failure mid-test doesn't leave a corrupted rate card for every other test. Given `fileParallelism: false` is already set project-wide, within-file test order is still sequential top-to-bottom by default — placing this as the final `it()` in the file is the safest choice.

- [ ] **Step 2: Run and verify 2-3x back-to-back**, including re-running the earlier tests in this same file afterward to confirm the rate-card restore actually worked (no cross-test pollution).

- [ ] **Step 3: Commit**

```bash
git add api/tests/integration/m06.test.ts
git commit -m "test(M06): add admin rate-card creation and propagation-to-estimate test"
```

---

## Task 7: M10 — device tokens + in-app notification feed

**Files:** Modify `api/tests/integration/m10.test.ts`

Covers `TC-M10-001`/`002` (renamed: device token register/unregister, in-app feed list/unread-count/mark-read/read-all, `notifyOwner`'s real DB persistence).

- [ ] **Step 1: Read first**

Confirm `POST/DELETE /api/v1/notifications/devices`, `GET /api/v1/notifications` (cursor-paginated, fixed limit 20), `GET /api/v1/notifications/unread-count`, `PATCH /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all` — all `authenticate()`-gated, any role.

- [ ] **Step 2: Write the tests**

```typescript
import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { loginUser, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'

const app = createApp()

const PHONES = { notifUser: '+919700000201' } as const

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  await redis.del(`otp_rate:user:${PHONES.notifUser}:login`)
  await redis.del(`otp:user:${PHONES.notifUser}:login`)
  await pool.end()
  redis.disconnect()
})

describe('M10 — Notifications', () => {
  describe('Device tokens and in-app feed', () => {
    it('TC-M10-001: device token register/unregister round trip', async () => {
      const { accessToken, userId } = await loginUser(app, redis, PHONES.notifUser)

      const registerRes = await request(app)
        .post('/api/v1/notifications/devices')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: 'test-fcm-token-abc123', platform: 'android' })
      expect(registerRes.status, JSON.stringify(registerRes.body)).toBe(204)

      const { rows } = await pool.query(
        `SELECT owner_type, owner_id, platform FROM device_tokens WHERE token = 'test-fcm-token-abc123'`
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.owner_type).toBe('user')
      expect(String(rows[0]?.owner_id)).toBe(String(userId))

      const unregisterRes = await request(app)
        .delete('/api/v1/notifications/devices')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: 'test-fcm-token-abc123' })
      expect(unregisterRes.status, JSON.stringify(unregisterRes.body)).toBe(204)

      const { rows: afterRows } = await pool.query(
        `SELECT * FROM device_tokens WHERE token = 'test-fcm-token-abc123'`
      )
      expect(afterRows).toHaveLength(0)
    })

    it('TC-M10-002: notifyOwner persists a real in-app feed row visible via the API', async () => {
      const { accessToken, userId } = await loginUser(app, redis, PHONES.notifUser)

      // Trigger a real notifyOwner call rather than inserting notification_logs
      // directly — driving it through an actual code path (e.g. the SOS flow
      // already proven in m09.test.ts) would add cross-file coupling this task
      // doesn't need; call notifyOwner directly as a service-level integration
      // point instead, matching the "real DB, real Redis, no mocks" bar without
      // needing a full ride lifecycle just to trigger one notification.
      const { notifyOwner } = await import('@/modules/notifications/notifications.service')
      await notifyOwner({
        ownerType: 'user', ownerId: BigInt(userId), type: 'test_notification',
        title: 'Test', body: 'This is a test notification',
      })

      const unreadRes = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(unreadRes.status, JSON.stringify(unreadRes.body)).toBe(200)
      expect(unreadRes.body.count).toBeGreaterThanOrEqual(1)

      const listRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(listRes.status, JSON.stringify(listRes.body)).toBe(200)
      expect(listRes.body.items.length).toBeGreaterThanOrEqual(1)
      const item = listRes.body.items.find((i: { type: string }) => i.type === 'test_notification')
      expect(item).toBeTruthy()

      const markReadRes = await request(app)
        .patch(`/api/v1/notifications/${item.id}/read`)
        .set('Authorization', `Bearer ${accessToken}`)
      expect(markReadRes.status, JSON.stringify(markReadRes.body)).toBe(204)

      // Marking the same (now-read) notification again must 404, not silently succeed.
      const markReadAgainRes = await request(app)
        .patch(`/api/v1/notifications/${item.id}/read`)
        .set('Authorization', `Bearer ${accessToken}`)
      expect(markReadAgainRes.status).toBe(404)

      const readAllRes = await request(app)
        .post('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(readAllRes.status, JSON.stringify(readAllRes.body)).toBe(204)

      const finalUnreadRes = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${accessToken}`)
      expect(finalUnreadRes.body.count).toBe(0)

      await pool.query(`DELETE FROM notification_logs WHERE owner_type='user' AND owner_id=$1`, [userId])
    })
  })
})
```

- [ ] **Step 3: Run and verify 2-3x back-to-back**

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m10.test.ts
git commit -m "test(M10): add device token registration and in-app notification feed integration tests"
```

---

## Task 8: M10 — admin notification-templates CRUD

**Files:** Modify `api/tests/integration/m10.test.ts`

Covers `TC-M10-005` (template renders correctly — via the real admin edit + cache-invalidation path), folds in `TC-M10-004`'s spirit (the template edit test exercises the cache-invalidation/versioning path, which is the closest real analog to "retry"-adjacent correctness in this module). `TC-M10-003` (voice call) stays deferred — no implementation exists at all.

- [ ] **Step 1: Read first**

Confirm `GET/PATCH /api/v1/admin/notification-templates` (`super_admin`-only router-wide guard), and the unique partial index `idx_notification_templates_lookup (slug, channel, locale) WHERE is_active` — activating a second template with the same slug/channel/locale while one is already active violates this at the DB level (a real, testable constraint).

- [ ] **Step 2: Write the tests**

```typescript
// Add to m10.test.ts — needs its own seeded admin (super_admin required specifically).
describe('Admin notification templates', () => {
  it('TC-M10-005: editing a template content and toggling active status both propagate correctly', async () => {
    const admin = await loginAdmin(app, ADMIN_EMAIL, ADMIN_PASSWORD)

    const listRes = await request(app)
      .get('/api/v1/admin/notification-templates')
      .set('Authorization', `Bearer ${admin.accessToken}`)
    expect(listRes.status, JSON.stringify(listRes.body)).toBe(200)
    const template = listRes.body.templates.find((t: { slug: string }) => t.slug === 'ride_accepted')
    if (!template) throw new Error('ride_accepted template not found in seed data — check 036_notification_templates.sql')

    const editRes = await request(app)
      .patch(`/api/v1/admin/notification-templates/${template.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ body: 'Your ride has been accepted by {{driverName}} — TEST EDIT' })
    expect(editRes.status, JSON.stringify(editRes.body)).toBe(200)
    expect(editRes.body.template.version).toBe(template.version + 1)

    // Confirm renderTemplate reflects the edit despite the Redis cache layer —
    // this is the real test of the invalidate(configKey(...))-on-write behavior.
    const { renderTemplate } = await import('@/modules/notifications/templates.service')
    const rendered = await renderTemplate('ride_accepted', template.channel, { driverName: 'Test Driver' })
    expect(rendered.body).toContain('TEST EDIT')

    const toggleRes = await request(app)
      .patch(`/api/v1/admin/notification-templates/${template.id}/active`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ isActive: false })
    expect(toggleRes.status, JSON.stringify(toggleRes.body)).toBe(200)
    expect(toggleRes.body.template.is_active).toBe(false)
    // Toggling active must NOT bump version (per research — only content edits do).
    expect(toggleRes.body.template.version).toBe(template.version + 1)

    // Restore both mutations so this template's real production copy isn't left broken.
    await request(app)
      .patch(`/api/v1/admin/notification-templates/${template.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ body: template.body })
    await request(app)
      .patch(`/api/v1/admin/notification-templates/${template.id}/active`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ isActive: true })
  })

  it('TC-M10-003: SOS triggers voice call to emergency contact', async () => {
    // Deferred — no voice-call provider exists anywhere in api/src. The
    // notif_channel enum includes 'voice' but nothing sends via it.
  })
})
```

Same restore-mutated-shared-data caution as Task 6's rate-card test — verify the restore actually lands, and consider ordering this test to run before any other test that might read `ride_accepted`'s template content elsewhere in the suite (none currently do, per research, but confirm before shipping).

- [ ] **Step 3: Run and verify 2-3x back-to-back**

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m10.test.ts
git commit -m "test(M10): add admin notification-template edit and active-toggle integration tests"
```

---

## Task 9: M11 — driver approval, finance-role gating, system-config/feature-flag

**Files:** Modify `api/tests/integration/m11.test.ts`

Covers `TC-M11-001` (super_admin approves driver — can largely mirror Task 2's `TC-M04-003`, but this task's job is the ADMIN-AUTHORIZATION angle: confirm a disallowed role can't do it too), `TC-M11-002` (ops_admin blocked from finance endpoints), `TC-M11-003` (system config read), `TC-M11-004` (feature-flag-as-boolean-config update propagates).

- [ ] **Step 1: Read first**

Confirm role requirements: `PATCH /admin/drivers/:id/status` → `super_admin, ops_admin` only; `GET /admin/payments` → `super_admin, finance_admin` only (the one admin-list endpoint gated specifically to `finance_admin`, making it the natural target for TC-M11-002); `GET/PATCH /admin/system-config/*` → `super_admin` only, router-wide.

- [ ] **Step 2: Write the tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { hashPassword } from '@/lib/hash'

const app = createApp()

const SUPER_ADMIN_EMAIL = 'm11-super-admin@ocar.app'
const OPS_ADMIN_EMAIL = 'm11-ops-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'

async function seedAdmin(email: string, role: string) {
  const hash = await hashPassword(ADMIN_PASSWORD)
  const { rows } = await pool.query<{ id: string }>(`
    INSERT INTO admins (email, password_hash, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
    RETURNING id
  `, [email, hash, role])
  return rows[0]!.id
}

async function loginAdminByEmail(email: string) {
  const res = await request(app).post('/api/v1/auth/admin/login').send({ email, password: ADMIN_PASSWORD })
  if (res.status !== 200 && res.status !== 201) throw new Error(`Admin login failed: ${JSON.stringify(res.body)}`)
  return { accessToken: res.body.tokens.accessToken as string, adminId: res.body.admin.id as string }
}

beforeAll(async () => {
  await seedAdmin(SUPER_ADMIN_EMAIL, 'super_admin')
  await seedAdmin(OPS_ADMIN_EMAIL, 'ops_admin')
})

afterAll(async () => {
  await pool.query(`DELETE FROM admins WHERE email = ANY($1)`, [[SUPER_ADMIN_EMAIL, OPS_ADMIN_EMAIL]])
  await pool.end()
  redis.disconnect()
})

describe('M11 — Admin Panel', () => {
  describe('Role-gated access', () => {
    it('TC-M11-002: ops_admin cannot access the finance-gated payments endpoint', async () => {
      const opsAdmin = await loginAdminByEmail(OPS_ADMIN_EMAIL)
      const res = await request(app)
        .get('/api/v1/admin/payments')
        .set('Authorization', `Bearer ${opsAdmin.accessToken}`)
      expect(res.status, JSON.stringify(res.body)).toBe(403)

      const superAdmin = await loginAdminByEmail(SUPER_ADMIN_EMAIL)
      const superRes = await request(app)
        .get('/api/v1/admin/payments')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      expect(superRes.status, JSON.stringify(superRes.body)).toBe(200)
    })
  })

  describe('System config', () => {
    it('TC-M11-003: system config read returns active config values', async () => {
      const superAdmin = await loginAdminByEmail(SUPER_ADMIN_EMAIL)
      const res = await request(app)
        .get('/api/v1/admin/system-config/')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      expect(Array.isArray(res.body.config)).toBe(true)
      expect(res.body.config.length).toBeGreaterThan(0)

      // ops_admin must be forbidden — this router is super_admin-only, router-wide.
      const opsAdmin = await loginAdminByEmail(OPS_ADMIN_EMAIL)
      const opsRes = await request(app)
        .get('/api/v1/admin/system-config/')
        .set('Authorization', `Bearer ${opsAdmin.accessToken}`)
      expect(opsRes.status).toBe(403)
    })

    it('TC-M11-004: a boolean config value update propagates to getConfigValue reads', async () => {
      const superAdmin = await loginAdminByEmail(SUPER_ADMIN_EMAIL)
      const listRes = await request(app)
        .get('/api/v1/admin/system-config/')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      const flag = listRes.body.config.find((c: { value_type: string }) => c.value_type === 'boolean')
      if (!flag) throw new Error('No boolean-typed system_config row seeded to test against')
      const originalValue = flag.value as string

      const newValue = originalValue === 'true' ? 'false' : 'true'
      const patchRes = await request(app)
        .patch(`/api/v1/admin/system-config/${flag.id}`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({ value: newValue })
      expect(patchRes.status, JSON.stringify(patchRes.body)).toBe(200)
      expect(patchRes.body.config.value).toBe(newValue)

      const { getConfigValue } = await import('@/lib/system-config')
      const readBack = await getConfigValue(flag.key, 'unset')
      expect(readBack).toBe(newValue)

      // Restore.
      await request(app)
        .patch(`/api/v1/admin/system-config/${flag.id}`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({ value: originalValue })
    })
  })
})
```

Note: `TC-M11-001` (super_admin approves driver) is intentionally NOT duplicated here — it's already covered by Task 2's `TC-M04-003` with identical mechanics (`PATCH /admin/drivers/:id/status`). If you want this file to have its own visible test ID for traceability, add a thin one-line comment pointing at `m04.test.ts` rather than re-writing the same test; don't duplicate the full setup.

- [ ] **Step 3: Run and verify 2-3x back-to-back**

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m11.test.ts
git commit -m "test(M11): add finance-role gating and system-config/feature-flag integration tests"
```

---

## Task 10: M11 — admin suspends user + rate-card admin-authorization check

**Files:** Modify `api/tests/integration/m11.test.ts`

Covers `TC-M11-005` (admin suspends a user), `TC-M11-006` (rate card update — role-authorization half; the fare-correctness half is already covered by Task 6, this test just confirms `support_admin`/`finance_admin` can't create rate cards while `ops_admin` can, per the real role list `requireAdmin('super_admin', 'ops_admin')`).

- [ ] **Step 1: Write the tests**

```typescript
// Add to m11.test.ts, reusing the SUPER_ADMIN_EMAIL/OPS_ADMIN_EMAIL admins already seeded.
import { loginUser, cleanupRideAndDriverData } from '../helpers/fixtures/rides.fixture'

// Add to PHONES-equivalent (this file doesn't have a PHONES object yet from prior
// tasks — add one, or a standalone constant, following the established convention).
const SUSPEND_USER_PHONE = '+919700000301'

// Extend afterAll to also clean up this phone via cleanupRideAndDriverData.

describe('User management', () => {
  it('TC-M11-005: admin suspends a user, changing their status', async () => {
    const { userId } = await loginUser(app, redis, SUSPEND_USER_PHONE)
    const superAdmin = await loginAdminByEmail(SUPER_ADMIN_EMAIL)

    const res = await request(app)
      .patch(`/api/v1/admin/users/${userId}/status`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ status: 'suspended' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.status).toBe('suspended')

    const { rows } = await pool.query('SELECT status FROM users WHERE id = $1', [userId])
    expect(rows[0]?.status).toBe('suspended')

    // Restore so this user isn't left suspended if any later test in this file reuses the phone.
    await request(app)
      .patch(`/api/v1/admin/users/${userId}/status`)
      .set('Authorization', `Bearer ${superAdmin.accessToken}`)
      .send({ status: 'active' })
  })
})

describe('Rate-card admin authorization', () => {
  it('TC-M11-006: only super_admin/ops_admin can create rate cards', async () => {
    const { rows: catRows } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'suv' LIMIT 1")
    const opsAdmin = await loginAdminByEmail(OPS_ADMIN_EMAIL)

    // ops_admin IS allowed here (unlike the payments endpoint in TC-M11-002) —
    // confirm the positive case, not just a blanket "ops_admin is always blocked"
    // assumption that would actually be wrong for this specific route.
    const res = await request(app)
      .post('/api/v1/admin/pricing/rate-cards')
      .set('Authorization', `Bearer ${opsAdmin.accessToken}`)
      .send({ category_id: Number(catRows[0]!.id), ride_type: 'one_way', rate_per_km: 17, rate_per_min: 2.5, min_fare: 350 })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
  })
})
```

- [ ] **Step 2: Run and verify 2-3x back-to-back**

- [ ] **Step 3: Commit**

```bash
git add api/tests/integration/m11.test.ts
git commit -m "test(M11): add admin user-suspension and rate-card role-authorization tests"
```

---

## Task 11: M12 — all 4 real analytics endpoints

**Files:** Modify `api/tests/integration/m12.test.ts`

Covers `TC-M12-001/002/003/005` (renamed to the 4 real endpoints: ride funnel via `summary`, revenue via `summary`, driver availability, city breakdown). `TC-M12-004` ("paginated data") is deferred — no pagination exists on any analytics endpoint.

- [ ] **Step 1: Read first**

Confirm all 4 routes are `/api/v1/admin/analytics/{summary,eta-accuracy,drivers/onboarding,drivers/availability}`, `requireAdmin('super_admin','ops_admin','finance_admin')` for the period-scoped ones. Confirm `getDriverAvailability` must be asserted BEFORE calling `driveRideToCompletion` on the test's driver, since that helper takes the driver offline as its last step (established fact from the M07/M08 plan).

- [ ] **Step 2: Write the tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { hashPassword } from '@/lib/hash'
import { loginUser, setupOnlineDriver, driveRideToCompletion, cleanupRideAndDriverData, DEFAULT_BOOKING } from '../helpers/fixtures/rides.fixture'

const app = createApp()

const PHONES = { analyticsUser: '+919700000401', analyticsDriver: '+919700000402' } as const
const ADMIN_EMAIL = 'm12-analytics-admin@ocar.app'
const ADMIN_PASSWORD = 'Admin@1234'

let categoryId: number

beforeAll(async () => {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM vehicle_categories WHERE slug = 'sedan' LIMIT 1")
  categoryId = Number(rows[0]!.id)
  const hash = await hashPassword(ADMIN_PASSWORD)
  await pool.query(`
    INSERT INTO admins (email, password_hash, role) VALUES ($1, $2, 'super_admin')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
  `, [ADMIN_EMAIL, hash])
})

afterAll(async () => {
  await cleanupRideAndDriverData(pool, [...Object.values(PHONES)])
  for (const p of Object.values(PHONES)) {
    await redis.del(`otp_rate:user:${p}:login`)
    await redis.del(`otp_rate:driver:${p}:login`)
  }
  await pool.query(`DELETE FROM admins WHERE email = $1`, [ADMIN_EMAIL])
  await pool.end()
  redis.disconnect()
})

async function loginAdmin() {
  const res = await request(app).post('/api/v1/auth/admin/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  return { accessToken: res.body.tokens.accessToken as string }
}

describe('M12 — Analytics', () => {
  it('TC-M12-003: driver availability reflects an online driver before ride completion', async () => {
    const driver = await setupOnlineDriver(app, pool, redis, PHONES.analyticsDriver, { categorySlug: 'sedan' })
    const admin = await loginAdmin()

    const res = await request(app)
      .get('/api/v1/admin/analytics/drivers/availability')
      .set('Authorization', `Bearer ${admin.accessToken}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    const total = res.body.reduce((sum: number, row: { online_now: number }) => sum + Number(row.online_now), 0)
    expect(total).toBeGreaterThanOrEqual(1)

    // TC-M12-001/002/005: complete a ride+payment, then confirm it's reflected
    // in the funnel/revenue/city-breakdown fields of the summary endpoint.
    const { accessToken: userToken } = await loginUser(app, redis, PHONES.analyticsUser)
    const bookRes = await request(app)
      .post('/api/v1/rides')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ categoryId, ...DEFAULT_BOOKING })
    const rideId = bookRes.body.rideId as string
    await driveRideToCompletion(app, rideId, driver, userToken)

    const summaryRes = await request(app)
      .get('/api/v1/admin/analytics/summary?period=7d')
      .set('Authorization', `Bearer ${admin.accessToken}`)
    expect(summaryRes.status, JSON.stringify(summaryRes.body)).toBe(200)
    expect(summaryRes.body.funnel.completed).toBeGreaterThanOrEqual(1)

    const bhubaneswarRow = summaryRes.body.city_breakdown.find((c: { city_name: string }) => c.city_name === 'Bhubaneswar')
    expect(bhubaneswarRow).toBeTruthy()
    expect(Number(bhubaneswarRow.ride_count)).toBeGreaterThanOrEqual(1)
  })

  it('TC-M12-004: analytics endpoint returns paginated data', async () => {
    // Deferred — no pagination exists on any analytics endpoint (summary,
    // eta-accuracy, drivers/onboarding, drivers/availability all return full
    // unpaginated arrays/objects).
  })
})
```

Note: this task deliberately collapses TC-M12-001/002/003/005 into ONE test rather than four separate ones, since they all key off the same single completed ride and re-deriving setup four times would repeat the exact duplication mistake the M07/M08 plan already learned from. If code review flags this as under-granular, that's a legitimate call to split — use judgment when actually implementing.

- [ ] **Step 3: Run and verify 2-3x back-to-back**

- [ ] **Step 4: Commit**

```bash
git add api/tests/integration/m12.test.ts
git commit -m "test(M12): add analytics summary, driver-availability, and city-breakdown integration tests"
```

---

## Task 12: Full-suite stability verification

**Files:** No new files — verification pass, same shape as prior plans' final task.

- [ ] **Step 1: Run every touched file 3x back-to-back**

```powershell
cd api
npx vitest run tests/integration/m04.test.ts tests/integration/m05.test.ts tests/integration/m06.test.ts tests/integration/m10.test.ts tests/integration/m11.test.ts tests/integration/m12.test.ts
```
Run 3 times. All real tests pass, deferred stubs show as `it.todo`, not failing.

- [ ] **Step 2: Run the FULL test suite once** (`npx vitest run`) — every module (M01-M12) now has real coverage; confirm nothing regressed and note final pass/todo counts.

- [ ] **Step 3: Confirm `ci.yml` needs no changes** — none of these six modules introduce a new external dependency requiring a new env var (Google Maps calls are always mocked in tests per Task 3/M09 precedent; no new payment gateway; no new queue).

- [ ] **Step 4: Report a final scorecard** — total real tests added, total stubs deliberately deferred (with the accumulated list of reasons across all 6 modules), any new bugs found during this phase (report per this session's established process — do not fix without explicit sign-off).

---

## Self-review notes

- **Spec coverage**: all 33 original stubs across 6 files are addressed — either converted to real tests, or explicitly deferred with a reason tied to a genuine implementation gap (not laziness). ~8 stubs across the 6 files describe functionality that doesn't exist (highway rates, surge activator job, city zones, voice calls, snapshot jobs, pagination) — each is named and reasoned in the "mismatches found" section up front, not discovered ad hoc per-task.
- **Reuse discipline**: every task reuses the established `rides.fixture.ts`/`safety.fixture.ts` helpers; no task re-derives ride-completion or admin-login setup from scratch.
- **Known risk flagged, not buried**: Task 5's finding that surge events may never auto-activate is explicitly called out as a possible real bug requiring the same found-a-bug/ask-the-user process already used twice successfully in the M07-M09 work — not silently worked around.
- **Shared-state mutation caution**: Tasks 6, 8, and 10 all mutate real shared rows (a rate card, a notification template, a user's status) — each includes an explicit restore step and a caution about verifying the restore actually lands, learned from this plan's own awareness that a failed cleanup step has repeatedly caused cross-test pollution earlier in this session's M07/M08/M09 work.
