# Fare & Cancellation Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three §05 fare/cancellation integrity gaps — client-trusted booking distance, an inert cancellation fee, and an unbounded GPS distance — by bounding the client distance against the server route, actually charging the cancellation fee through the wallet ledger, and clamping GPS-derived distance to a plausibility ceiling.

**Architecture:** All three fixes stay inside the rides module (`rides.service.ts`, `rides.repository.ts`) plus one small pricing-schema migration. Task A calls the existing `getRoute` (geo module, already used for ETA) as a read-only bound. Task B records + collects the fee inside `cancelRide`'s existing DB transaction (atomic, no new payment flow, no cross-module edit) and adds a fixed-window Redis counter (the §07 pattern). Task C adds a SQL-level ceiling to `getGpsTrackedDistanceKm`, reusing the null-fallback path `verifyEndOTP` already has.

**Tech Stack:** Express + TypeScript, `pg` (raw SQL, PostGIS), ioredis (`INCR`/`EXPIRE`), Vitest for unit tests.

**Scope boundary (do not cross):** Only `api/src/modules/rides/rides.service.ts`, `api/src/modules/rides/rides.repository.ts`, a new migration under `api/src/db/migrations/`, and the rides test files. `geo.service.ts`'s `getRoute` and `payments.service.ts`'s wallet functions are read-only reference — call them / mirror their SQL, never edit them (other agents own those files in parallel).

---

## File Structure

- **Modify** `api/src/modules/rides/rides.service.ts`
  - `createBooking` (~L386): server-side distance bound (Task A).
  - `cancelRide` (~L1038): charge the cancellation fee + daily Redis counter (Task B). A new private helper `readCancellationFee` and a module const `DRIVER_COMPENSATION_SHARE`.
  - `cancelRideAsDriver` (~L1131): **left unchanged** — driver-initiated cancellations are driver-fault and already insert `fee_applicable = false`; no user fee is owed.
- **Modify** `api/src/modules/rides/rides.repository.ts`
  - `getGpsTrackedDistanceKm` (~L1446): plausibility ceiling (Task C); add a `logger` import.
- **Create** `api/src/db/migrations/091_rate_card_cancellation_fee.sql`: add `cancellation_fee` to `rate_cards`, backfill current rows.
- **Modify** `api/tests/unit/rides/rider-booking.test.ts`: stub `getRoute` so the new Task-A call doesn't hit Google/Redis (keeps existing bookings passing).
- **Create** `api/tests/unit/rides/booking-distance-bound.test.ts` (Task A).
- **Create** `api/tests/unit/rides/cancellation-fee.test.ts` (Task B).
- **Create** `api/tests/unit/rides/gps-distance-ceiling.test.ts` (Task C).

**Verified facts this plan relies on (checked against current source):**
- `getRoute(originLat, originLng, destLat, destLng, opts?)` returns `{ distanceKm, durationMin, polyline, source: 'google'|'osrm'|'fallback', ... }` (`geo/providers/google.provider.ts:47`). Already imported into `rides.service.ts:42`.
- `rides.service.ts:4` already imports `{ client as redis }`, and `logger`/`log` (`:45`,`:48`). `getRoute` already used at `:62`. No new imports needed for Tasks A/B.
- `createBooking` builds `fareReq` from `data.distanceKm`/`data.durationMin` at `:476-487` and inserts the same into `fare_snapshots` at `:524-554`. Overwriting `data.distanceKm`/`data.durationMin` **before** `:476` fixes both the fare and the snapshot in one place.
- `cancelRide` (`:1038`) computes `feeApplicable` at `:1052` then hardcodes `fee_amount = 0, fee_waived = false` in the `ride_cancellations` INSERT (`:1067-1072`), all inside a `pool.connect()` → `BEGIN`/`COMMIT` transaction. `ride.driver_id` is present at the fee-applicable stages (`after_acceptance`/`after_arrival`).
- `user_wallets.balance` has `CHECK (balance >= 0)` and `user_wallet_ledger.amount` has `CHECK (amount > 0)` (`011_wallet.sql:57,74`) — the user wallet **cannot** go negative, so the fee is collected all-or-nothing (mirrors `payFromUserWallet`), and recorded as owed when the wallet can't cover it.
- `user_wallet_entry_type` enum = `cashback|referral_bonus|ride_debit|adjustment_credit|adjustment_debit|refund_credit` (`002_enums.sql:179`). No `cancellation_fee` value → use `adjustment_debit`. `driver_wallet_entry_type` = `topup|commission_debit|adjustment_credit|adjustment_debit|refund_credit` → use `adjustment_credit`. (Avoids an `ALTER TYPE ... ADD VALUE` migration.)
- `rates_cards` is city-scoped since migration 078; current-row lookup is `WHERE effective_to IS NULL AND (city_id = $ OR city_id IS NULL) ORDER BY city_id NULLS LAST LIMIT 1` (`pricing.repository.ts:3-18`). `rides` has `category_id`, `ride_type`, `origin_city_id` (`007_m5_booking.sql:139,140,148`).
- `getGpsTrackedDistanceKm(rideId, since)` returns `number | null`; `null` triggers the client-estimate fallback in `verifyEndOTP` (`:1842`, `:1859`). `fare_snapshots.estimated_km` holds the booked distance.
- Latest migration is `090_*`; next number is `091`.
- Test runner: Vitest. Run one file with `pnpm test <relative-path>` from `api/`.

