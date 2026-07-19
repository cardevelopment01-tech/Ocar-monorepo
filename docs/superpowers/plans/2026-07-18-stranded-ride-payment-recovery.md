# Stranded Ride-Payment Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an online or wallet ride payment never completes, proactively notify the rider, surface the pending/failed status on the trip receipt, and let them retry through the existing (idempotency-guarded) confirmation path.

**Architecture:** A new `retryRidePayment(rideId, userId)` service function resets a `pending`/`failed` ride payment and re-runs the *existing* channel flow (`createRidePaymentOrder` for online, `payFromUserWallet` + `confirmRidePayment` for wallet) — it never introduces a second confirmation path; `confirmRidePayment`'s `WHERE status='pending'` guard stays the single idempotency lock. A `payment_failed` notification template + a thin `notifyRidePaymentFailed()` helper are fired from the two existing failure sites (reconciliation sweep; wallet-insufficient at ride completion). The receipt page reads a new `payment_status` field and shows a "Pay now" banner; the Razorpay Checkout opener is extracted to a shared `apps/user/lib` module so both the live-tracking screen and the receipt reuse it.

**Tech Stack:** Express + TypeScript, PostgreSQL (pg), Redis, Razorpay, BullMQ, Vitest (backend unit tests). Frontend: Next.js 16 (App Router) `apps/user`, React 19, Tailwind v3, Framer Motion. No frontend unit-test infra — frontend tasks verify with `tsc --noEmit` + `pnpm build`.

---

## File Structure

**Backend (`api/`)**
- `src/db/migrations/048_payment_failed_template.sql` — **create.** Seeds the `payment_failed` push template.
- `src/modules/notifications/notifications.service.ts` — **modify.** Add `notifyRidePaymentFailed()` helper.
- `src/modules/payments/payments.service.ts` — **modify.** Add `retryRidePayment()` + `RetryRidePaymentResult`; add the notify call inside `reconcilePendingRidePayments`.
- `src/modules/rides/rides.routes.ts` — **modify.** Add `POST /:id/payment/retry`.
- `src/modules/rides/rides.service.ts` — **modify.** Extract the ride-completion payment post-processing into an exported `settleRideCompletionPayment()` and add the wallet-insufficient notify call.
- `src/modules/rides/rides.repository.ts` — **modify.** Add `payment_status` to `getRideById`'s SELECT.
- `src/modules/rides/rides.types.ts` — **modify.** Add `payment_status` to the `Ride` interface.

**Backend tests (`api/tests/unit/`)**
- `notifications/notify-ride-payment-failed.test.ts` — **create.**
- `payments/retry-ride-payment.test.ts` — **create.**
- `payments/reconcile-pending.test.ts` — **modify.** Assert the notify call on the failed branch.
- `rides/settle-ride-completion-payment.test.ts` — **create.**

**Frontend (`apps/user/`)**
- `lib/razorpay-checkout.ts` — **create.** Extracted `openRidePaymentCheckout` (with optional `onVerified`).
- `app/(main)/ride/[id]/page.tsx` — **modify.** Import the extracted helper; delete the inline copy.
- `lib/ride-api.ts` — **modify.** Add `payment_status` to `RideDetail`; add `retryPayment` + `RetryPaymentResult`.
- `app/(main)/ride/[id]/receipt/page.tsx` — **modify.** Payment-status banner + "Pay now".
- `app/(main)/notifications/page.tsx` — **modify.** `payment_failed` tap navigates to the receipt.

---

## Task 1: `payment_failed` notification template (migration)

**Files:**
- Create: `api/src/db/migrations/048_payment_failed_template.sql`

Only a `push`-channel row is seeded. The in-app feed copy is derived from this same render by `notifyOwner()` (see Task 2) — exactly how `ride_completed` works (it too has no separate `in_app` template row). Adding a dead `in_app` template row would never be read by `renderTemplate`, so it is intentionally omitted.

- [ ] **Step 1: Write the migration**

