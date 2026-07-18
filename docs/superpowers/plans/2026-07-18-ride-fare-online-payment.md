# Ride-fare Online Payment (Checkout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a rider pay for a completed ride via cash (unchanged default), Razorpay online (UPI/card), or user-wallet balance, with reliable confirmation via client-verify + webhook backstop + a reconciliation sweep.

**Architecture:** A `payment_channel` (`cash`/`online`/`wallet`) is chosen at booking and stored on `rides`. At completion the existing post-processing block branches on it: cash behaves exactly as today; online creates a `pending` payment + a Razorpay order and pushes the `order_id` over the completion socket event so the app opens Checkout; wallet debits `user_wallets` atomically. Commission + cashback only run once money is actually collected. Confirmation has three converging paths — a client-driven `/verify` endpoint (primary, mirrors the proven driver-topup verify), the Razorpay webhook (backstop), and a BullMQ repeatable reconciliation job — all funnelled through one status-guarded `confirmRidePayment()` so duplicate/stale triggers are no-ops.

**Tech Stack:** Express 4 + TypeScript 5 (`exactOptionalPropertyTypes: true`), PostgreSQL 18 (pg pool), Redis (ioredis), BullMQ, Socket.io v4, Razorpay Node SDK, Vitest (unit tests mock `@/db/client` pool), Next.js 16 user app.

---

## Reference facts (verified against the codebase)

- Migrations dir: `api/src/db/migrations/`. Latest file is `046_driver_verifications.sql`; **next number is `047`**.
- `payment_channel` enum (`002_enums.sql:83`) currently: `cash_direct, company_qr, online_wallet, online_upi, online_card, platform_wallet`. We add `razorpay_online` via `ALTER TYPE ... ADD VALUE`.
- `payment_status` enum: `pending, processing, completed, failed, refunded, partially_refunded, disputed`.
- `user_wallet_entry_type` enum already contains `ride_debit`. `user_wallet_ledger` has `ride_id` but **no `reference_id`** — we dedupe a wallet-pay by the presence of a `ride_debit` ledger row for that `ride_id` (one ride = one payment via the `payments.ride_id` UNIQUE constraint). **No new column/migration needed for that.**
- `payments.ride_id` is `UNIQUE`; `payments.razorpay_order_id` is `UNIQUE NULL`. `createPaymentRecord` uses `ON CONFLICT (ride_id) DO NOTHING`.
- Completion happens in `verifyEndOTP()` (`api/src/modules/rides/rides.service.ts:1012`); the payment post-processing block is `rides.service.ts:1174-1192`. It already emits `socketEvents.sendRideStatusUpdate(rideId, { status:'completed', finalFare })` at line 1163.
- `repo.getRideById` (`rides.repository.ts:390`) selects `r.*`, so the new `rides.payment_channel` column is returned automatically.
- Proven Razorpay patterns to mirror: order create + verify in `api/src/modules/payments/payments.routes.ts:31-102`; webhook signature check at `:105-134`. Driver-side Checkout script load in `apps/driver/src/pages/Wallet.tsx:86-114`.
- Repeatable-job registration pattern: `api/src/server.ts:42-72` (`queue.add(name, {}, { repeat: { every: N }, ... })`); worker pattern: `api/src/jobs/workers/cleanup.worker.ts`.
- Tests: Vitest, `cd api && pnpm test` runs all; single file `cd api && npx vitest run tests/unit/<path>`. Unit tests mock `@/db/client` (`{ pool: { query: vi.fn() } }`) — see `api/tests/unit/rides/return-at.test.ts`.
- Config (`api/src/config/index.ts:27-29`): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, all default `''` (dev mode = empty).

---

## File Structure

**Backend — modify:**
- `api/src/db/migrations/047_ride_payment_channel.sql` (create) — column + enum value.
- `api/src/modules/rides/rides.types.ts` — add `payment_channel` to `Ride`; add `paymentChannel` to `BookingRequest`.
- `api/src/modules/rides/rides.repository.ts` — `createRide` accepts + inserts `payment_channel`.
- `api/src/modules/rides/rides.service.ts` — `createBooking` threads channel; `verifyEndOTP` completion block branches on channel.
- `api/src/modules/rides/rides.routes.ts` — new `POST /:id/payment/verify`.
- `api/src/modules/payments/payments.service.ts` — `createPaymentRecord` pending variant; new `confirmRidePayment`, `payFromUserWallet`, `createRidePaymentOrder`, `verifyRidePayment`, `reconcilePendingRidePayments`; extend `handleWebhookEvent`.
- `api/src/constants/redis-keys.ts` — `ridePaymentOrderKey`.
- `api/src/jobs/queues/index.ts` — `PAYMENTS` queue.
- `api/src/jobs/workers/payment-reconcile.worker.ts` (create).
- `api/src/server.ts` — start worker + register repeatable job.

**Frontend — modify:**
- `apps/user/lib/ride-api.ts` — `paymentChannel` param.
- `apps/user/lib/payment-channel.ts` (create) — get/set selected channel in localStorage.
- `apps/user/app/(main)/payment-methods/page.tsx` — real selector.
- `apps/user/app/(main)/select-ride/page.tsx` + `apps/user/app/(main)/rental/page.tsx` — pass channel to `createBooking`.
- `apps/user/app/(main)/ride/[id]/page.tsx` — on completion with `razorpayOrderId`, open Checkout + call verify.

**Tests — create:** `api/tests/unit/rides/payment-channel-booking.test.ts`, `api/tests/unit/payments/create-payment-record.test.ts`, `confirm-ride-payment.test.ts`, `pay-from-wallet.test.ts`, `create-ride-payment-order.test.ts`, `verify-ride-payment.test.ts`, `webhook-captured.test.ts`, `reconcile-pending.test.ts`, `api/tests/unit/rides/completion-payment-branch.test.ts`.

---

## Task 1: Migration — `rides.payment_channel` + `razorpay_online` enum value

**Files:**
- Create: `api/src/db/migrations/047_ride_payment_channel.sql`
- Modify: `api/src/modules/rides/rides.types.ts`

This is infrastructure (a migration): no unit test — the repo does not unit-test migrations. Write, run, verify against the live DB, commit. Cash keeps working because the column defaults to `'cash'`.

- [ ] **Step 1: Write the migration**

Create `api/src/db/migrations/047_ride_payment_channel.sql`:

```sql
-- Ride-fare online payment (M08 checkout): rider picks how to pay at booking.
-- Small fixed-value column → VARCHAR + CHECK (same pattern as the `direction`
-- columns in 011_wallet.sql), default 'cash' so every existing row is unchanged.
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS payment_channel VARCHAR(10) NOT NULL DEFAULT 'cash'
  CHECK (payment_channel IN ('cash', 'online', 'wallet'));

-- payments.channel is the payment_channel enum; add a distinct value for a
-- Razorpay-collected ride fare (existing values are cash/QR/wallet variants).
ALTER TYPE payment_channel ADD VALUE IF NOT EXISTS 'razorpay_online';
```

- [ ] **Step 2: Add `payment_channel` to the `Ride` type**

In `api/src/modules/rides/rides.types.ts`, find the `Ride` interface (the return type of `getRideById`) and add this field (place it next to `status`/`ride_type`):

```typescript
  payment_channel: 'cash' | 'online' | 'wallet'
```

- [ ] **Step 3: Run the migration**

Run: `cd api && pnpm migrate`
Expected: log line applying `047_ride_payment_channel.sql`, no errors.

- [ ] **Step 4: Verify the column and enum value exist**

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "\d rides" | Select-String payment_channel`
Expected: a row `payment_channel | character varying(10) | ... default 'cash'`.
Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT enum_range(NULL::payment_channel);"`
Expected: the list includes `razorpay_online`.

- [ ] **Step 5: Typecheck + commit**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

```bash
git add api/src/db/migrations/047_ride_payment_channel.sql api/src/modules/rides/rides.types.ts
git commit -m "feat(payments): add rides.payment_channel column and razorpay_online channel value"
```

---

## Task 2: Thread `payment_channel` through the booking API