---

## Task A: Server-side distance bound on `createBooking`

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` (`createBooking`, insert before `const originCity = await findNearestCity(...)`, ~L474)
- Modify: `api/tests/unit/rides/rider-booking.test.ts` (add a `getRoute` stub)
- Test: `api/tests/unit/rides/booking-distance-bound.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/rides/booking-distance-bound.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  createRide:             vi.fn(),
  logStatusHistory:       vi.fn(),
  getActiveRideIdForUser: vi.fn(),
  insertRideStops:        vi.fn(),
}))

vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate: vi.fn(),
  clampTripHours:  vi.fn((rideType: string, hours: number | undefined) =>
    rideType === 'round_trip' ? Math.max(4, Math.ceil(hours ?? 0)) : (hours ?? 0)
  ),
}))

vi.mock('@/modules/geo/geo.service', () => ({
  findNearestCity: vi.fn(() => null),
  classifyTrip:    vi.fn(() => ({ scope: 'outstation', cityId: null, cityName: null })),
  getRoute:        vi.fn(),
  snapTrailToRoads: vi.fn(),
}))

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(), expire: vi.fn(), del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { broadcastNewRide: vi.fn(), sendRideStatusUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn().mockResolvedValue({ id: 'j1' }) }, scheduler: { add: vi.fn() } },
  QUEUE_NAMES: { DISPATCH: 'dispatch', SCHEDULER: 'scheduler' },
  gpsFlushQueue: { add: vi.fn() },
}))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h') }))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
}))
vi.mock('@/modules/pricing/pricing.repository', () => ({ getStopCharge: vi.fn(() => 0) }))

import * as repo    from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import * as geo     from '@/modules/geo/geo.service'
import { pool }     from '@/db/client'
import { createBooking } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)
const BASE = {
  categoryId: 2, rideType: 'one_way' as const,
  originLat: 20.2961, originLng: 85.8245, originAddress: 'BBSR',
  destinationLat: 19.8010, destinationLng: 85.8210, destinationAddress: 'Puri',
  distanceKm: 65, durationMin: 90,
}
const FARE = {
  rate_card_id: 1, surge_event_id: null, surge_multiplier: 1.0,
  breakdown: { base_fare: 0, distance_fare: 650, time_fare: 108, stop_fare: 0, hour_surcharge: 0, surge_fare: 0, total: 758 },
}
const RIDE = { id: BigInt(101), user_id: USER_ID, status: 'requested', ride_type: 'one_way', category_id: BigInt(2) }