```sql
-- Stranded ride-payment recovery: proactive "payment failed" notification.
-- Push-channel template only — notifyOwner() reuses this render to build the
-- in-app feed row too (same pattern as ride_completed in 036), so no separate
-- in_app template row is needed.
INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema) VALUES
  ('payment_failed', 'Ride payment failed (push to rider)', 'push', 'Payment failed',
   'Your ₹{{amount}} ride payment didn''t go through. Tap to pay now.',
   '{"required": ["amount"], "optional": []}');
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: migration `048_payment_failed_template.sql` runs without error.

- [ ] **Step 3: Verify the row exists**

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT slug, channel, subject FROM notification_templates WHERE slug='payment_failed';"`
Expected: one row — `payment_failed | push | Payment failed`.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/048_payment_failed_template.sql
git commit -m "feat(payments): seed payment_failed notification template"
```

---

## Task 2: `notifyRidePaymentFailed()` helper

**Files:**
- Modify: `api/src/modules/notifications/notifications.service.ts`
- Test: `api/tests/unit/notifications/notify-ride-payment-failed.test.ts`

A thin wrapper: render the `payment_failed` push template, then hand off to the existing `notifyOwner()` (which persists the in-app feed row + pushes + socket-emits). Lives in `notifications.service.ts` so both failure sites (Tasks 5 and 6, in *other* modules) can `vi.mock` it in their tests.

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/notifications/notify-ride-payment-failed.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: vi.fn() }))
vi.mock('@/modules/notifications/notifications.repository', () => ({
  createInAppNotification: vi.fn(),
  getTokensForOwner: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendNotification: vi.fn() } }))

import { renderTemplate } from '@/modules/notifications/templates.service'
import * as repo from '@/modules/notifications/notifications.repository'
import { notifyRidePaymentFailed } from '@/modules/notifications/notifications.service'

describe('notifyRidePaymentFailed', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the payment_failed push template and persists an in-app feed row', async () => {
    vi.mocked(renderTemplate).mockResolvedValue({ subject: 'Payment failed', body: 'Your ₹500 ride payment didn’t go through. Tap to pay now.' })
    vi.mocked(repo.createInAppNotification).mockResolvedValue({ id: '1' } as never)
    vi.mocked(repo.getTokensForOwner).mockResolvedValue([]) // no tokens → push leg is a no-op

    await notifyRidePaymentFailed(BigInt(42), BigInt(101), 500)

    expect(renderTemplate).toHaveBeenCalledWith('payment_failed', 'push', { amount: '500' })
    expect(repo.createInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'user',
        ownerId: BigInt(42),
        type: 'payment_failed',
        title: 'Payment failed',
        rideId: BigInt(101),
      })
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/unit/notifications/notify-ride-payment-failed.test.ts`
Expected: FAIL — `notifyRidePaymentFailed is not a function` (not yet exported).

- [ ] **Step 3: Add the helper**

At the top of `api/src/modules/notifications/notifications.service.ts`, add this import beside the existing imports:

```typescript
import { renderTemplate } from './templates.service'
```

Then append this function to the end of the file (after `notifyAllAdmins`):

```typescript
// Proactive "your ride payment didn't go through" notification. Renders the
// payment_failed push template and hands off to notifyOwner (in-app feed +
// push + socket). Called from the two ride-payment failure sites:
// reconcilePendingRidePayments (online) and settleRideCompletionPayment (wallet).
export async function notifyRidePaymentFailed(
  userId: bigint,
  rideId: bigint,
  amount: number
): Promise<void> {
  const { subject, body } = await renderTemplate('payment_failed', 'push', {
    amount: String(Math.round(amount)),
  })
  await notifyOwner({
    ownerType: 'user',
    ownerId: userId,
    type: 'payment_failed',
    title: subject ?? 'Payment failed',
    body,
    rideId,
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run tests/unit/notifications/notify-ride-payment-failed.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/notifications/notifications.service.ts api/tests/unit/notifications/notify-ride-payment-failed.test.ts
git commit -m "feat(payments): add notifyRidePaymentFailed helper"
```

---