**Files:**
- Modify: `api/src/modules/rides/rides.types.ts` (BookingRequest)
- Modify: `api/src/modules/rides/rides.repository.ts:207-256` (createRide)
- Modify: `api/src/modules/rides/rides.service.ts:362-384` (createBooking → rideInput)
- Test: `api/tests/unit/rides/payment-channel-booking.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/rides/payment-channel-booking.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  createRide:            vi.fn(),
  logStatusHistory:      vi.fn(),
  createRideAssignment:  vi.fn(),
  getActiveRideIdForUser: vi.fn(),
}))
vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate: vi.fn(),
  clampTripHours:  vi.fn((_t: string, h: number | undefined) => h ?? 0),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h') }))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
}))

import * as repo    from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import { pool }     from '@/db/client'
import { createBooking } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)
const BASE = {
  categoryId: 2, rideType: 'one_way' as const,
  originLat: 20.2961, originLng: 85.8245, originAddress: 'BBSR',
  destinationLat: 19.8010, destinationLng: 85.8210, destinationAddress: 'Puri',
  distanceKm: 65, durationMin: 90, originCityId: 1,
}
const FARE = { rate_card_id: 1, surge_event_id: null, surge_multiplier: 1,
  breakdown: { base_fare: 0, distance_fare: 650, time_fare: 108, stop_fare: 0,
    hour_surcharge: 0, overage_fare: 0, surge_fare: 0, subtotal: 758, total: 758 } }
const RIDE = { id: BigInt(101), user_id: USER_ID, status: 'requested', ride_type: 'one_way',
  category_id: BigInt(2), origin_lat: 20.2961, origin_lng: 85.8245, dest_lat: 19.8, dest_lng: 85.82 }

describe('createBooking — payment_channel passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE as never)
    vi.mocked(repo.createRide).mockResolvedValue(RIDE as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  })

  it('passes an explicit paymentChannel to createRide', async () => {
    await createBooking(USER_ID, { ...BASE, paymentChannel: 'online' })
    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.paymentChannel).toBe('online')
  })

  it('defaults to cash when paymentChannel is omitted', async () => {
    await createBooking(USER_ID, { ...BASE })
    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.paymentChannel).toBe('cash')
  })

  it('passes wallet through', async () => {
    await createBooking(USER_ID, { ...BASE, paymentChannel: 'wallet' })
    const call = vi.mocked(repo.createRide).mock.calls[0]![0]
    expect(call.paymentChannel).toBe('wallet')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/payment-channel-booking.test.ts`
Expected: FAIL — `call.paymentChannel` is `undefined` (property not yet threaded).

- [ ] **Step 3: Add `paymentChannel` to `BookingRequest`**

In `api/src/modules/rides/rides.types.ts`, inside `interface BookingRequest` (after `scheduledFor?: string`):

```typescript
  paymentChannel?: 'cash' | 'online' | 'wallet'
```

- [ ] **Step 4: Accept + insert `payment_channel` in `createRide`**

In `api/src/modules/rides/rides.repository.ts`, add to the `createRide` param object type (after `status?: string`):

```typescript
  paymentChannel?: string
```

Add `payment_channel` to the INSERT column list and values. Change the column list line to include it, and add `$17` as a new parameter, shifting `status` to `$18`:

```typescript
  const res = await pool.query(
    `INSERT INTO rides (
       user_id, category_id, ride_type, is_return_cab,
       origin, destination,
       origin_address, destination_address,
       origin_city_id, destination_city_id,
       rental_package_id, trip_hours, scheduled_for, return_at,
       payment_channel, status
     ) VALUES (
       $1, $2, $3, $4,
       ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326)::geography,
       CASE WHEN $7::float8 IS NOT NULL AND $8::float8 IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography
         ELSE NULL END,
       $9, $10, $11, $12, $13, $14, $15, $16, $17, COALESCE($18::ride_status, 'requested'::ride_status)
     )
     RETURNING *`,
    [
      data.userId, data.categoryId, data.rideType, data.isReturnCab,
      data.originLat, data.originLng,
      data.destinationLat ?? null, data.destinationLng ?? null,
      data.originAddress ?? null, data.destinationAddress ?? null,
      data.originCityId ?? null, data.destinationCityId ?? null,
      data.rentalPackageId ?? null,
      data.tripHours ?? null,
      data.scheduledFor ?? null,
      data.returnAt ?? null,
      data.paymentChannel ?? 'cash',
      data.status ?? null,
    ]
  )
```

Note the `$5`/`$6` swap in `ST_MakePoint` is intentional and unchanged (lng first); `payment_channel` is the new `$17` and `status` is now `$18`. Params array order matches positional placeholders.

- [ ] **Step 5: Thread the channel in `createBooking`**

In `api/src/modules/rides/rides.service.ts`, in the block that builds `rideInput` (around line 379, right after the `returnAt` assignment), add:

```typescript
  rideInput.paymentChannel = data.paymentChannel ?? 'cash'
```

(Assign unconditionally — it always has a value, so `exactOptionalPropertyTypes` is satisfied without a guard.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/payment-channel-booking.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck + commit**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

```bash
git add api/src/modules/rides/rides.types.ts api/src/modules/rides/rides.repository.ts api/src/modules/rides/rides.service.ts api/tests/unit/rides/payment-channel-booking.test.ts
git commit -m "feat(payments): persist rider-selected payment_channel on booking"
```

---

## Task 3: `createPaymentRecord` — pending variant for online/wallet

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts:31-66`
- Test: `api/tests/unit/payments/create-payment-record.test.ts`

Cash keeps working: the new `opts` param defaults to completed-with-`captured_at`, exactly today's behavior.

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/payments/create-payment-record.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { createPaymentRecord } from '@/modules/payments/payments.service'

const FARE_ROW = { rows: [{ fare_snapshot_id: 7, total_final: '500.00', total_estimated: '480.00',
  user_id: 42, driver_id: 9 }], rowCount: 1 }

describe('createPaymentRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 1st call: fare snapshot lookup. 2nd call (getCommissionPercent): system_config. 3rd: INSERT.
    vi.mocked(pool.query)
      .mockResolvedValueOnce(FARE_ROW as never)          // fare join
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // commission config → fallback 15
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // INSERT
  })

  it('cash: inserts status=completed with captured_at=now()', async () => {
    await createPaymentRecord(BigInt(101), 'cash_direct')
    const insert = vi.mocked(pool.query).mock.calls[2]!
    const sql = insert[0] as string
    const params = insert[1] as unknown[]
    expect(sql).toContain('captured_at')
    expect(sql).toContain('now()')
    expect(params).toContain('completed')
    expect(params).toContain('cash_direct')
  })

  it('online: inserts status=pending with NULL captured_at', async () => {
    await createPaymentRecord(BigInt(101), 'razorpay_online', { status: 'pending' })
    const insert = vi.mocked(pool.query).mock.calls[2]!
    const sql = insert[0] as string
    const params = insert[1] as unknown[]
    expect(sql).not.toContain('now()')
    expect(params).toContain('pending')
    expect(params).toContain('razorpay_online')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/create-payment-record.test.ts`
Expected: FAIL — the online test fails because the current implementation always writes `'completed'` and `now()`.

- [ ] **Step 3: Add the pending variant**

In `api/src/modules/payments/payments.service.ts`, replace the whole `createPaymentRecord` function (lines 31-66) with:

```typescript
export async function createPaymentRecord(
  rideId: bigint,
  channel: string = 'cash_direct',
  opts: { status?: 'pending' | 'completed' } = {}
): Promise<void> {
  const fareRes = await pool.query(
    `SELECT fs.id AS fare_snapshot_id,
            fs.total_final, fs.total_estimated,
            r.user_id, r.driver_id
     FROM fare_snapshots fs
     JOIN rides r ON r.id = fs.ride_id
     WHERE fs.ride_id = $1`,
    [rideId]
  )

  const fare = fareRes.rows[0]
  if (!fare) throw Object.assign(new Error('Fare snapshot not found'), { httpStatus: 404 })

  const amount = parseFloat(fare.total_final ?? fare.total_estimated)
  const commissionPct = await getCommissionPercent()
  const commissionAmt = Math.round(amount * commissionPct) / 100
  const driverEarning = Math.round((amount - commissionAmt) * 100) / 100

  const status = opts.status ?? 'completed'
  // Only a captured (completed) payment has a capture timestamp. 'now()' / 'NULL'
  // are hardcoded literals — never client input — so interpolation is safe.
  const capturedAt = status === 'completed' ? 'now()' : 'NULL'

  await pool.query(
    `INSERT INTO payments (
       ride_id, user_id, driver_id, fare_snapshot_id,
       amount, channel, status,
       commission_percent, commission_amount, driver_earning,
       captured_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,${capturedAt})
     ON CONFLICT (ride_id) DO NOTHING`,
    [
      rideId, fare.user_id, fare.driver_id, fare.fare_snapshot_id,
      amount, channel, status, commissionPct, commissionAmt, driverEarning,
    ]
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/payments/create-payment-record.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

```bash
git add api/src/modules/payments/payments.service.ts api/tests/unit/payments/create-payment-record.test.ts
git commit -m "feat(payments): createPaymentRecord supports pending online/wallet payments"
```

---

## Task 4: `confirmRidePayment` — status-guarded transition + commission/cashback

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts` (add function; place after `creditCashback`, ~line 208)
- Test: `api/tests/unit/payments/confirm-ride-payment.test.ts`

This is the single funnel used by verify, webhook, and reconciliation. The `WHERE status='pending'` guard is what makes every path idempotent: only the transition-winner runs commission + cashback.

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/payments/confirm-ride-payment.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = { query: vi.fn().mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 }), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))