describe('createBooking — server-side distance bound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE as never)
    vi.mocked(repo.createRide).mockResolvedValue(RIDE as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
  })

  it('keeps the client distance when it is within the 15% tolerance band', async () => {
    vi.mocked(geo.getRoute).mockResolvedValue({ distanceKm: 68, durationMin: 95, polyline: '', source: 'google' } as never)
    await createBooking(USER_ID, { ...BASE }) // 65 is within [57.8, 78.2]
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBe(65)
    expect(fareCall.duration_min).toBe(90)
  })

  it('overwrites a low-balled client distance with the server value', async () => {
    vi.mocked(geo.getRoute).mockResolvedValue({ distanceKm: 65, durationMin: 90, polyline: '', source: 'google' } as never)
    await createBooking(USER_ID, { ...BASE, distanceKm: 30, durationMin: 40 }) // 30 < 55.25 → out of band
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBe(65)
    expect(fareCall.duration_min).toBe(90)
  })

  it('does NOT overwrite when the server route is a straight-line fallback', async () => {
    vi.mocked(geo.getRoute).mockResolvedValue({ distanceKm: 65, durationMin: 90, polyline: '', source: 'fallback' } as never)
    await createBooking(USER_ID, { ...BASE, distanceKm: 30, durationMin: 40 })
    const fareCall = vi.mocked(pricing.getFareEstimate).mock.calls[0]![0]
    expect(fareCall.distance_km).toBe(30) // fallback is itself untrustworthy → keep client value
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/rides/booking-distance-bound.test.ts`
Expected: the first test PASSES (65 unchanged — no bound exists yet), the second FAILS (`expected 65, received 30` — no overwrite happens yet), the third PASSES. Overall: FAIL.

- [ ] **Step 3: Write minimal implementation**

In `api/src/modules/rides/rides.service.ts`, inside `createBooking`, insert this block immediately **before** the line `const originCity = await findNearestCity(data.originLat, data.originLng)` (~L474):

```typescript
  // Server-side distance bound. For one-way/rental, the client-supplied distanceKm
  // IS the bill (total_final = total_estimated at completion), so a tampered client
  // could low-ball the fare. Re-derive the route server-side and clamp the client
  // value to a 15% tolerance band. Correct-don't-reject: minor client rounding or
  // staleness is normal, so we overwrite with the server number rather than failing
  // the booking. Skipped when stops exist (getRoute is point-to-point and can't
  // cheaply bound a multi-stop detour) or when Google was unreachable (a 'fallback'
  // route is itself a straight-line guess, no more trustworthy than the client).
  // ponytail: point-to-point bound only; add a waypoint-aware getRoute overload
  // here if multi-stop fare abuse ever shows up in the data.
  if (
    data.destinationLat !== undefined &&
    data.destinationLng !== undefined &&
    (data.stops?.length ?? 0) === 0
  ) {
    try {
      const serverRoute = await getRoute(
        data.originLat, data.originLng, data.destinationLat, data.destinationLng
      )
      if (serverRoute.source !== 'fallback') {
        const tolerance = 0.15
        const hi = serverRoute.distanceKm * (1 + tolerance)
        const lo = serverRoute.distanceKm * (1 - tolerance)
        if (data.distanceKm > hi || data.distanceKm < lo) {
          log.warn(
            { clientDistanceKm: data.distanceKm, serverDistanceKm: serverRoute.distanceKm },
            'Booking distance outside server tolerance — using server value'
          )
          data.distanceKm  = serverRoute.distanceKm
          data.durationMin = serverRoute.durationMin
        }
      }
    } catch (err) {
      // A routing outage must never block a booking — fall back to the client value,
      // same posture as the 'fallback' source above.
      log.warn({ err }, 'server route lookup failed during booking; using client distance')
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test tests/unit/rides/booking-distance-bound.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Keep the existing booking test green**

The existing `rider-booking.test.ts` does not mock `@/modules/geo/geo.service`, so the new `getRoute` call would hit Redis/Google. Add a partial mock that stubs only `getRoute` (leaving `findNearestCity`/`classifyTrip` behaviour intact). In `api/tests/unit/rides/rider-booking.test.ts`, add this mock alongside the other `vi.mock(...)` blocks (before the imports at line ~61):

```typescript
vi.mock('@/modules/geo/geo.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/geo/geo.service')>()),
  // Return the exact client distance so the tolerance check is a no-op and the
  // existing riderName/riderPhone assertions are unaffected.
  getRoute: vi.fn(async () => ({ distanceKm: 65, durationMin: 90, polyline: '', source: 'google' as const })),
}))
```

- [ ] **Step 6: Run the full rides suite to confirm nothing regressed**

Run: `cd api && pnpm test tests/unit/rides/`
Expected: PASS (all rides tests green, including `rider-booking.test.ts` and `booking-distance-bound.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/booking-distance-bound.test.ts api/tests/unit/rides/rider-booking.test.ts
git commit -m "feat(rides): bound client booking distance against server route (§05.1)"
```

---

## Task B: Actually charge the cancellation fee

Sub-parts: (B1) migration adds a rate-card `cancellation_fee` column; (B2) `cancelRide` reads the fee, debits the user wallet (all-or-nothing, respects the `balance >= 0` CHECK), credits the driver a compensation share, and records the real `fee_amount`; (B3) a per-user daily Redis counter flags (never blocks) excessive cancellers past 5/day.

**Files:**
- Create: `api/src/db/migrations/091_rate_card_cancellation_fee.sql`
- Modify: `api/src/modules/rides/rides.service.ts` (`cancelRide`, ~L1038; new const + helper)
- Test: `api/tests/unit/rides/cancellation-fee.test.ts` (new)

### B1 — Migration

- [ ] **Step 1: Write the migration**

Create `api/src/db/migrations/091_rate_card_cancellation_fee.sql`:

```sql
-- ============================================================
-- Cancellation fee, sourced from rate cards
-- ------------------------------------------------------------
-- The cancellation fee was computed in cancelRide but never charged
-- (always fee_amount = 0). Give it a real, city/category-scoped source
-- of truth on rate_cards, same versioning + NULL-city-fallback convention
-- as every other rate on this table (see migration 078). NULL = no fee
-- configured for that (city, category, ride_type) → treated as 0 by the app.
-- ============================================================

ALTER TABLE rate_cards
  ADD COLUMN cancellation_fee NUMERIC(8,2) NULL
    CHECK (cancellation_fee IS NULL OR cancellation_fee >= 0);

COMMENT ON COLUMN rate_cards.cancellation_fee IS
  'Flat fee charged to the rider when they cancel after a driver has been assigned. NULL = no fee (treated as 0). City/category-scoped like every other rate on this row.';

-- Backfill the current (effective_to IS NULL) rows with a sane starting default.
-- Admins tune per city/category later via the rate-card versioning flow (new row,
-- effective_to on the old one) — same as any other rate change.
-- ponytail: flat ₹50 placeholder across the board; real per-category values are a
-- rate-card admin action, not a code change.
UPDATE rate_cards
   SET cancellation_fee = 50.00
 WHERE effective_to IS NULL
   AND cancellation_fee IS NULL;
```

- [ ] **Step 2: Run the migration to verify it applies**

Run: `cd api && pnpm migrate`
Expected: output lists `091_rate_card_cancellation_fee.sql` as applied, no error. (Requires the Docker Postgres on :5434 per CLAUDE.md. If no DB is available in the execution environment, verify the SQL is syntactically valid by eye and proceed — the unit tests below mock the DB and do not need it.)

- [ ] **Step 3: Commit**

```bash
git add api/src/db/migrations/091_rate_card_cancellation_fee.sql
git commit -m "feat(pricing): add rate_cards.cancellation_fee column + backfill (§05.2)"
```

### B2 — Charge the fee in `cancelRide`

- [ ] **Step 4: Write the failing test**

Create `api/tests/unit/rides/cancellation-fee.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { connect: vi.fn(() => Promise.resolve(client)), query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(async () => 1), expire: vi.fn(), del: vi.fn() } }))

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:        vi.fn(),
  cancelAllAssignments: vi.fn(async () => []),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendRequestExpired: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/modules/call-masking/call-masking.service', () => ({ releaseForRide: vi.fn(async () => undefined) }))

import * as repo from '@/modules/rides/rides.repository'
import { client as redis } from '@/db/redis'
import { cancelRide } from '@/modules/rides/rides.service'

const USER_ID   = BigInt(42)
const DRIVER_ID = BigInt(7)
const RIDE_ID   = BigInt(101)

// stage 'accepted' → after_acceptance → feeApplicable = true, driver assigned
const ACCEPTED_RIDE = {
  id: RIDE_ID, user_id: USER_ID, driver_id: DRIVER_ID, status: 'accepted',
  ride_type: 'one_way', category_id: BigInt(2), origin_city_id: BigInt(1),
}

// Route every SQL the transaction issues. `balance` controls whether the wallet can
// cover the fee. Returns rowCount 1 for the ride UPDATE so the CAS guard passes.
function wireClient(balance: string) {
  client.query.mockImplementation((sql: string) => {
    if (sql.includes('SELECT cancellation_fee FROM rate_cards'))     return Promise.resolve({ rows: [{ cancellation_fee: '50.00' }], rowCount: 1 })
    if (sql.includes('UPDATE rides SET status'))                     return Promise.resolve({ rows: [{ id: RIDE_ID }], rowCount: 1 })
    if (sql.includes('SELECT id, balance FROM user_wallets'))        return Promise.resolve({ rows: [{ id: BigInt(9), balance }], rowCount: 1 })
    if (sql.includes('SELECT id, balance') && sql.includes('driver_wallets')) return Promise.resolve({ rows: [{ id: BigInt(3), balance: '0', is_frozen: false }], rowCount: 1 })
    return Promise.resolve({ rows: [], rowCount: 0 }) // BEGIN/COMMIT/INSERTs/UPDATEs
  })
}

describe('cancelRide — cancellation fee', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideById).mockResolvedValue(ACCEPTED_RIDE as never)
    vi.mocked(redis.incr).mockResolvedValue(1 as never)
  })

  it('records the rate-card fee and debits the user wallet when funds cover it', async () => {
    wireClient('500.00')
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')

    const cancelInsert = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO ride_cancellations'))
    expect(cancelInsert).toBeDefined()
    expect(cancelInsert![1]).toContain(50) // fee_amount param is 50, not 0

    const userDebit = client.query.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('INSERT INTO user_wallet_ledger'))
    expect(userDebit).toBeDefined()
    expect((userDebit![0] as string)).toContain("'adjustment_debit'")

    const driverCredit = client.query.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('INSERT INTO driver_wallet_ledger'))
    expect(driverCredit).toBeDefined()
    expect((driverCredit![0] as string)).toContain("'adjustment_credit'")
    expect(driverCredit![1]).toContain(35) // 50 * 0.7 compensation share
  })

  it('records the fee as owed but does NOT debit when the wallet cannot cover it', async () => {
    wireClient('10.00')
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')

    const cancelInsert = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO ride_cancellations'))
    expect(cancelInsert![1]).toContain(50) // still recorded as owed

    const userDebit = client.query.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('INSERT INTO user_wallet_ledger'))
    expect(userDebit).toBeUndefined() // all-or-nothing: no partial debit
  })

  it('increments the per-user daily cancellation counter', async () => {
    wireClient('500.00')
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')
    expect(redis.incr).toHaveBeenCalledWith(`cancel:daily:user:${USER_ID}`)
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/rides/cancellation-fee.test.ts`
Expected: FAIL — `cancelInsert![1]` contains `0` not `50`; `user_wallet_ledger`/`driver_wallet_ledger` inserts are never issued; `redis.incr` never called.

- [ ] **Step 6: Add the module const and fee-reader helper**

In `api/src/modules/rides/rides.service.ts`, add near the top after `const log = logger.child(...)` (~L48):

```typescript
// Share of a collected cancellation fee that compensates the assigned driver for
// the wasted trip toward the rider. ponytail: flat constant; promote to
// system_config only if ops needs to tune it without a deploy.
const DRIVER_COMPENSATION_SHARE = 0.7
```

Then add this private helper directly above `cancelRide` (~L1038):

```typescript
// Reads the city/category-scoped cancellation fee off rate_cards, same
// NULL-city-fallback lookup as pricing.repository.getCurrentRateCard. Runs on the
// caller's transaction client so the read + charge are one atomic unit. Returns 0
// when no fee is configured (NULL column or no matching row).
async function readCancellationFee(
  client: import('pg').PoolClient,
  categoryId: bigint,
  rideType: string,
  cityId: bigint | null,
): Promise<number> {
  const res = await client.query<{ cancellation_fee: string | null }>(
    `SELECT cancellation_fee FROM rate_cards
      WHERE category_id = $1 AND ride_type = $2 AND effective_to IS NULL
        AND (city_id = $3 OR city_id IS NULL)
      ORDER BY city_id NULLS LAST
      LIMIT 1`,
    [categoryId, rideType, cityId]
  )
  const raw = res.rows[0]?.cancellation_fee
  return raw != null ? parseFloat(raw) : 0
}
```

- [ ] **Step 7: Charge the fee inside `cancelRide`'s transaction**

In `cancelRide`, replace the `ride_cancellations` INSERT block (currently `:1067-1072`, the one with `fee_applicable, fee_amount, fee_waived) VALUES ($1, 'user', $2, $3, $4, $5, $6, 0, false)`) and add the fee logic just before it. The transaction body from the `UPDATE rides` CAS guard onward becomes:

```typescript
    const upd = await client.query(
      `UPDATE rides SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1 AND status = $2`,
      [rideId, ride.status]
    )
    if ((upd.rowCount ?? 0) === 0) {
      throw Object.assign(new Error('Ride status changed — please refresh'), { httpStatus: 409 })
    }

    // Charge the cancellation fee (was computed then discarded as 0). Sourced from
    // rate_cards, collected atomically in this same transaction. All-or-nothing:
    // user_wallets.balance has a >= 0 CHECK, so if the wallet can't cover the fee we
    // record it as owed (fee_amount set, fee_waived false) rather than partial-debit —
    // same posture as payFromUserWallet. Driver compensation is only credited from a
    // fee we actually collected.
    let feeAmount = 0
    if (feeApplicable) {
      feeAmount = await readCancellationFee(
        client,
        BigInt(ride.category_id),
        ride.ride_type,
        ride.origin_city_id != null ? BigInt(ride.origin_city_id) : null,
      )
      if (feeAmount > 0) {
        await client.query(
          `INSERT INTO user_wallets (user_id, balance) VALUES ($1, 0)
           ON CONFLICT (user_id) DO NOTHING`,
          [userId]
        )
        const wRes = await client.query<{ id: string; balance: string }>(
          `SELECT id, balance FROM user_wallets WHERE user_id = $1 FOR UPDATE`,
          [userId]
        )
        const wallet = wRes.rows[0]
        const balance = wallet ? parseFloat(wallet.balance) : 0
        if (wallet && balance >= feeAmount) {
          const newBalance = Math.round((balance - feeAmount) * 100) / 100
          await client.query(
            `UPDATE user_wallets SET balance = $2, lifetime_spent = lifetime_spent + $3 WHERE id = $1`,
            [wallet.id, newBalance, feeAmount]
          )
          await client.query(
            `INSERT INTO user_wallet_ledger
               (wallet_id, user_id, entry_type, amount, direction, balance_after, ride_id, note)
             VALUES ($1, $2, 'adjustment_debit', $3, 'debit', $4, $5, $6)`,
            [wallet.id, userId, feeAmount, newBalance, rideId, `Cancellation fee for ride #${rideId}`]
          )

          // Compensate the assigned driver for the wasted approach, from the collected fee.
          if (ride.driver_id) {
            const driverId = BigInt(ride.driver_id)
            const compensation = Math.round(feeAmount * DRIVER_COMPENSATION_SHARE * 100) / 100
            if (compensation > 0) {
              await client.query(
                `INSERT INTO driver_wallets (driver_id, balance) VALUES ($1, 0)
                 ON CONFLICT (driver_id) DO NOTHING`,
                [driverId]
              )
              const dRes = await client.query<{ id: string; balance: string; is_frozen: boolean }>(
                `SELECT id, balance, is_frozen FROM driver_wallets WHERE driver_id = $1 FOR UPDATE`,
                [driverId]
              )
              const dWallet = dRes.rows[0]
              if (dWallet && !dWallet.is_frozen) {
                const dNew = Math.round((parseFloat(dWallet.balance) + compensation) * 100) / 100
                await client.query(
                  `UPDATE driver_wallets SET balance = $2 WHERE id = $1`,
                  [dWallet.id, dNew]
                )
                await client.query(
                  `INSERT INTO driver_wallet_ledger
                     (wallet_id, driver_id, entry_type, amount, direction, balance_after, ride_id, note)
                   VALUES ($1, $2, 'adjustment_credit', $3, 'credit', $4, $5, $6)`,
                  [dWallet.id, driverId, compensation, dNew, rideId, `Cancellation compensation for ride #${rideId}`]
                )
              }
            }
          }
        } else {
          log.warn({ userId, rideId, feeAmount, balance }, 'cancellation fee owed but wallet balance insufficient — recorded, not collected')
        }
      }
    }

    await client.query(
      `INSERT INTO ride_cancellations
         (ride_id, actor, stage, cancelled_by_user_id, reason_code, reason, fee_applicable, fee_amount, fee_waived)
       VALUES ($1, 'user', $2, $3, $4, $5, $6, $7, false)`,
      [rideId, stage, userId, reasonCode ?? null, reason ?? null, feeApplicable, feeAmount]
    )
```

Leave the rest of the transaction (`ride_status_history` INSERT, `ride_advance_meta`, `driver_sessions`/`driver_location_snapshots` updates, `COMMIT`) exactly as-is.

- [ ] **Step 8: Run test to verify the charge passes**

Run: `cd api && pnpm test tests/unit/rides/cancellation-fee.test.ts`
Expected: the first two tests PASS (fee recorded + wallet/driver ledger writes on sufficient balance; recorded-but-not-debited on insufficient). Third test still FAILS (counter not added yet).

### B3 — Per-user daily cancellation counter

- [ ] **Step 9: Add the fixed-window Redis counter**

In `cancelRide`, after the `COMMIT`/`client.release()` block and after the `socketEvents.sendRideStatusUpdate(...)` call, before `return { success: true }`, add:

```typescript
  // Per-user daily cancellation counter — the §07 fixed-window pattern (INCR + EXPIRE
  // on first increment), same shape as ride-OTP lockout and SOS rate-limiting.
  // Flags excessive cancellers for review; deliberately does NOT block the cancellation
  // (a genuine repeat cancel must always succeed).
  try {
    const key = `cancel:daily:user:${userId}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 86400)
    if (count > 5) {
      // ponytail: a structured warn log IS the flag (queryable in Loki). Promote to a
      // dedicated table / higher-fee tier only if ops needs richer reporting.
      log.warn({ userId, count }, 'excessive cancellations in 24h — flagged for review')
    }
  } catch (err) {
    log.warn({ err, userId }, 'cancellation counter update failed')
  }
```

- [ ] **Step 10: Run test to verify all cancellation tests pass**

Run: `cd api && pnpm test tests/unit/rides/cancellation-fee.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 11: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/cancellation-fee.test.ts
git commit -m "feat(rides): charge cancellation fee via wallet ledger + daily counter (§05.2)"
```

---

## Task C: Plausibility ceiling on `getGpsTrackedDistanceKm`

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts` (`getGpsTrackedDistanceKm`, ~L1446; add `logger` import)
- Test: `api/tests/unit/rides/gps-distance-ceiling.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/rides/gps-distance-ceiling.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), child: vi.fn(() => ({ warn: vi.fn() })) } }))