## Task 3: `retryRidePayment()` service function

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts`
- Test: `api/tests/unit/payments/retry-ride-payment.test.ts`

Resets a `pending`/`failed` ride payment and re-runs its channel's existing flow. **Idempotency:** wallet retries go through the existing `confirmRidePayment` (`WHERE status='pending'` guard); online retries mint a fresh order via the existing `createRidePaymentOrder` and are confirmed by the existing client-verify / webhook / reconcile paths — no new confirmation path is introduced. The reset UPDATE is itself guarded on `status IN ('pending','failed')`; if a concurrent verify/webhook already completed the payment, the reset touches 0 rows and we return the "already settled" success shape rather than clobbering it back to `pending`.

**NOTE for the implementer:** this codebase's Vitest/ESM setup does **not** intercept `vi.spyOn` on same-module sibling exports (e.g. spying on `confirmRidePayment` or `createRidePaymentOrder` from a test of `retryRidePayment` — all in `payments.service.ts`). Assert on the real DB side effects (`pool.query` / `client.query` call contents) instead, exactly as `reconcile-pending.test.ts` and `pay-from-wallet.test.ts` already do.

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/payments/retry-ride-payment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(client)) } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))

const ordersCreate = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: ordersCreate, fetchPayments: vi.fn() }; payments = { fetch: vi.fn() } },
}))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'

// Route pool.query by SQL fragment so tests don't depend on call ordering.
// `payment` is the row returned by the initial `SELECT ... FROM payments`.
function mockPool(payment: Record<string, unknown>) {
  vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
    const sql = text as string
    if (sql.startsWith('SELECT user_id, channel, status, amount')) return { rows: [payment], rowCount: 1 } as never
    if (sql.includes("SET status='pending'")) return { rows: [], rowCount: 1 } as never       // reset UPDATE
    if (sql.includes("SET status = 'completed'")) return { rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 } as never
    if (sql.includes("razorpay_order_id = $2")) return { rows: [], rowCount: 1 } as never       // order id write
    if (sql.includes('system_config')) return { rows: [], rowCount: 0 } as never                // getConfigValue → fallback
    return { rows: [], rowCount: 0 } as never
  })
}

// client.query (pool.connect) drives payFromUserWallet / deductCommission / creditCashback.
function mockClient(balance: string) {
  client.query.mockReset()
  client.query.mockImplementation(async (text: unknown) => {
    const sql = text as string
    if (sql.includes('FROM user_wallets') && sql.includes('FOR UPDATE')) return { rows: [{ id: 5, balance }], rowCount: 1 } as never
    if (sql.includes('FROM driver_wallets') && sql.includes('FOR UPDATE')) return { rows: [{ id: 7, balance: '10000', is_frozen: false }], rowCount: 1 } as never
    if (sql.includes("entry_type = 'ride_debit'")) return { rows: [], rowCount: 0 } as never    // dedupe check
    return { rows: [], rowCount: 0 } as never
  })
}

describe('retryRidePayment', () => {
  beforeEach(() => { vi.clearAllMocks(); ordersCreate.mockResolvedValue({ id: 'order_new' }) })

  it('online → resets the row and mints a fresh Razorpay order', async () => {
    mockPool({ user_id: 42, channel: 'razorpay_online', status: 'failed', amount: '500.00' })
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status='pending'"))).toBe(true)
    expect(ordersCreate).toHaveBeenCalledOnce()
    expect(result).toEqual({ channel: 'online', order: { orderId: 'order_new', key: 'rzp_test', amount: 500 } })
  })

  it('wallet with enough balance → debits, confirms, returns paid:true', async () => {
    mockPool({ user_id: 42, channel: 'platform_wallet', status: 'failed', amount: '500.00' })
    mockClient('1000.00')
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(result).toEqual({ channel: 'wallet', paid: true })
    expect(vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status = 'completed'"))).toBe(true)
  })

  it('wallet still insufficient → returns paid:false, does not confirm', async () => {
    mockPool({ user_id: 42, channel: 'platform_wallet', status: 'failed', amount: '500.00' })
    mockClient('100.00')
    const result = await svc.retryRidePayment(BigInt(101), BigInt(42))
    expect(result).toEqual({ channel: 'wallet', paid: false })
    expect(vi.mocked(pool.query).mock.calls.some(c => (c[0] as string).includes("SET status = 'completed'"))).toBe(false)
  })

  it('rejects a payment owned by a different user', async () => {
    mockPool({ user_id: 99, channel: 'razorpay_online', status: 'failed', amount: '500.00' })
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('rejects a cash-channel payment', async () => {
    mockPool({ user_id: 42, channel: 'cash_direct', status: 'pending', amount: '500.00' })
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects an already-completed payment', async () => {
    mockPool({ user_id: 42, channel: 'razorpay_online', status: 'completed', amount: '500.00' })
    await expect(svc.retryRidePayment(BigInt(101), BigInt(42))).rejects.toMatchObject({ httpStatus: 400 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/retry-ride-payment.test.ts`
Expected: FAIL — `retryRidePayment is not a function`.

- [ ] **Step 3: Add the type and function**

In `api/src/modules/payments/payments.service.ts`, add the exported result type just above `createRidePaymentOrder` (near the other payment exports):

```typescript
// Retry outcome. `online.order` is null in dev (no Razorpay keys — the order
// helper auto-confirms) or when a concurrent path already completed the payment.
export type RetryRidePaymentResult =
  | { channel: 'online'; order: { orderId: string; key: string; amount: number } | null }
  | { channel: 'wallet'; paid: boolean }
```

Then add this function immediately after `verifyRidePayment` (before the `// ── Wallet queries ──` section):

```typescript
// ── Retry a stranded ride payment (rider-initiated) ────────────
// Same-channel retry for a payment stuck 'pending'/'failed'. Resets the row and
// re-runs the channel's EXISTING flow — online: createRidePaymentOrder (fresh
// order, client reopens Checkout, confirmed via verify/webhook/reconcile);
// wallet: payFromUserWallet then confirmRidePayment. No new confirmation path:
// confirmRidePayment's WHERE status='pending' guard stays the single idempotency
// lock. The reset itself is guarded so a payment a concurrent path just
// completed is never dragged back to 'pending'.
export async function retryRidePayment(
  rideId: bigint,
  userId: bigint
): Promise<RetryRidePaymentResult> {
  const payRes = await pool.query(
    `SELECT user_id, channel, status, amount FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment) throw Object.assign(new Error('Payment not found for this ride'), { httpStatus: 404 })
  if (String(payment.user_id) !== userId.toString()) {
    throw Object.assign(new Error('Payment does not belong to this user'), { httpStatus: 403 })
  }

  const retryable = payment.channel === 'razorpay_online' || payment.channel === 'platform_wallet'
  const resettable = payment.status === 'pending' || payment.status === 'failed'
  if (!retryable || !resettable) {
    throw Object.assign(new Error('Payment is not eligible for retry'), { httpStatus: 400 })
  }

  const amount = parseFloat(payment.amount)

  // Guarded reset: 0 rows means a concurrent verify/webhook already completed it.
  const reset = await pool.query(
    `UPDATE payments SET status='pending', failed_at=NULL, failure_reason=NULL
     WHERE ride_id = $1 AND status IN ('pending','failed')`,
    [rideId]
  )
  const alreadySettled = (reset.rowCount ?? 0) === 0

  if (payment.channel === 'razorpay_online') {
    if (alreadySettled) return { channel: 'online', order: null }
    const order = await createRidePaymentOrder(rideId, userId, amount)
    return { channel: 'online', order }
  }

  // platform_wallet
  if (alreadySettled) return { channel: 'wallet', paid: true }
  const paid = await payFromUserWallet(rideId, userId, amount)
  if (paid) await confirmRidePayment(rideId)
  return { channel: 'wallet', paid }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run tests/unit/payments/retry-ride-payment.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/payments/payments.service.ts api/tests/unit/payments/retry-ride-payment.test.ts