import { pool } from '@/db/client'
import { confirmRidePayment } from '@/modules/payments/payments.service'

describe('confirmRidePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.query.mockResolvedValue({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
  })

  it('already-completed (no pending row) → returns false, runs no commission/cashback', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // guarded UPDATE hits nothing
    const result = await confirmRidePayment(BigInt(101))
    expect(result).toBe(false)
    expect(pool.connect).not.toHaveBeenCalled() // deductCommission/creditCashback never started
  })

  it('pending → completed: returns true and records razorpay_payment_id when provided', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 } as never) // guarded UPDATE wins
      .mockResolvedValue({ rows: [], rowCount: 0 } as never) // subsequent config/select lookups
    const result = await confirmRidePayment(BigInt(101), 'pay_abc123')
    expect(result).toBe(true)
    const updateCall = vi.mocked(pool.query).mock.calls[0]!
    expect(updateCall[0] as string).toContain("status = 'pending'")
    expect(updateCall[0] as string).toContain('razorpay_payment_id')
    expect(updateCall[1] as unknown[]).toContain('pay_abc123')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/confirm-ride-payment.test.ts`
Expected: FAIL — `confirmRidePayment` is not exported.

- [ ] **Step 3: Implement `confirmRidePayment`**

In `api/src/modules/payments/payments.service.ts`, immediately after the `creditCashback` function (before `// ── Wallet queries ──`), add:

```typescript
// ── Confirm a collected ride payment (shared by verify/webhook/reconcile) ──
// The `WHERE status='pending'` guard is the idempotency lock: only the first
// caller to flip pending→completed runs commission + cashback. Duplicate or
// stale triggers hit zero rows and return false (no-op). Razorpay does not
// guarantee webhook ordering, so this compare-before-write is mandatory.
export async function confirmRidePayment(
  rideId: bigint,
  razorpayPaymentId?: string
): Promise<boolean> {
  const params: unknown[] = [rideId]
  let extraSet = ''
  if (razorpayPaymentId !== undefined) {
    params.push(razorpayPaymentId)
    extraSet = ', razorpay_payment_id = $2'
  }

  const res = await pool.query(
    `UPDATE payments
       SET status = 'completed', captured_at = now()${extraSet}
     WHERE ride_id = $1 AND status = 'pending'
     RETURNING driver_id, user_id, amount`,
    params
  )

  if ((res.rowCount ?? 0) === 0) return false

  const row = res.rows[0]
  await deductCommission(rideId, BigInt(row.driver_id))
  await creditCashback(rideId, BigInt(row.user_id), parseFloat(row.amount))
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/payments/confirm-ride-payment.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

```bash
git add api/src/modules/payments/payments.service.ts api/tests/unit/payments/confirm-ride-payment.test.ts
git commit -m "feat(payments): add status-guarded confirmRidePayment funnel"
```

---

## Task 5: `payFromUserWallet` — atomic wallet debit for a ride

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts` (add after `confirmRidePayment`)
- Test: `api/tests/unit/payments/pay-from-wallet.test.ts`

Mirrors `topUpDriverWallet`'s `FOR UPDATE` + ledger pattern, inverted to a debit. Insufficient balance → `false` (payment stays pending → retry UX). Idempotent via existing `ride_debit` ledger row for the ride.

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/payments/pay-from-wallet.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) } }))

import { payFromUserWallet } from '@/modules/payments/payments.service'

// Helper: script the client.query call sequence for one invocation.
function scriptWallet(balance: string, existingDebit: boolean) {
  client.query.mockReset()
  client.query
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })                       // BEGIN
    .mockResolvedValueOnce({ rows: [], rowCount: 0 })                       // INSERT ... ON CONFLICT (ensure wallet)
    .mockResolvedValueOnce({ rows: [{ id: 5, balance }], rowCount: 1 })     // SELECT ... FOR UPDATE
    .mockResolvedValueOnce({ rows: existingDebit ? [{ id: 1 }] : [], rowCount: existingDebit ? 1 : 0 }) // dedupe check
    .mockResolvedValue({ rows: [], rowCount: 0 })                           // UPDATE + INSERT ledger + COMMIT/ROLLBACK
}