import { pool } from '@/db/client'
import { getGpsTrackedDistanceKm } from '@/modules/rides/rides.repository'

const RIDE_ID = BigInt(101)
const SINCE = new Date('2026-08-24T00:00:00Z')

describe('getGpsTrackedDistanceKm — plausibility ceiling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the GPS distance when within 2.5x the booked distance', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: '20', booked_km: '10' }], rowCount: 1 } as never)
    const result = await getGpsTrackedDistanceKm(RIDE_ID, SINCE)
    expect(result).toBe(20) // 20 <= 10 * 2.5 = 25
  })

  it('returns null when the GPS distance exceeds 2.5x the booked distance', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: '40', booked_km: '10' }], rowCount: 1 } as never)
    const result = await getGpsTrackedDistanceKm(RIDE_ID, SINCE)
    expect(result).toBeNull() // 40 > 25 → implausible → fall back to client estimate
  })

  it('returns null when there are fewer than 2 GPS points (km is null)', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: null, booked_km: '10' }], rowCount: 1 } as never)
    const result = await getGpsTrackedDistanceKm(RIDE_ID, SINCE)
    expect(result).toBeNull()
  })

  it('returns the GPS distance unchanged when the booked distance is unknown', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ km: '40', booked_km: null }], rowCount: 1 } as never)
    const result = await getGpsTrackedDistanceKm(RIDE_ID, SINCE)
    expect(result).toBe(40) // no booked baseline → no ceiling to apply
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/rides/gps-distance-ceiling.test.ts`
Expected: FAIL — the current query selects only `km` (no `booked_km`), so the second test returns `40` instead of `null`, and the query shape doesn't match the mock's row.

- [ ] **Step 3: Add the `logger` import**

At the top of `api/src/modules/rides/rides.repository.ts`, after the existing imports (~L9), add:

```typescript
import { logger } from '@/lib/logger'
```

- [ ] **Step 4: Add the ceiling to `getGpsTrackedDistanceKm`**

Replace the whole `getGpsTrackedDistanceKm` function (~L1446-1459) with:

```typescript
export async function getGpsTrackedDistanceKm(rideId: bigint, since: Date): Promise<number | null> {
  const res = await pool.query<{ km: string | null; booked_km: string | null }>(
    `SELECT
       CASE WHEN count(*) >= 2
         THEN ST_Length(ST_MakeLine(location::geometry ORDER BY recorded_at)::geography) / 1000
         ELSE NULL
       END AS km,
       (SELECT estimated_km FROM fare_snapshots WHERE ride_id = $1) AS booked_km
     FROM gps_tracks
     WHERE ride_id = $1 AND recorded_at >= $2`,
    [rideId, since]
  )
  const row = res.rows[0]
  const km = row?.km != null ? parseFloat(row.km) : null
  if (km == null) return null

  // Plausibility ceiling: a noisy or jumpy GPS trail can inflate ST_Length far past
  // any real route. Cap at 2.5x the booked distance (generous headroom for legit
  // detours/reroutes); beyond that, return null so verifyEndOTP falls back to the
  // client estimate — the same fallback the <2-points case already triggers. Brings
  // this path to the Math.min(finalFare, totalEstimated) discipline endRideEarlyAsDriver
  // already applies.
  const bookedKm = row?.booked_km != null ? parseFloat(row.booked_km) : null
  if (bookedKm != null && bookedKm > 0 && km > bookedKm * 2.5) {
    logger.warn(
      { rideId, gpsKm: km, bookedKm, ceilingKm: bookedKm * 2.5 },
      'GPS-tracked distance implausible, falling back to booked estimate'
    )
    return null
  }
  return km
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && pnpm test tests/unit/rides/gps-distance-ceiling.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/tests/unit/rides/gps-distance-ceiling.test.ts
git commit -m "feat(rides): clamp GPS-tracked distance to 2.5x booked distance (§05.3)"
```

---

## Final verification

- [ ] **Step 1: Type-check the API**

Run: `cd api && npx tsc --noEmit`
Expected: no errors. (Watch for `exactOptionalPropertyTypes` issues and the `import('pg').PoolClient` type on `readCancellationFee` — if `pg`'s `PoolClient` isn't resolvable inline, add `import type { PoolClient } from 'pg'` at the top and use `PoolClient` directly.)

- [ ] **Step 2: Run the full rides test suite**

Run: `cd api && pnpm test tests/unit/rides/`
Expected: PASS — all pre-existing rides tests plus the three new files (`booking-distance-bound`, `cancellation-fee`, `gps-distance-ceiling`) green.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`
Expected: completes without error (AST-only, no API cost).

---

## Self-Review

**1. Spec coverage (§05 + §07):**
- §05.1 client-trusted fare → Task A: `getRoute` bound with 15% tolerance, overwrite-don't-reject, `log.warn` on breach. Covered.
- §05.2 cancellation fee inert → Task B: fee sourced from a new `rate_cards.cancellation_fee` column (B1), debited from the user wallet + driver compensation credited inside the existing atomic transaction, real `fee_amount` recorded (B2), plus the per-user daily counter flag (B3). Covered. `cancelRideAsDriver` intentionally excluded (driver-fault, no user fee) — documented in File Structure.
- §05.3 GPS distance unclamped → Task C: 2.5x-booked ceiling, `return null` reusing the existing fallback, `logger.warn`. Covered.
- §07.1 fixed-window Redis counter → Task B3 uses the exact `INCR` + `EXPIRE`-on-first pattern named in the spec. Covered.
- §07 "reuse existing wallet-debit path, don't build a new flow" → honored by mirroring `payFromUserWallet`/`creditCashback` ledger SQL inside `cancelRide`'s own transaction (rather than editing `payments.service.ts`, which is out of this plan's file scope and owned by a parallel agent). This also gives stronger atomicity than a cross-transaction call. Rationale documented.

**2. Placeholder scan:** No TBD/TODO/"handle errors appropriately". Every code step has complete code; every test step has full test bodies; every run step has an exact command + expected output. The two `ponytail:` comments name a real, deliberate ceiling with an upgrade path (not placeholders).

**3. Type consistency:** `readCancellationFee` is defined once (Step B6) and called once (Step B7) with matching args `(client, BigInt(ride.category_id), ride.ride_type, cityId)`. `DRIVER_COMPENSATION_SHARE` defined once, used once. `getGpsTrackedDistanceKm` keeps its exact existing signature `(rideId: bigint, since: Date): Promise<number | null>` — no caller changes needed (the booked-distance baseline is read via a subquery inside the function). `getRoute` called with the verified 4-arg positional signature. Entry-type string literals (`'adjustment_debit'`, `'adjustment_credit'`) match the enum values confirmed in `002_enums.sql`. Wallet ledger column lists match `011_wallet.sql`. Consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-24-fare-and-cancellation-integrity.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