git commit -m "feat(payments): add retryRidePayment service function"
```

---

## Task 4: `POST /rides/:id/payment/retry` route

**Files:**
- Modify: `api/src/modules/rides/rides.routes.ts` (after the `/:id/payment/verify` handler, ~line 272)

Mirrors the existing verify route's auth/error-handling shape exactly (`authenticate()`, `req.user!.id`, `next(err)`). Routes have no unit-test infra here (the verify route has none either) — verify with `tsc`.

- [ ] **Step 1: Add the route**

In `api/src/modules/rides/rides.routes.ts`, immediately after the existing `router.post('/:id/payment/verify', ...)` handler, add:

```typescript
router.post('/:id/payment/retry', authenticate(), async (req, res, next) => {
  try {
    const rideId = BigInt(req.params['id']!)
    const result = await paymentsService.retryRidePayment(rideId, req.user!.id)
    res.json(result)
  } catch (err) { next(err) }
})
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors (`paymentsService` is already imported in this file — the verify route uses it).

- [ ] **Step 3: Run the full unit suite to confirm nothing regressed**

Run: `cd api && npx vitest run tests/unit`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/rides/rides.routes.ts
git commit -m "feat(payments): add POST /rides/:id/payment/retry route"
```

---

## Task 5: Notify on the reconciliation-marks-failed path

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts` (`reconcilePendingRidePayments`)
- Test: `api/tests/unit/payments/reconcile-pending.test.ts`

When the sweep marks an online payment `failed` after the grace window, fire `notifyRidePaymentFailed`. The sweep's SELECT gains `user_id` and `amount`; the notify only fires when the guarded `failed` UPDATE actually changed a row (so a payment another path confirmed is never notified as failed).

- [ ] **Step 1: Update the test (add the notify mock + assertion)**

Replace the contents of `api/tests/unit/payments/reconcile-pending.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: 'rzp_test', RAZORPAY_KEY_SECRET: 'secret' } }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyRidePaymentFailed: vi.fn() }))

const fetchPayments = vi.fn()
vi.mock('razorpay', () => ({
  default: class { orders = { create: vi.fn(), fetchPayments }; payments = { fetch: vi.fn() } },
}))

import * as svc from '@/modules/payments/payments.service'
import { pool } from '@/db/client'
import { notifyRidePaymentFailed } from '@/modules/notifications/notifications.service'

// NOTE: vi.spyOn(svc, 'confirmRidePayment') does NOT intercept confirmRidePayment
// being called internally from reconcilePendingRidePayments (both live in the same
// module file). Instead of trusting a spy, we assert on the real side effect: the
// guarded `UPDATE payments SET status = 'completed' ... WHERE status = 'pending'`
// that confirmRidePayment issues via pool.query.
describe('reconcilePendingRidePayments', () => {
  beforeEach(() => vi.clearAllMocks())

  function confirmingUpdateWasIssued(): boolean {
    return vi.mocked(pool.query).mock.calls.some(
      (c) => (c[0] as string).includes("SET status = 'completed'")
    )
  }

  it('captured on recheck → confirms, does not notify failure', async () => {
    vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
      const sql = text as string
      if (sql.includes("WHERE status = 'pending'") && sql.includes('razorpay_order_id IS NOT NULL')) {
        return { rows: [{ ride_id: 101, razorpay_order_id: 'order_1', user_id: 42, amount: '500.00' }], rowCount: 1 } as never
      }
      if (sql.includes("SET status = 'completed'")) {
        return { rows: [{ driver_id: 9, user_id: 42, amount: '500.00' }], rowCount: 1 } as never
      }
      return { rows: [], rowCount: 0 } as never
    })
    fetchPayments.mockResolvedValue({ items: [{ id: 'pay_9', status: 'captured' }] })

    await svc.reconcilePendingRidePayments()

    expect(confirmingUpdateWasIssued()).toBe(true)
    expect(notifyRidePaymentFailed).not.toHaveBeenCalled()
  })

  it('no capture after grace → marks failed and notifies the rider', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ ride_id: 101, razorpay_order_id: 'order_1', user_id: 42, amount: '500.00' }], rowCount: 1 } as never) // select pending
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as never) // UPDATE ... failed (1 row changed)
    fetchPayments.mockResolvedValue({ items: [{ id: 'pay_9', status: 'failed' }] })

    await svc.reconcilePendingRidePayments()

    expect(confirmingUpdateWasIssued()).toBe(false)
    const failUpdate = vi.mocked(pool.query).mock.calls.find(c => (c[0] as string).includes("status = 'failed'"))
    expect(failUpdate).toBeTruthy()
    expect(failUpdate![0] as string).toContain("status = 'pending'") // guarded so a confirmed ride is untouched
    expect(notifyRidePaymentFailed).toHaveBeenCalledWith(BigInt(42), BigInt(101), 500)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/reconcile-pending.test.ts`