describe('payFromUserWallet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sufficient balance → debits and returns true', async () => {
    scriptWallet('1000.00', false)
    const ok = await payFromUserWallet(BigInt(101), BigInt(42), 500)
    expect(ok).toBe(true)
    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('lifetime_spent'))).toBe(true)
    expect(calls.some(s => s.includes("'ride_debit'"))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(true)
  })

  it('insufficient balance → rolls back and returns false', async () => {
    scriptWallet('100.00', false)
    const ok = await payFromUserWallet(BigInt(101), BigInt(42), 500)
    expect(ok).toBe(false)
    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(calls.some(s => s.includes('lifetime_spent'))).toBe(false)
  })

  it('existing ride_debit ledger row → idempotent no-op, returns true', async () => {
    scriptWallet('1000.00', true)
    const ok = await payFromUserWallet(BigInt(101), BigInt(42), 500)
    expect(ok).toBe(true)
    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('lifetime_spent'))).toBe(false) // did not debit again
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/pay-from-wallet.test.ts`
Expected: FAIL — `payFromUserWallet` is not exported.

- [ ] **Step 3: Implement `payFromUserWallet`**

In `api/src/modules/payments/payments.service.ts`, after `confirmRidePayment`, add:

```typescript
// ── Pay for a ride from the user wallet (atomic debit) ──────────
// One ride = one payment (payments.ride_id UNIQUE), so a prior ride_debit
// ledger row for this ride means we already paid — return true without
// re-debiting. Insufficient balance returns false: the caller leaves the
// payment 'pending' and the app offers retry (online / wallet / cash).
export async function payFromUserWallet(
  rideId: bigint,
  userId: bigint,
  amount: number
): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO user_wallets (user_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    )

    const walletRes = await client.query(
      `SELECT id, balance FROM user_wallets WHERE user_id = $1 FOR UPDATE`,
      [userId]
    )
    const wallet = walletRes.rows[0]

    const dupe = await client.query(
      `SELECT id FROM user_wallet_ledger
       WHERE ride_id = $1 AND entry_type = 'ride_debit' LIMIT 1`,
      [rideId]
    )
    if ((dupe.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK')
      return true
    }

    const balance = parseFloat(wallet.balance)
    if (balance < amount) {
      await client.query('ROLLBACK')
      return false
    }

    const newBalance = Math.round((balance - amount) * 100) / 100

    await client.query(
      `UPDATE user_wallets
       SET balance = $2, lifetime_spent = lifetime_spent + $3
       WHERE id = $1`,
      [wallet.id, newBalance, amount]
    )

    await client.query(
      `INSERT INTO user_wallet_ledger (
         wallet_id, user_id, entry_type,
         amount, direction, balance_after, ride_id, note
       ) VALUES ($1,$2,'ride_debit',$3,'debit',$4,$5,$6)`,
      [wallet.id, userId, amount, newBalance, rideId, `Ride payment for ride #${rideId}`]
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/payments/pay-from-wallet.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

```bash
git add api/src/modules/payments/payments.service.ts api/tests/unit/payments/pay-from-wallet.test.ts
git commit -m "feat(payments): add atomic payFromUserWallet ride debit"
```

---

## Task 6: `createRidePaymentOrder` + `ridePaymentOrderKey`

**Files:**
- Modify: `api/src/constants/redis-keys.ts`
- Modify: `api/src/modules/payments/payments.service.ts` (imports + add function)
- Test: `api/tests/unit/payments/create-ride-payment-order.test.ts`

Creates the Razorpay order for an online ride payment, stores `razorpay_order_id` on the payment, binds order→user in Redis (so `/verify` can reject a cross-user replay). In dev (no keys) it auto-confirms — mirrors the driver-topup dev shortcut so the flow is testable end-to-end without Razorpay.

- [ ] **Step 1: Add the Redis key**

In `api/src/constants/redis-keys.ts`, after the `walletTopupOrderKey` line, add:

```typescript
export const ridePaymentOrderKey = (orderId: string): string => `ride:payment_order:${orderId}`
```

- [ ] **Step 2: Write the failing test**

Create `api/tests/unit/payments/create-ride-payment-order.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), get: vi.fn(), del: vi.fn() } }))

const ordersCreate = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: ordersCreate }; payments = { fetch: vi.fn() } },
}))

// config is read live; override per test via vi.doMock is heavy — instead mock the module.
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))

import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'
import { createRidePaymentOrder } from '@/modules/payments/payments.service'

describe('createRidePaymentOrder (keys configured)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ordersCreate.mockResolvedValue({ id: 'order_XYZ' })
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 1 } as never)
  })

  it('creates an order for the fare, persists order id, binds order→user', async () => {
    const result = await createRidePaymentOrder(BigInt(101), BigInt(42), 500)
    expect(ordersCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 50000, currency: 'INR' }))
    expect(result).toEqual({ orderId: 'order_XYZ', key: 'rzp_test', amount: 500 })
    const update = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes('razorpay_order_id'))
    expect(update).toBeTruthy()
    expect(vi.mocked(redis.set)).toHaveBeenCalledWith('ride:payment_order:order_XYZ', '42', 'EX', 1800)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/create-ride-payment-order.test.ts`
Expected: FAIL — `createRidePaymentOrder` is not exported.

- [ ] **Step 4: Implement `createRidePaymentOrder`**

In `api/src/modules/payments/payments.service.ts`, add these imports at the top (after `import { pool } from '@/db/client'`):

```typescript
import { config } from '@/config'
import { client as redis } from '@/db/redis'
import { ridePaymentOrderKey } from '@/constants/redis-keys'
```

Then, after `payFromUserWallet`, add:

```typescript
// ── Create a Razorpay order for an online ride payment ──────────
// Returns the order handle for the client to open Checkout, or null in dev
// (no Razorpay keys) after auto-confirming — same dev shortcut the driver
// wallet top-up uses so the online flow is exercisable without a gateway.
export async function createRidePaymentOrder(
  rideId: bigint,
  userId: bigint,
  amount: number
): Promise<{ orderId: string; key: string; amount: number } | null> {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    // ponytail: dev auto-confirm, mirrors driver topup dev-credit path.
    await confirmRidePayment(rideId)
    return null
  }

  const Razorpay = (await import('razorpay')).default
  const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
  const order = await (rzp.orders.create as Function)({
    amount: Math.round(amount * 100),
    currency: 'INR',
    receipt: `ride_${rideId}_${Date.now()}`,
  })
  const orderId = (order as { id: string }).id

  await pool.query(
    `UPDATE payments SET razorpay_order_id = $2 WHERE ride_id = $1`,
    [rideId, orderId]
  )
  await redis.set(ridePaymentOrderKey(orderId), userId.toString(), 'EX', 1800)

  return { orderId, key: config.RAZORPAY_KEY_ID, amount }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/payments/create-ride-payment-order.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

```bash
git add api/src/constants/redis-keys.ts api/src/modules/payments/payments.service.ts api/tests/unit/payments/create-ride-payment-order.test.ts
git commit -m "feat(payments): create Razorpay order for online ride fare"
```

---

## Task 7: Completion hook — branch on `payment_channel`

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts:1174-1192` (inside `verifyEndOTP`)
- Test: `api/tests/unit/rides/completion-payment-branch.test.ts`

Cash is preserved byte-for-byte as the default branch. Online creates a pending payment + order and emits a second completion socket event carrying `razorpayOrderId`. Wallet debits atomically then confirms.

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/rides/completion-payment-branch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { del: vi.fn() } }))
vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'h') }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:     vi.fn(),
  updateRideStatus: vi.fn(),
  logStatusHistory: vi.fn(),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord:   vi.fn().mockResolvedValue(undefined),
  deductCommission:      vi.fn().mockResolvedValue(undefined),
  creditCashback:        vi.fn().mockResolvedValue(undefined),
  confirmRidePayment:    vi.fn().mockResolvedValue(true),
  payFromUserWallet:     vi.fn().mockResolvedValue(true),
  createRidePaymentOrder: vi.fn().mockResolvedValue({ orderId: 'order_XYZ', key: 'k', amount: 500 }),
}))

import * as repo from '@/modules/rides/rides.repository'
import * as pay  from '@/modules/payments/payments.service'
import { pool }  from '@/db/client'
import { socketEvents } from '@/websocket/socket.server'
import { verifyEndOTP } from '@/modules/rides/rides.service'

const flush = () => new Promise(r => setTimeout(r, 0)) // let the non-blocking void chain settle

function baseRide(channel: 'cash' | 'online' | 'wallet') {
  return {
    id: BigInt(101), user_id: 42, driver_id: 9, status: 'in_progress',
    ride_type: 'one_way', end_otp_hash: 'h', payment_channel: channel,
    origin_lat: 20.3, origin_lng: 85.8, user_phone: null,
  }
}

describe('verifyEndOTP — payment channel branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // fare_snapshots amount lookup + any other pool.query → generic amount row
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '500.00' }], rowCount: 1 } as never)
    vi.mocked(repo.updateRideStatus).mockResolvedValue(undefined as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
  })

  it('cash: createPaymentRecord(cash_direct) + commission + cashback', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('cash') as never)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(pay.createPaymentRecord).toHaveBeenCalledWith(BigInt(101), 'cash_direct')
    expect(pay.deductCommission).toHaveBeenCalledWith(BigInt(101), BigInt(9))
    expect(pay.creditCashback).toHaveBeenCalled()
    expect(pay.createRidePaymentOrder).not.toHaveBeenCalled()
  })

  it('online: pending payment + order + emits razorpayOrderId, defers commission', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('online') as never)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(pay.createPaymentRecord).toHaveBeenCalledWith(BigInt(101), 'razorpay_online', { status: 'pending' })
    expect(pay.createRidePaymentOrder).toHaveBeenCalledWith(BigInt(101), BigInt(42), 500)
    expect(pay.deductCommission).not.toHaveBeenCalled()
    const emitted = vi.mocked(socketEvents.sendRideStatusUpdate).mock.calls
      .map(c => c[1] as Record<string, unknown>)
      .find(p => p['razorpayOrderId'] === 'order_XYZ')
    expect(emitted).toBeTruthy()
  })

  it('wallet: pending payment + wallet debit + confirm', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide('wallet') as never)
    await verifyEndOTP(BigInt(9), BigInt(101), '1234')
    await flush()
    expect(pay.createPaymentRecord).toHaveBeenCalledWith(BigInt(101), 'platform_wallet', { status: 'pending' })
    expect(pay.payFromUserWallet).toHaveBeenCalledWith(BigInt(101), BigInt(42), 500)
    expect(pay.confirmRidePayment).toHaveBeenCalledWith(BigInt(101))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/completion-payment-branch.test.ts`
Expected: FAIL — the online/wallet expectations fail because the current hook always calls `createPaymentRecord(rideId, 'cash_direct')`.

- [ ] **Step 3: Confirm the imports in `rides.service.ts`**

The payments import at the top of `api/src/modules/rides/rides.service.ts` is already multi-line (lines 22-26). Replace that block:

```typescript
import {
  createPaymentRecord,
  deductCommission,
  creditCashback,
} from '@/modules/payments/payments.service'
```

with:

```typescript
import {
  createPaymentRecord,
  deductCommission,
  creditCashback,
  confirmRidePayment,
  payFromUserWallet,
  createRidePaymentOrder,
} from '@/modules/payments/payments.service'
```

- [ ] **Step 4: Replace the completion post-processing block**

In `api/src/modules/rides/rides.service.ts`, replace the block at lines 1174-1192 (from the `// Payment + wallet post-processing` comment through the `.catch(...)` of the old `void createPaymentRecord(...)` chain) with:

```typescript
  // Payment + wallet post-processing (non-blocking — ride is already completed)
  const rideData = await repo.getRideById(rideId)
  const fareRow = await pool.query(
    `SELECT COALESCE(total_final, total_estimated) AS amount
     FROM fare_snapshots WHERE ride_id = $1`,
    [rideId]
  )
  const fareAmount = parseFloat(fareRow.rows[0]?.amount ?? '0')
  const paymentChannel = rideData?.payment_channel ?? 'cash'

  void (async () => {
    if (paymentChannel === 'online') {
      await createPaymentRecord(rideId, 'razorpay_online', { status: 'pending' })
      if (rideData?.user_id == null || fareAmount <= 0) return
      const order = await createRidePaymentOrder(rideId, BigInt(rideData.user_id), fareAmount)
      // order is null in dev (auto-confirmed); with keys, push order id so the
      // app opens Checkout. Commission + cashback run only on confirm.
      if (order) {
        socketEvents.sendRideStatusUpdate(rideId.toString(), {
          status:          'completed',
          paymentChannel:  'online',
          razorpayOrderId: order.orderId,
          razorpayKey:     order.key,
          amount:          order.amount,
        })
      }
      return
    }

    if (paymentChannel === 'wallet') {
      await createPaymentRecord(rideId, 'platform_wallet', { status: 'pending' })
      if (rideData?.user_id == null || fareAmount <= 0) return
      const paid = await payFromUserWallet(rideId, BigInt(rideData.user_id), fareAmount)
      // Insufficient balance → payment stays pending, app offers retry.
      if (paid) await confirmRidePayment(rideId)
      return
    }

    // cash (default) — unchanged behavior: capture immediately, commission + cashback now.
    await createPaymentRecord(rideId, 'cash_direct')
    await deductCommission(rideId, driverId)
    if (rideData?.user_id == null || fareAmount <= 0) return
    await creditCashback(rideId, BigInt(rideData.user_id), fareAmount)
  })().catch((err: unknown) => {
    console.error(`Payment post-processing failed for ride ${rideId}:`, err)
  })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/completion-payment-branch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full suite + typecheck + commit**

Run: `cd api && pnpm test` — confirm no regression in existing ride/payment tests.
Run: `cd api && npx tsc --noEmit`
Expected: no errors.

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/completion-payment-branch.test.ts
git commit -m "feat(payments): branch ride completion on payment_channel"
```

---

## Task 8: Client verify endpoint — `POST /rides/:id/payment/verify`

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts` (add `verifyRidePayment`)
- Modify: `api/src/modules/rides/rides.routes.ts` (route + import)
- Test: `api/tests/unit/payments/verify-ride-payment.test.ts`

**Security-critical (CLAUDE.md non-negotiables):** HMAC-SHA256 signature over `orderId|paymentId`; re-fetch the payment from Razorpay server-side; the client-supplied amount is NEVER trusted — compare Razorpay's captured `amount` against the stored `payments.amount`; order must be bound to this user (Redis) AND be the order recorded for this ride's payment. No `error.message` leaks — errors carry safe messages + `httpStatus` and flow through the existing error middleware.

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/payments/verify-ride-payment.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), del: vi.fn(), set: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))

const paymentsFetch = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: vi.fn() }; payments = { fetch: paymentsFetch } },
}))

// confirmRidePayment lives in the module under test; spy on the real export.
import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'
import { client as redis } from '@/db/redis'

const ORDER = 'order_XYZ'
const PAYMENT = 'pay_abc'
const goodSig = createHmac('sha256', 'secret').update(`${ORDER}|${PAYMENT}`).digest('hex')

describe('verifyRidePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(redis.get).mockResolvedValue('42') // order bound to user 42
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '500.00', razorpay_order_id: ORDER }], rowCount: 1 } as never)
    paymentsFetch.mockResolvedValue({ order_id: ORDER, status: 'captured', amount: 50000 })
  })

  it('rejects a bad signature (no confirm)', async () => {
    const spy = vi.spyOn(svc, 'confirmRidePayment').mockResolvedValue(true)
    await expect(
      svc.verifyRidePayment(BigInt(101), BigInt(42), { orderId: ORDER, paymentId: PAYMENT, signature: 'wrong' })
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects when Razorpay amount != stored fare (client cannot inflate/deflate)', async () => {
    paymentsFetch.mockResolvedValue({ order_id: ORDER, status: 'captured', amount: 100 })
    const spy = vi.spyOn(svc, 'confirmRidePayment').mockResolvedValue(true)
    await expect(
      svc.verifyRidePayment(BigInt(101), BigInt(42), { orderId: ORDER, paymentId: PAYMENT, signature: goodSig })
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects a cross-user order (bound to a different user)', async () => {
    vi.mocked(redis.get).mockResolvedValue('999')
    const spy = vi.spyOn(svc, 'confirmRidePayment').mockResolvedValue(true)
    await expect(
      svc.verifyRidePayment(BigInt(101), BigInt(42), { orderId: ORDER, paymentId: PAYMENT, signature: goodSig })
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('valid signature + captured + matching amount → confirms', async () => {
    const spy = vi.spyOn(svc, 'confirmRidePayment').mockResolvedValue(true)
    await svc.verifyRidePayment(BigInt(101), BigInt(42), { orderId: ORDER, paymentId: PAYMENT, signature: goodSig })
    expect(spy).toHaveBeenCalledWith(BigInt(101), PAYMENT)
    expect(redis.del).toHaveBeenCalledWith('ride:payment_order:order_XYZ')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/verify-ride-payment.test.ts`
Expected: FAIL — `verifyRidePayment` is not exported.

- [ ] **Step 3: Implement `verifyRidePayment`**

In `api/src/modules/payments/payments.service.ts`, after `createRidePaymentOrder`, add:

```typescript
// ── Client-driven verify (primary confirmation path) ───────────
// Mirrors the proven driver wallet-topup verify. Never trusts client input:
// signature verified with our secret, payment re-fetched from Razorpay, and
// the captured amount compared to the fare we stored. All failures throw a
// safe-message error (no error.message leak) with an httpStatus.
export async function verifyRidePayment(
  rideId: bigint,
  userId: bigint,
  input: { orderId: string; paymentId: string; signature: string }
): Promise<void> {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    throw Object.assign(new Error('Payment verification is not configured'), { httpStatus: 400 })
  }

  // The order must have been created for this user (bound at order creation).
  const boundUserId = await redis.get(ridePaymentOrderKey(input.orderId))
  if (boundUserId !== userId.toString()) {
    throw Object.assign(new Error('Order does not belong to this user'), { httpStatus: 400 })
  }

  // ...and it must be the order recorded for THIS ride's payment.
  const payRes = await pool.query(
    `SELECT amount, razorpay_order_id FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment || payment.razorpay_order_id !== input.orderId) {
    throw Object.assign(new Error('Payment not found for this ride'), { httpStatus: 404 })
  }

  const { createHmac } = await import('crypto')
  const expected = createHmac('sha256', config.RAZORPAY_KEY_SECRET)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex')
  if (input.signature !== expected) {
    throw Object.assign(new Error('Invalid payment signature'), { httpStatus: 400 })
  }

  const Razorpay = (await import('razorpay')).default
  const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
  const rp = await (rzp.payments.fetch as Function)(input.paymentId) as {
    order_id: string; status: string; amount: number
  }
  const expectedPaise = Math.round(parseFloat(payment.amount) * 100)
  if (rp.order_id !== input.orderId || rp.status !== 'captured' || rp.amount !== expectedPaise) {
    throw Object.assign(new Error('Payment not verified'), { httpStatus: 400 })
  }

  await confirmRidePayment(rideId, input.paymentId)
  await redis.del(ridePaymentOrderKey(input.orderId))
}
```

- [ ] **Step 4: Add the route**

In `api/src/modules/rides/rides.routes.ts`, add an import for the payments service near the top (after the existing `import * as service from './rides.service'` line):

```typescript
import * as paymentsService from '@/modules/payments/payments.service'
```

Add this route (place it near the other `/:id/...` POST routes, e.g. after the `/:id/end-otp` route):

```typescript
router.post('/:id/payment/verify', authenticate(), async (req, res, next) => {
  try {
    const rideId = BigInt(req.params['id']!)
    const { orderId, paymentId, signature } = req.body as {
      orderId: string; paymentId: string; signature: string
    }
    await paymentsService.verifyRidePayment(rideId, req.user!.id, { orderId, paymentId, signature })
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 5: Run test + full suite + typecheck**

Run: `cd api && npx vitest run tests/unit/payments/verify-ride-payment.test.ts`
Expected: PASS (4 tests).
Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Security self-check + commit**

Confirm against CLAUDE.md security rules: (a) signature verified with `RAZORPAY_KEY_SECRET` from `config` (env only); (b) amount taken from `rzp.payments.fetch`, compared to stored `payments.amount` — client body amount never used; (c) errors carry safe messages + `httpStatus`, no `error.message` returned to client. All three hold.

```bash
git add api/src/modules/payments/payments.service.ts api/src/modules/rides/rides.routes.ts api/tests/unit/payments/verify-ride-payment.test.ts
git commit -m "feat(payments): add client verify endpoint for online ride payment"
```

---

## Task 9: Webhook backstop — act on `payment.captured`

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts:322-348` (`handleWebhookEvent`)
- Test: `api/tests/unit/payments/webhook-captured.test.ts`

Extends the log-only stub. Maps Razorpay dotted event names to the `gateway_event_type` enum (the old stub inserted raw `event` / `'unknown'`, neither a valid enum value — this fixes that latent bug). On `payment.captured`, looks up the payment by `razorpay_order_id` and calls `confirmRidePayment` — which no-ops if the client verify already completed it (compare-before-write). Duplicate delivery is deduped by the `razorpay_event_id` unique key as today.

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/payments/webhook-captured.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' } }))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'

function capturedPayload(paymentId: string, orderId: string) {
  return { event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, status: 'captured' } } } }
}

describe('handleWebhookEvent — payment.captured', () => {
  beforeEach(() => vi.clearAllMocks())

  it('duplicate event (already logged) → no confirm', async () => {
    const spy = vi.spyOn(svc, 'confirmRidePayment').mockResolvedValue(true)
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 } as never) // dedupe hit
    await svc.handleWebhookEvent(capturedPayload('pay_1', 'order_1'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('new captured event with a pending payment → confirms that ride', async () => {
    const spy = vi.spyOn(svc, 'confirmRidePayment').mockResolvedValue(true)
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)                 // dedupe: not seen
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never)                 // INSERT gateway event
      .mockResolvedValueOnce({ rows: [{ ride_id: 101 }], rowCount: 1 } as never) // pending payment for order
    await svc.handleWebhookEvent(capturedPayload('pay_1', 'order_1'))
    expect(spy).toHaveBeenCalledWith(BigInt(101), 'pay_1')
  })

  it('captured event but no pending payment (already completed) → no confirm', async () => {
    const spy = vi.spyOn(svc, 'confirmRidePayment').mockResolvedValue(true)
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // dedupe: not seen
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never) // INSERT gateway event
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // no pending payment
    await svc.handleWebhookEvent(capturedPayload('pay_1', 'order_1'))
    expect(spy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/webhook-captured.test.ts`
Expected: FAIL — the current handler never calls `confirmRidePayment`.

- [ ] **Step 3: Rewrite `handleWebhookEvent`**

In `api/src/modules/payments/payments.service.ts`, replace `handleWebhookEvent` (lines 322-348) with:

```typescript
// ── Razorpay webhook handler (backstop confirmation) ───────────
// Maps Razorpay's dotted event names to our gateway_event_type enum. Only the
// events we act on are logged (dedup relies on the razorpay_event_id unique
// key). On payment.captured we confirm the matching pending ride payment;
// confirmRidePayment is status-guarded, so a webhook that arrives after the
// client verify already completed the payment is a harmless no-op.
const GATEWAY_EVENT_MAP: Record<string, string> = {
  'order.paid':          'order_created',
  'payment.authorized':  'payment_authorized',
  'payment.captured':    'payment_captured',
  'payment.failed':      'payment_failed',
}

export async function handleWebhookEvent(
  payload: Record<string, unknown>
): Promise<void> {
  const event = (payload as { event?: string }).event ?? ''
  const mappedType = GATEWAY_EVENT_MAP[event]
  if (!mappedType) return // not an event we track

  const entity = (payload as {
    payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } }
  })?.payload?.payment?.entity
  const eventId = entity?.id
  if (!eventId) return

  const existing = await pool.query(
    `SELECT id FROM payment_gateway_events WHERE razorpay_event_id = $1`,
    [eventId]
  )
  if (existing.rows.length) return

  await pool.query(
    `INSERT INTO payment_gateway_events
       (event_type, razorpay_event_id, payload, processed, processed_at)
     VALUES ($1::gateway_event_type,$2,$3,true,now())`,
    [mappedType, eventId, JSON.stringify(payload)]
  )

  if (event === 'payment.captured' && entity?.order_id) {
    const payRes = await pool.query(
      `SELECT ride_id FROM payments
       WHERE razorpay_order_id = $1 AND status = 'pending'`,
      [entity.order_id]
    )
    const row = payRes.rows[0]
    if (row) await confirmRidePayment(BigInt(row.ride_id), eventId)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/payments/webhook-captured.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

```bash
git add api/src/modules/payments/payments.service.ts api/tests/unit/payments/webhook-captured.test.ts
git commit -m "feat(payments): webhook backstop confirms captured ride payments"
```

---

## Task 10: Reconciliation sweep — queue, worker, repeatable job

**Files:**
- Modify: `api/src/jobs/queues/index.ts`
- Modify: `api/src/modules/payments/payments.service.ts` (add `reconcilePendingRidePayments`)
- Create: `api/src/jobs/workers/payment-reconcile.worker.ts`
- Modify: `api/src/server.ts`
- Test: `api/tests/unit/payments/reconcile-pending.test.ts`

Covers the app-killed-before-verify case. Every few minutes, selects `pending` payments with a `razorpay_order_id` older than 10 minutes, asks Razorpay whether a capture landed: captured → same confirm funnel; none → mark `failed` (ride stays completed; app shows retry).

- [ ] **Step 1: Add the `PAYMENTS` queue**

In `api/src/jobs/queues/index.ts`, add `PAYMENTS: 'payments',` to `QUEUE_NAMES`, then add the queue instance and register it in the `queues` map:

```typescript
export const paymentsQueue = new Queue(QUEUE_NAMES.PAYMENTS, { connection })
```

Add to the `queues` object literal:

```typescript
  [QUEUE_NAMES.PAYMENTS]: paymentsQueue,
```

- [ ] **Step 2: Write the failing test**

Create `api/tests/unit/payments/reconcile-pending.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))

const fetchPayments = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: vi.fn(), fetchPayments }; payments = { fetch: vi.fn() } },
}))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'

