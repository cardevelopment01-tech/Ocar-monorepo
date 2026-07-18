# Ride-fare online payment (checkout) — design

Date: 2026-07-18
Status: approved for planning

## Context

CLAUDE.md marks M08 Payments as "done" (Razorpay webhook, wallet, commission). The
actual code doesn't match:

- `payments.controller.ts`, `payments.repository.ts`, `payments.types.ts`, and all
  three submodules (`razorpay/`, `settlements/`, `wallet/`) are empty TODO stubs.
  Real logic lives directly in `payments.service.ts` / `payments.routes.ts`.
- The Razorpay webhook handler (`payments.service.ts:322-348`) only logs events —
  it never updates payment status, explicitly commented "Phase 2 stub".
- Every ride is unconditionally recorded as `channel = 'cash_direct'` at
  completion (`rides.service.ts:1176`) — there is no online payment path for ride
  fares at all. The only working Razorpay flow end-to-end today is driver wallet
  top-up.
- `refunds` and `settlements` tables exist with no code using them — out of scope
  for this spec (separate future specs).
- `user_wallets` currently only receives cashback; it cannot pay for a ride yet
  (migration comment: "Phase 2: allow balance to pay for rides").

This spec covers **ride-fare checkout only**: letting a rider pay for a completed
ride via cash, Razorpay online (UPI/card), or wallet balance, reliably.

## Decisions

- **Payment methods**: cash (unchanged default) + Razorpay online + user wallet.
  Rider picks at booking time.
- **Charge timing**: at ride completion, once `fare_snapshots` has the final
  amount — not a pre-auth-at-booking flow. Mirrors the current cash-settlement
  timing; avoids building a hold/capture/adjustment state machine.
- **Failure handling**: a failed/timed-out online charge does not block ride
  completion. The ride stays `completed`; the payment sits `pending`/`failed` and
  the app offers retry (online, wallet, or cash) later. No hard booking
  restriction in this phase.
- **Confirmation architecture**: client-driven verify (mirrors the existing,
  working wallet top-up pattern) is the primary path. The webhook becomes a real
  backstop instead of a no-op logger. A reconciliation sweep job covers the case
  where the app is killed before the client can call verify. Sources: Razorpay's
  own webhook guidance says event order isn't guaranteed and updates must be
  idempotent and status-guarded
  (https://razorpay.com/docs/webhooks/best-practices/); ride-hailing systems
  generally treat webhooks as an async backstop rather than the sole trigger,
  since the app is very likely to be backgrounded or closed right at trip end
  (https://developer.uber.com/docs/riders/guides/webhooks).

## Design

### 1. Payment channel selection

Add `payment_channel: 'cash' | 'online' | 'wallet'` to the ride booking request,
stored on `rides` (default `'cash'`, matches current behavior with zero
migration risk for existing rows). `apps/user/app/(main)/payment-methods/page.tsx`
becomes a real selector (today it's a static "Cash only, rest coming soon" list)
feeding this into the booking payload.

### 2. Ride-completion hook

`rides.service.ts:1176` currently calls:

```ts
void createPaymentRecord(rideId, 'cash_direct')
  .then(() => deductCommission(rideId, driverId))
  .then(async () => { /* cashback */ })
```

unconditionally. This branches on `ride.payment_channel`:

- **`cash`** — unchanged. `createPaymentRecord` inserts `status='completed'`,
  commission + cashback run immediately, exactly as today.
- **`online`** — `createPaymentRecord` inserts the payment row as
  `status='pending'`, `channel='razorpay_online'`, no `captured_at`. Commission
  deduction and cashback move to *after* confirmation — running them against an
  uncollected fare would debit driver commission for money that was never
  actually paid. A Razorpay order is created server-side for the final fare
  amount; the completion socket event carries `order_id` so the app can open
  Checkout immediately.
- **`wallet`** — no Razorpay order. Atomic debit from `user_wallets` at
  completion (same `FOR UPDATE` locking pattern as `deductCommission`).
  Insufficient balance → falls back to `pending`, same retry UX as a failed
  online charge.

### 3. Confirmation — client verify (primary path)

New endpoint, same shape as the existing wallet-topup verify
(`payments.routes.ts:60-102`):

```
POST /api/v1/rides/:id/payment/verify
body: { razorpay_payment_id, razorpay_order_id, razorpay_signature }
```

Server verifies the HMAC-SHA256 signature, re-fetches the payment from Razorpay
(`rzp.payments.fetch`) to confirm `status === 'captured'` and the amount matches
`payments.amount` — client-supplied amount is never trusted, same as the
existing pattern. On success, in one transaction: `payments.status='completed'`,
`captured_at=now()`, then run `deductCommission` + `creditCashback` (reusing the
existing functions unchanged).

### 4. Confirmation — webhook (backstop)

`handleWebhookEvent` (`payments.service.ts:322-348`) currently only logs. Extend
it to act on `payment.captured` events: look up the `payments` row by
`razorpay_order_id`, and transition `pending → completed` **only if currently
pending** (compare-before-write — Razorpay doesn't guarantee event order, so a
stale/duplicate event must not overwrite an already-completed payment), running
the same commission/cashback step. Already-`completed` is a no-op. Duplicate
delivery is already deduped via the `razorpay_event_id` unique constraint on
`payment_gateway_events`.

### 5. Reconciliation sweep

New BullMQ repeatable job (existing queue infra, `api/src/jobs/queues/index.ts`),
running every few minutes: select `payments` rows `status='pending'` with
`razorpay_order_id` set and `created_at` older than ~10 minutes. For each, call
`rzp.orders.fetch` / `rzp.payments.fetch`:

- Captured payment found → run the same confirm-transaction as #3/#4.
- Order expired / no captured payment → `payments.status='failed'`,
  `failure_reason` set. Ride stays completed; app shows a "pay now" retry
  affordance (online, wallet, or cash).

### 6. Testing

One `test_*`-style check per non-trivial branch (per this repo's convention —
no framework, no fixtures beyond what's needed):

- Channel branch in the completion flow: cash / online / wallet each produce
  the correct `payments` row state and correctly defer or not defer
  commission+cashback.
- Webhook idempotency: duplicate event is a no-op; a stale event can't
  overwrite an already-`completed` payment.
- Reconciliation sweep: captured-on-recheck branch confirms correctly;
  expired/uncaptured branch marks `failed` without touching a ride that's
  already been confirmed by another path.

## Out of scope (future specs)

- Refunds (cancellation, dispute-driven) — `refunds` table exists, no code.
- Driver settlements/payouts — `settlements` table exists, no code, no Razorpay
  Route/X integration.
- Pre-auth-at-booking / fare-estimate holds.
- Restricting future bookings on unpaid dues (policy decision, not required for
  this phase).