Expected: FAIL — the "notifies the rider" assertion fails (`notifyRidePaymentFailed` not called yet).

- [ ] **Step 3: Wire the notify call into the sweep**

In `api/src/modules/payments/payments.service.ts`, add this import beside the other imports at the top:

```typescript
import { notifyRidePaymentFailed } from '@/modules/notifications/notifications.service'
```

In `reconcilePendingRidePayments`, change the SELECT to also fetch `user_id` and `amount`:

```typescript
  const res = await pool.query(
    `SELECT ride_id, razorpay_order_id, user_id, amount
     FROM payments
     WHERE status = 'pending'
       AND razorpay_order_id IS NOT NULL
       AND created_at < now() - interval '10 minutes'`
  )
```

Then replace the `else` branch of the `if (captured)` block with:

```typescript
      } else {
        const upd = await pool.query(
          `UPDATE payments
             SET status = 'failed', failed_at = now(), failure_reason = 'reconciliation_no_capture'
           WHERE ride_id = $1 AND status = 'pending'`,
          [BigInt(row.ride_id)]
        )
        // Only notify if we actually flipped it to failed — a payment another
        // path (verify/webhook) confirmed in the meantime hits 0 rows here.
        if ((upd.rowCount ?? 0) > 0) {
          await notifyRidePaymentFailed(BigInt(row.user_id), BigInt(row.ride_id), parseFloat(row.amount))
        }
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run tests/unit/payments/reconcile-pending.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/payments/payments.service.ts api/tests/unit/payments/reconcile-pending.test.ts
git commit -m "feat(payments): notify rider when reconciliation marks a payment failed"
```

---

## Task 6: Notify on the wallet-insufficient-at-completion path

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` (extract the payment post-processing block from `verifyEndOTP`)
- Test: `api/tests/unit/rides/settle-ride-completion-payment.test.ts`

The wallet-insufficient failure is known synchronously at ride completion (no sweep needed). The existing post-processing lives in a fire-and-forget IIFE inside the huge `verifyEndOTP` — untestable in place. Extract it verbatim into an exported `settleRideCompletionPayment(rideId, driverId)` (behavior-preserving) so the wallet-insufficient notify can be unit-tested, then add the notify call.

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/rides/settle-ride-completion-payment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository', () => ({ getRideById: vi.fn() }))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(),
  createRidePaymentOrder: vi.fn(),
  payFromUserWallet: vi.fn(),
  confirmRidePayment: vi.fn(),
  deductCommission: vi.fn(),
  creditCashback: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyRidePaymentFailed: vi.fn() }))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendRideStatusUpdate: vi.fn(), sendRideDriverAssigned: vi.fn() } }))

import { settleRideCompletionPayment } from '@/modules/rides/rides.service'
import * as repo from '@/modules/rides/rides.repository'
import * as payments from '@/modules/payments/payments.service'
import { notifyRidePaymentFailed } from '@/modules/notifications/notifications.service'
import { pool } from '@/db/client'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(pool.query).mockResolvedValue({ rows: [{ amount: '500' }], rowCount: 1 } as never)
})

describe('settleRideCompletionPayment (wallet channel)', () => {
  it('insufficient wallet balance → notifies the rider', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ user_id: 42n, payment_channel: 'wallet' } as never)
    vi.mocked(payments.payFromUserWallet).mockResolvedValue(false)

    await settleRideCompletionPayment(101n, 9n)

    expect(payments.confirmRidePayment).not.toHaveBeenCalled()
    expect(notifyRidePaymentFailed).toHaveBeenCalledWith(42n, 101n, 500)
  })

  it('sufficient wallet balance → confirms, does not notify', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ user_id: 42n, payment_channel: 'wallet' } as never)
    vi.mocked(payments.payFromUserWallet).mockResolvedValue(true)

    await settleRideCompletionPayment(101n, 9n)

    expect(payments.confirmRidePayment).toHaveBeenCalledWith(101n)
    expect(notifyRidePaymentFailed).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/settle-ride-completion-payment.test.ts`
Expected: FAIL — `settleRideCompletionPayment is not a function`.

- [ ] **Step 3: Extract the function and add the notify call**

In `api/src/modules/rides/rides.service.ts`, add this import beside the existing notification/payment imports at the top:

```typescript
import { notifyRidePaymentFailed } from '@/modules/notifications/notifications.service'
```

In `verifyEndOTP`, replace the existing fire-and-forget block (currently `const rideData = await repo.getRideById(rideId)` down through the closing `})().catch(...)`) with a single call:

```typescript
  // Payment + wallet post-processing (non-blocking — ride is already completed)
  void settleRideCompletionPayment(rideId, driverId).catch((err: unknown) => {
    console.error(`Payment post-processing failed for ride ${rideId}:`, err)
  })
```

Then add this exported function elsewhere in the file (e.g. just above `verifyEndOTP` or at the end of the module). It is the extracted block verbatim, plus the one new `notifyRidePaymentFailed` call in the wallet `!paid` branch:

```typescript
// Extracted from verifyEndOTP so the wallet-insufficient failure path is unit
// testable. Behavior-preserving move of the completion payment post-processing,
// plus a proactive notifyRidePaymentFailed when the wallet debit can't cover the
// fare (payment stays 'pending'; the receipt offers retry).
export async function settleRideCompletionPayment(
  rideId: bigint,
  driverId: bigint
): Promise<void> {
  const rideData = await repo.getRideById(rideId)
  const paymentChannel = rideData?.payment_channel ?? 'cash'

  const fareRow = await pool.query(
    `SELECT COALESCE(total_final, total_estimated) AS amount
     FROM fare_snapshots WHERE ride_id = $1`,
    [rideId]
  )
  const fareAmount = parseFloat(fareRow.rows[0]?.amount ?? '0')

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
    if (paid) {
      await confirmRidePayment(rideId)
    } else {
      // Insufficient balance → payment stays pending. Tell the rider now so they
      // can top up + retry from the receipt (no sweep needed for wallet).
      await notifyRidePaymentFailed(BigInt(rideData.user_id), rideId, fareAmount)
    }
    return
  }

  // cash (default) — capture immediately, commission + cashback now.
  await createPaymentRecord(rideId, 'cash_direct')
  await deductCommission(rideId, driverId)
  if (rideData?.user_id == null || fareAmount <= 0) return
  await creditCashback(rideId, BigInt(rideData.user_id), fareAmount)
}
```

> Implementer note: confirm the imports referenced here (`createPaymentRecord`, `createRidePaymentOrder`, `payFromUserWallet`, `confirmRidePayment`, `deductCommission`, `creditCashback`, `socketEvents`, `repo`, `pool`) are already imported at the top of `rides.service.ts` — they were used by the original inline block, so no new imports beyond `notifyRidePaymentFailed`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/settle-ride-completion-payment.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + full suite**

Run: `cd api && npx tsc --noEmit && npx vitest run tests/unit`
Expected: no type errors; all unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/settle-ride-completion-payment.test.ts
git commit -m "feat(payments): notify rider on wallet-insufficient at ride completion"
```

---

## Task 7: Expose `payment_status` on the ride-detail query

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts` (`getRideById`)
- Modify: `api/src/modules/rides/rides.types.ts` (`Ride` interface)

The receipt banner needs the payment row's status. The *channel* the banner keys on (online vs wallet) is already on the ride row as `rides.payment_channel` ('cash'|'online'|'wallet'), which `r.*` already returns — so only `payments.status` needs adding. A one-column SELECT addition + one `LEFT JOIN` is lower risk than a separate endpoint, and the `GET /rides/:id` route already spreads the whole row to the client.

- [ ] **Step 1: Add `payment_status` to the query**

In `api/src/modules/rides/rides.repository.ts`, in `getRideById`, add the select expression (after the `driver_current_lng` line) and the join. Change:

```typescript
       ST_Y(dls.location::geometry) AS driver_current_lat,
       ST_X(dls.location::geometry) AS driver_current_lng
     FROM rides r
```

to:

```typescript
       ST_Y(dls.location::geometry) AS driver_current_lat,
       ST_X(dls.location::geometry) AS driver_current_lng,
       p.status AS payment_status
     FROM rides r
```

and add this join alongside the other `LEFT JOIN`s (e.g. after the `fare_snapshots` join):

```typescript
     LEFT JOIN payments p          ON p.ride_id = r.id
```

- [ ] **Step 2: Add the field to the `Ride` type**

In `api/src/modules/rides/rides.types.ts`, in the `Ride` interface, add after `driver_current_lng`:

```typescript
  payment_status: string | null
```

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/src/modules/rides/rides.types.ts
git commit -m "feat(payments): expose payment_status on ride detail"
```

---

## Task 8: Extract the shared Razorpay Checkout opener

**Files:**
- Create: `apps/user/lib/razorpay-checkout.ts`
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx`

Move `openRidePaymentCheckout` verbatim out of the live-tracking page into a shared `apps/user/lib` module (second call site coming in Task 10). Add an optional `onVerified` callback so the receipt page can refetch after a successful verify — the existing call site passes nothing and is unchanged.

- [ ] **Step 1: Create the shared module**

```typescript
// apps/user/lib/razorpay-checkout.ts
import { rideApi } from '@/lib/ride-api'

// Opens Razorpay Checkout for an online ride-payment fare and verifies the
// result server-side. Mirrors the driver app's wallet top-up Checkout flow
// (apps/driver/src/pages/Wallet.tsx) — same script id/load pattern.
// onVerified fires after the server confirms the payment (used by callers that
// need to refresh UI, e.g. the receipt page clearing its "Pay now" banner).
export async function openRidePaymentCheckout(
  rideId: string,
  opts: { orderId: string; key: string; amount: number },
  onVerified?: () => void,
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
      onVerified?.()
    },
  })
  rzp.open()
}
```

- [ ] **Step 2: Update the live-tracking page to import it**

In `apps/user/app/(main)/ride/[id]/page.tsx`, delete the entire inline `async function openRidePaymentCheckout(...) { ... }` definition (currently between the `OtpBadge` component and `export default function RidePage`). Add to the imports at the top of the file:

```typescript
import { openRidePaymentCheckout } from '@/lib/razorpay-checkout'
```