describe('reconcilePendingRidePayments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('captured on recheck → confirms', async () => {
    const spy = vi.spyOn(svc, 'confirmRidePayment').mockResolvedValue(true)
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ ride_id: 101, razorpay_order_id: 'order_1' }], rowCount: 1,
    } as never)
    fetchPayments.mockResolvedValue({ items: [{ id: 'pay_9', status: 'captured' }] })
    await svc.reconcilePendingRidePayments()
    expect(spy).toHaveBeenCalledWith(BigInt(101), 'pay_9')
  })

  it('no capture after grace → marks failed, does not confirm', async () => {
    const spy = vi.spyOn(svc, 'confirmRidePayment').mockResolvedValue(true)
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ ride_id: 101, razorpay_order_id: 'order_1' }], rowCount: 1 } as never) // select pending
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never) // UPDATE ... failed
    fetchPayments.mockResolvedValue({ items: [{ id: 'pay_9', status: 'failed' }] })
    await svc.reconcilePendingRidePayments()
    expect(spy).not.toHaveBeenCalled()
    const failUpdate = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes("status = 'failed'"))
    expect(failUpdate).toBeTruthy()
    expect(failUpdate![0] as string).toContain("status = 'pending'") // guarded so a confirmed ride is untouched
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/reconcile-pending.test.ts`
Expected: FAIL — `reconcilePendingRidePayments` is not exported.

- [ ] **Step 4: Implement `reconcilePendingRidePayments`**

In `api/src/modules/payments/payments.service.ts`, after `handleWebhookEvent`, add:

```typescript
// ── Reconciliation sweep (app-killed-before-verify safety net) ──
// Pending online payments older than the grace window get rechecked directly
// against Razorpay. Captured → same confirm funnel. Not captured → failed
// (guarded on status='pending' so a payment another path already confirmed is
// never overwritten). Ride stays completed either way.
export async function reconcilePendingRidePayments(): Promise<void> {
  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) return

  const res = await pool.query(
    `SELECT ride_id, razorpay_order_id
     FROM payments
     WHERE status = 'pending'
       AND razorpay_order_id IS NOT NULL
       AND created_at < now() - interval '10 minutes'`
  )
  if (res.rows.length === 0) return

  const Razorpay = (await import('razorpay')).default
  const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })

  for (const row of res.rows) {
    try {
      const orderId = row.razorpay_order_id as string
      const list = await (rzp.orders.fetchPayments as Function)(orderId) as {
        items: Array<{ id: string; status: string }>
      }
      const captured = list.items.find(p => p.status === 'captured')
      if (captured) {
        await confirmRidePayment(BigInt(row.ride_id), captured.id)
      } else {
        await pool.query(
          `UPDATE payments
             SET status = 'failed', failed_at = now(), failure_reason = 'reconciliation_no_capture'
           WHERE ride_id = $1 AND status = 'pending'`,
          [BigInt(row.ride_id)]
        )
      }
    } catch (err) {
      console.error(`[reconcile] ride ${row.ride_id} failed:`, err)
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/payments/reconcile-pending.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Create the worker**

Create `api/src/jobs/workers/payment-reconcile.worker.ts`:

```typescript
import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { reconcilePendingRidePayments } from '@/modules/payments/payments.service'

export const paymentReconcileWorker = new Worker(
  QUEUE_NAMES.PAYMENTS,
  async () => {
    await reconcilePendingRidePayments()
  },
  { connection: redisConnection }
)

paymentReconcileWorker.on('failed', (job, err) => {
  console.error(`[payment-reconcile] job ${job?.id} failed:`, err)
})
```

- [ ] **Step 7: Register the worker + repeatable job in `server.ts`**

In `api/src/server.ts`, add the imports (next to the other worker imports around lines 7-13):

```typescript
import { paymentReconcileWorker } from './jobs/workers/payment-reconcile.worker'
```

Add `paymentsQueue` to the queue import (line 13):

```typescript
import { cleanupQueue, schedulerQueue, partitionMaintenanceQueue, paymentsQueue } from './jobs/queues'
```

Then, in the `start()` body after the partition-maintenance registration (after line 72, before `httpServer.listen`), add:

```typescript
  void paymentReconcileWorker
  console.log('[Worker] Payment reconciliation worker started')
  await paymentsQueue.add(
    'reconcile_pending_payments',
    {},
    { repeat: { every: 300_000 }, removeOnComplete: true, removeOnFail: true }
  )
```

- [ ] **Step 8: Typecheck + full suite + commit**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.
Run: `cd api && pnpm test`
Expected: all unit tests pass.

```bash
git add api/src/jobs/queues/index.ts api/src/modules/payments/payments.service.ts api/src/jobs/workers/payment-reconcile.worker.ts api/src/server.ts api/tests/unit/payments/reconcile-pending.test.ts
git commit -m "feat(payments): reconciliation sweep for stuck pending ride payments"
```

---

## Task 11: Frontend — payment-method selection threaded into booking

**Files:**
- Modify: `apps/user/lib/ride-api.ts:159-201`
- Create: `apps/user/lib/payment-channel.ts`
- Modify: `apps/user/app/(main)/payment-methods/page.tsx`
- Modify: `apps/user/app/(main)/select-ride/page.tsx:217-228`
- Modify: `apps/user/app/(main)/rental/page.tsx:199-217`

No frontend unit-test infra exists in this repo — verify with `tsc`/build + a manual click-through. Cash remains the default everywhere.

- [ ] **Step 1: Add `paymentChannel` to the booking API client**

In `apps/user/lib/ride-api.ts`, add to the `createBooking` params type (after `stops?: StopInput[]`):

```typescript
    paymentChannel?: 'cash' | 'online' | 'wallet'
```

And thread it into the body (after the `scheduledFor` line in the conditional block):

```typescript
    if (params.paymentChannel      !== undefined) body['paymentChannel']      = params.paymentChannel
```

Also add a `verifyPayment` method to the `rideApi` object (after `cancelRide`, before the closing `}`), so the ride page can verify through the same client the file already uses:

```typescript
  verifyPayment: async (
    rideId: string,
    input: { orderId: string; paymentId: string; signature: string },
  ): Promise<void> => {
    await api.post(`/api/v1/rides/${rideId}/payment/verify`, input)
  },
```

(`api` is already imported at the top of `ride-api.ts`.)

- [ ] **Step 2: Create the channel store helper**

Create `apps/user/lib/payment-channel.ts`:

```typescript
export type PaymentChannel = 'cash' | 'online' | 'wallet'

const KEY = 'ocar_payment_channel'

export function getPaymentChannel(): PaymentChannel {
  if (typeof window === 'undefined') return 'cash'
  const v = window.localStorage.getItem(KEY)
  return v === 'online' || v === 'wallet' ? v : 'cash'
}

export function setPaymentChannel(channel: PaymentChannel): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, channel)
}
```

- [ ] **Step 3: Turn the payment-methods page into a real selector**

Replace the body of `apps/user/app/(main)/payment-methods/page.tsx` with a live selector. Replace the whole file with:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Banknote, CreditCard, Wallet, Check } from 'lucide-react'
import { getPaymentChannel, setPaymentChannel, type PaymentChannel } from '@/lib/payment-channel'

const OPTIONS: Array<{ id: PaymentChannel; Icon: typeof Banknote; label: string; sub: string }> = [
  { id: 'cash',   Icon: Banknote,   label: 'Cash',        sub: 'Pay directly to driver' },
  { id: 'online', Icon: CreditCard, label: 'UPI / Cards', sub: 'Pay online via Razorpay' },
  { id: 'wallet', Icon: Wallet,     label: 'Ocar Wallet', sub: 'Use your wallet balance' },
]

export default function PaymentMethodsPage() {
  const router = useRouter()
  const [selected, setSelected] = useState<PaymentChannel>('cash')

  useEffect(() => { setSelected(getPaymentChannel()) }, [])

  const choose = (id: PaymentChannel) => {
    setSelected(id)
    setPaymentChannel(id)
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b border-slate-100"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)', paddingBottom: 12 }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center flex-shrink-0 active:bg-slate-200 transition-colors"
        >
          <ArrowLeft size={17} strokeWidth={2} className="text-slate-800" />
        </button>
        <p className="text-[15px] font-bold text-slate-900">Payment methods</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-28">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">
          Choose how you pay
        </p>
        <div className="bg-surface rounded-2xl border border-border overflow-hidden shadow-card">
          {OPTIONS.map((item, i, arr) => {
            const active = selected === item.id
            return (
              <button
                key={item.id}
                onClick={() => choose(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left${i < arr.length - 1 ? ' border-b border-border' : ''}`}
              >
                <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
                  <item.Icon size={15} strokeWidth={1.6} className="text-text-primary" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-text-primary">{item.label}</span>
                  <span className="block text-xs text-text-muted mt-0.5">{item.sub}</span>
                </span>
                {active && (
                  <span className="w-6 h-6 rounded-full bg-status-success/10 flex items-center justify-center flex-shrink-0">
                    <Check size={13} strokeWidth={2.5} className="text-status-success" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Pass the selected channel from the booking call sites**

In `apps/user/app/(main)/select-ride/page.tsx`, add the import near the top:

```typescript
import { getPaymentChannel } from '@/lib/payment-channel'
```

In the object built at line 217 (`const bookingParams: Parameters<typeof rideApi.createBooking>[0] = { ... }`), add the field:

```typescript
        paymentChannel: getPaymentChannel(),
```

Repeat in `apps/user/app/(main)/rental/page.tsx`: add the same import, and add `paymentChannel: getPaymentChannel(),` to the `params` object built at line 199.

- [ ] **Step 5: Typecheck the user app**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run the API + user app (`cd api && pnpm dev`, `cd apps/user && pnpm dev`). Open `/payment-methods`, pick "UPI / Cards", reload — the selection persists (Check stays on UPI). Book a ride; in the API DB confirm the row: `docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT id, payment_channel FROM rides ORDER BY id DESC LIMIT 1;"` shows `online`. Switch back to Cash and book again → `cash`.

- [ ] **Step 7: Commit**

```bash
git add apps/user/lib/ride-api.ts apps/user/lib/payment-channel.ts "apps/user/app/(main)/payment-methods/page.tsx" "apps/user/app/(main)/select-ride/page.tsx" "apps/user/app/(main)/rental/page.tsx"
git commit -m "feat(user): payment-method selector threaded into ride booking"
```

---

## Task 12: Frontend — open Razorpay Checkout on completion, then verify

**Files:**
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx:343-358` (the `onStatusUpdate` handler) + add a checkout helper

Mirrors the driver wallet Checkout pattern (`apps/driver/src/pages/Wallet.tsx:86-114`): lazy-load `checkout.razorpay.com/v1/checkout.js`, open with the emitted `order_id`/`key`, and on the handler callback POST to the new verify endpoint. No new screen — this hooks into the existing completion socket event on the ride-tracking page.

- [ ] **Step 1: Add a checkout trigger helper in the ride page**

In `apps/user/app/(main)/ride/[id]/page.tsx`, add this module-scope helper near the top of the file (after the imports, before the component). It verifies through `rideApi.verifyPayment` (added in Task 11) — `rideApi` is already imported at line 9:

```tsx
async function openRidePaymentCheckout(
  rideId: string,
  opts: { orderId: string; key: string; amount: number },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (document.getElementById('rzp-script')) { resolve(); return }
    const s = document.createElement('script')
    s.id = 'rzp-script'
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = reject
    document.body.appendChild(s)
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rzp = new (window as any).Razorpay({
    key: opts.key,
    order_id: opts.orderId,
    amount: Math.round(opts.amount * 100),
    currency: 'INR',
    name: 'Ocar',
    description: `Ride #${rideId}`,
    handler: async (response: {
      razorpay_order_id: string
      razorpay_payment_id: string
      razorpay_signature: string
    }) => {
      await rideApi.verifyPayment(rideId, {
        orderId: response.razorpay_order_id,
        paymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
      })
    },
  })
  rzp.open()
}
```

- [ ] **Step 2: Trigger checkout from the completion socket event**

In the same file, extend the `onStatusUpdate` handler (currently at lines 343-358). Widen its param type and add the online-payment trigger. Replace the handler with:

```tsx
    const onStatusUpdate = (data: {
      status: string; startOtp?: string; endOtp?: string
      fareDrift?: { previousFare: number; currentFare: number }
      paymentChannel?: string
      razorpayOrderId?: string
      razorpayKey?: string
      amount?: number
    }) => {
      setRideStatus(data.status)
      if (data.startOtp) setStartOtp(data.startOtp)
      if (data.endOtp)   setEndOtp(data.endOtp)
      if (data.fareDrift) {
        setFareDrift(data.fareDrift)
        setRide(prev => prev ? { ...prev, total_estimated: String(data.fareDrift!.currentFare) } : prev)
      }
      if (data.status === 'in_progress') {
        breadcrumbRef.current = []
        setBreadcrumb([])
      }
      if (
        data.status === 'completed' &&
        data.paymentChannel === 'online' &&
        data.razorpayOrderId && data.razorpayKey && typeof data.amount === 'number'
      ) {
        void openRidePaymentCheckout(rideId, {
          orderId: data.razorpayOrderId,
          key: data.razorpayKey,
          amount: data.amount,
        }).catch(() => { /* rider can retry from the recap screen */ })
      }
    }
```

- [ ] **Step 3: Typecheck the user app**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification (dev mode, no Razorpay keys)**

With no Razorpay keys set (dev), an online-channel ride auto-confirms server-side (Task 6 dev shortcut) and no Checkout opens — verify the payment row: `docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT ride_id, channel, status FROM payments ORDER BY id DESC LIMIT 1;"` shows `razorpay_online | completed`. For a wallet-channel ride with sufficient balance, the same query shows `platform_wallet | completed` and `user_wallet_ledger` has a matching `ride_debit`. (Live Checkout requires real `RAZORPAY_KEY_ID/SECRET`; the script/verify path mirrors the working driver top-up flow.)

- [ ] **Step 5: Commit**

```bash
git add "apps/user/app/(main)/ride/[id]/page.tsx"
git commit -m "feat(user): open Razorpay Checkout and verify on online ride completion"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §1 Payment channel selection (`rides.payment_channel`, selector page) | 1, 2, 11 |
| §2 Completion hook branch (cash unchanged / online pending+order / wallet debit) | 3, 5, 6, 7 |
| §3 Client verify endpoint (signature, re-fetch, amount not trusted, confirm) | 4, 8 |
| §4 Webhook backstop (act on `payment.captured`, status-guarded) | 4, 9 |
| §5 Reconciliation sweep (repeatable BullMQ job, captured→confirm / else failed) | 4, 10 |
| §2 wallet-as-payment third branch | 5, 7 |
| §6 Testing (channel branch, webhook idempotency, reconciliation branches) | 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| Client Checkout trigger via completion socket event | 12 |

All six spec sections map to tasks. Out-of-scope items (refunds, settlements, pre-auth, unpaid-due blocking) are intentionally absent.

**2. Placeholder scan** — every code step contains complete, runnable code (SQL, TS functions, tests, tsx). No "TBD"/"add error handling"/"similar to Task N". Migration and frontend tasks that legitimately have no unit-test infra use explicit run-and-verify commands + DB assertions instead of vague prose.

**3. Type consistency** — cross-task names verified: `createPaymentRecord(rideId, channel, { status })`, `confirmRidePayment(rideId, razorpayPaymentId?)` → `boolean`, `payFromUserWallet(rideId, userId, amount)` → `boolean`, `createRidePaymentOrder(rideId, userId, amount)` → `{orderId,key,amount}|null`, `verifyRidePayment(rideId, userId, {orderId,paymentId,signature})`, `reconcilePendingRidePayments()`, `ridePaymentOrderKey(orderId)`. Channel string values consistent: `rides.payment_channel` ∈ {cash,online,wallet}; `payments.channel` uses `cash_direct`/`razorpay_online`/`platform_wallet`. Completion socket payload keys (`razorpayOrderId`/`razorpayKey`/`amount`/`paymentChannel`) match between Task 7 (emit) and Task 12 (consume). `exactOptionalPropertyTypes`: Task 2 assigns `paymentChannel` unconditionally (always has a value); Task 4/8 guard optional `razorpayPaymentId`/build objects before optional set.

**4. Ordering / always-working** — cash flow is preserved at every step: the column defaults `'cash'` (Task 1), `createPaymentRecord`'s new `opts` defaults to today's completed-capture behavior (Task 3), and the completion branch keeps cash as the untouched default path (Task 7). New service functions (Tasks 3-6) are added before the completion hook consumes them (Task 7); verify/webhook/reconcile (8-10) build on the Task 4 funnel; frontend (11-12) lands last.