The existing call inside `onStatusUpdate` (`void openRidePaymentCheckout(rideId, { orderId, key, amount }).catch(...)`) is unchanged.

- [ ] **Step 3: Typecheck**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `cd apps/user && pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/user/lib/razorpay-checkout.ts "apps/user/app/(main)/ride/[id]/page.tsx"
git commit -m "refactor(user): extract openRidePaymentCheckout to shared lib"
```

---

## Task 9: `retryPayment` API method + `payment_status` on `RideDetail`

**Files:**
- Modify: `apps/user/lib/ride-api.ts`

Mirror `verifyPayment`'s shape for the new `retryPayment`, and surface `payment_status` on `RideDetail` (the ride response already carries `payment_channel` from `rides.payment_channel`, but the type doesn't list it — add both).

- [ ] **Step 1: Add fields to `RideDetail`**

In `apps/user/lib/ride-api.ts`, in the `RideDetail` type, add after `driver_current_lng`:

```typescript
  payment_channel: 'cash' | 'online' | 'wallet'
  payment_status: string | null
```

- [ ] **Step 2: Add the result type and method**

Above the `export const rideApi = {` line, add:

```typescript
export type RetryPaymentResult =
  | { channel: 'online'; order: { orderId: string; key: string; amount: number } | null }
  | { channel: 'wallet'; paid: boolean }
```

Inside the `rideApi` object, after `verifyPayment`, add:

```typescript
  retryPayment: async (rideId: string): Promise<RetryPaymentResult> => {
    const res = await api.post(`/api/v1/rides/${rideId}/payment/retry`)
    return res.data as RetryPaymentResult
  },
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/user/lib/ride-api.ts
git commit -m "feat(user): add retryPayment API + payment fields on RideDetail"
```

---

## Task 10: Receipt-page payment-status banner + "Pay now"

**Files:**
- Modify: `apps/user/app/(main)/ride/[id]/receipt/page.tsx`

Show a banner when `payment_status` is `pending`/`failed` on an `online`/`wallet` channel. "Pay now": online opens Checkout via the shared helper (Task 8) and refetches on verify; wallet retries the debit — success refetches (banner clears), still-insufficient shows an inline message. Uses the page's existing Tailwind design tokens (`bg-status-*`, `text-status-*`, `rounded-2xl`, `bg-primary`).

- [ ] **Step 1: Add imports, state, and the retry handler**

In `apps/user/app/(main)/ride/[id]/receipt/page.tsx`, add to the `lucide-react` import list: `AlertCircle`. Add these imports:

```typescript
import { openRidePaymentCheckout } from '@/lib/razorpay-checkout'
```

Inside `RideReceiptPage`, after the existing `const [loading, setLoading] = useState(true)`, add:

```typescript
  const [retrying, setRetrying] = useState(false)
  const [payMsg, setPayMsg]     = useState<string | null>(null)
```

After the `useEffect` that fetches the ride, add the derived flags and handler (place them before the `if (loading)` early return):

```typescript
  const needsPayment =
    (ride?.payment_status === 'pending' || ride?.payment_status === 'failed') &&
    (ride?.payment_channel === 'online' || ride?.payment_channel === 'wallet')

  async function handleRetryPayment() {
    if (!rideId) return
    setRetrying(true)
    setPayMsg(null)
    try {
      const result = await rideApi.retryPayment(rideId)
      if (result.channel === 'online') {
        if (result.order) {
          await openRidePaymentCheckout(rideId, result.order, () => {
            rideApi.getRide(rideId).then(setRide).catch(() => {})
          })
        } else {
          // dev auto-confirmed (no Razorpay keys) — refresh to clear the banner
          const fresh = await rideApi.getRide(rideId)
          setRide(fresh)
        }
      } else if (result.paid) {
        const fresh = await rideApi.getRide(rideId)
        setRide(fresh)
      } else {
        setPayMsg('Not enough wallet balance. Top up your wallet and try again.')
      }
    } catch {
      setPayMsg('Could not start payment. Please try again.')
    } finally {
      setRetrying(false)
    }
  }
```

- [ ] **Step 2: Render the banner**

In the returned JSX, inside `<div className="flex-1 px-4 pt-4 pb-8 space-y-3">`, immediately after the closing `</motion.div>` of the "Status" block (the block that renders `Trip completed` / `Trip cancelled`), insert:

```tsx
        {needsPayment && (
          <div className="rounded-2xl bg-status-warning/10 p-4">
            <div className="flex items-center gap-3">
              <AlertCircle size={20} className="text-status-warning flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-status-warning">
                  {ride?.payment_status === 'failed' ? 'Payment failed' : 'Payment pending'}
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {ride?.payment_channel === 'wallet'
                    ? 'Your wallet payment for this trip is incomplete.'
                    : 'Your online payment for this trip didn’t go through.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRetryPayment()}
                disabled={retrying}
                className="flex-shrink-0 bg-primary text-white text-xs font-semibold px-4 py-2 rounded-full active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                {retrying ? 'Processing…' : 'Pay now'}
              </button>
            </div>
            {payMsg && <p className="text-xs text-status-error mt-2">{payMsg}</p>}
          </div>
        )}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `cd apps/user && pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add "apps/user/app/(main)/ride/[id]/receipt/page.tsx"
git commit -m "feat(user): payment-status banner + Pay now on trip receipt"
```

---

## Task 11: `payment_failed` notification tap navigates to the receipt

**Files:**
- Modify: `apps/user/app/(main)/notifications/page.tsx`

Currently a row tap only marks read. Add a narrowly-scoped exception: `type === 'payment_failed'` with a `rideId` navigates to `/ride/{rideId}/receipt`. All other types are untouched. Swipe-to-mark-read is unchanged.

- [ ] **Step 1: Add the tap handler and thread it through the row**

In `apps/user/app/(main)/notifications/page.tsx`:

Add `useCallback` to the React import:

```typescript
import { useEffect, useCallback } from 'react'
```

Change the `NotificationRow` signature to accept an `onOpen` callback (keep `onRead` for swipe):

```typescript
function NotificationRow({ item, index, onRead, onOpen }: { item: NotificationItem; index: number; onRead: (id: string) => void; onOpen: (item: NotificationItem) => void }) {
```

Inside `NotificationRow`, change the button's `onClick` from `onClick={() => onRead(item.id)}` to:

```tsx
          onClick={() => onOpen(item)}
```

(The `onDragEnd` handler that calls `onRead(item.id)` stays as-is — swipe still just marks read.)

In `NotificationsPage`, add the handler after the `useNotifications()` destructure:

```typescript
  const handleOpen = useCallback((item: NotificationItem) => {
    void markRead(item.id)
    if (item.type === 'payment_failed' && item.rideId) {
      router.push(`/ride/${item.rideId}/receipt`)
    }
  }, [markRead, router])
```

Update both `<NotificationRow ... />` usages (the `todayItems` map and the `earlierItems` map) to pass `onOpen`:

```tsx
                    <NotificationRow key={item.id} item={item} index={index} onRead={(id) => void markRead(id)} onOpen={handleOpen} />
```

```tsx
                    <NotificationRow key={item.id} item={item} index={todayItems.length + index} onRead={(id) => void markRead(id)} onOpen={handleOpen} />
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `cd apps/user && pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "apps/user/app/(main)/notifications/page.tsx"
git commit -m "feat(user): tap a payment_failed notification to open the receipt"
```

---

## Final verification

- [ ] **Backend:** `cd api && npx vitest run tests/unit` → all pass (was 103; +11 new: 1 notify-helper, 6 retry, 2 settle, and the reconcile test still 2). `cd api && npx tsc --noEmit` → clean.
- [ ] **Frontend:** `cd apps/user && npx tsc --noEmit && pnpm build` → clean.
- [ ] **Manual smoke (dev, no Razorpay keys):** complete a `wallet`-channel ride with an empty user wallet → a `payment_failed` notification appears; open the receipt → "Payment pending" banner with "Pay now"; top up the wallet, tap "Pay now" → banner clears.

---

## Self-Review

**1. Spec coverage**

- §1 Retry endpoint (backend): `retryRidePayment` (Task 3), `POST /rides/:id/payment/retry` (Task 4). Same-channel only; online mints fresh order via `createRidePaymentOrder`, wallet re-attempts `payFromUserWallet` + `confirmRidePayment`; ineligible states throw 400/403/404. ✅
- §2 Proactive notification (backend, two triggers): template migration (Task 1), `notifyRidePaymentFailed` (Task 2), reconciliation trigger (Task 5), wallet-completion trigger (Task 6). ✅
- §3 Surface status + retry (frontend): `payment_status` on the query (Task 7) + `RideDetail` (Task 9); receipt banner + Pay now (Task 10); notification tap → receipt (Task 11). ✅
- §4 Shared Checkout helper: extracted to `apps/user/lib/razorpay-checkout.ts` (Task 8). ✅
- §5 Testing: backend TDD throughout; frontend uses `tsc`/`build` (no FE test infra). ✅

**2. Placeholder scan** — every code step contains complete, real code (SQL, TS, TSX). No "TBD"/"add error handling"/"similar to Task N". ✅

**3. Type consistency** — `retryRidePayment(rideId, userId): Promise<RetryRidePaymentResult>` (backend, Task 3) and `rideApi.retryPayment(rideId): Promise<RetryPaymentResult>` (frontend, Task 9) share the identical discriminated union `{ channel:'online'; order: {orderId,key,amount}|null } | { channel:'wallet'; paid:boolean }`, consumed correctly in Task 10's `handleRetryPayment`. `notifyRidePaymentFailed(userId: bigint, rideId: bigint, amount: number)` is defined in Task 2 and called with that exact signature in Tasks 5 and 6. `payment_status` is added to the `Ride` type (Task 7) and `RideDetail` type (Task 9) and read in Task 10. `openRidePaymentCheckout(rideId, opts, onVerified?)` defined in Task 8 and called with all three args in Task 10, two args in the unchanged live-tracking page. ✅

**4. Idempotency (spec requirement)** — No parallel confirmation path introduced: wallet retry funnels through the existing `confirmRidePayment` (`WHERE status='pending'` guard); online retry relies on the existing verify/webhook/reconcile confirmation. The reset UPDATE is guarded on `status IN ('pending','failed')` so a concurrently-completed payment is never clobbered. ✅
