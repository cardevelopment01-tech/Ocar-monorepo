# Stranded ride-payment recovery — design

Date: 2026-07-18
Status: approved for planning

## Context

The ride-fare online payment feature (see
`2026-07-18-ride-fare-online-payment-design.md` and its implementation plan)
shipped with a known gap, caught during code review of its final task: if an
online payment never completes — Checkout fails to open (ad-blocker, offline,
CSP), or the rider abandons Checkout — the payment row stays `pending` until
the backend reconciliation sweep (`reconcilePendingRidePayments`, 10-minute
grace window) marks it `failed`. Nothing in the app tells the rider this
happened, and there is no way to retry from the UI. The same root gap exists
on the `wallet` channel: if `payFromUserWallet` returns `false` (insufficient
balance) at ride completion, the payment likewise sits `pending` forever with
no retry path — this wasn't explicitly flagged in the prior review but is the
identical failure shape.

This spec covers closing that gap: proactively notify the rider, surface
payment status on the trip receipt, and let them retry.

## Decisions

- **Scope**: both `online` and `wallet` channels (same fix shape, same root
  cause — cash never enters this state).
- **Notification**: proactive, via the existing `notifyOwner()` /
  `notification_templates` infra (same pattern already used for
  `ride_accepted`/`ride_completed`) — not just passive status-on-receipt.
- **Retry flexibility**: same-channel retry only. Online retries with a fresh
  Razorpay order; wallet retries the debit (useful after a top-up). No
  channel-switching UI on retry — that's a separate, larger feature.

## Design

### 1. Retry endpoint (backend)

`retryRidePayment(rideId: bigint, userId: bigint)` in
`api/src/modules/payments/payments.service.ts`, exposed as
`POST /rides/:id/payment/verify`'s sibling: `POST /rides/:id/payment/retry`
(authenticated, ride-ownership checked — `payments.user_id === userId` or via
the ride row, same pattern Task 8's verify endpoint uses).

Only acts when the ride's payment is `status IN ('pending','failed')` AND
`channel IN ('razorpay_online','platform_wallet')` — any other state
(`completed`, or `channel='cash_direct'`) is a 400.

- **online**: reset the payment row (`status='pending'`, clear `failed_at`/
  `failure_reason`), then call the existing `createRidePaymentOrder` (Task 6)
  to mint a fresh order (this already overwrites `razorpay_order_id` and
  rebinds the Redis order→user key). Returns `{orderId, key, amount}` for the
  client to reopen Checkout — same shape the completion-hook socket event
  already provides, so the frontend reuses the same open-and-verify flow.
- **wallet**: reset the payment row the same way, then re-attempt
  `payFromUserWallet` (Task 5). If it now succeeds (balance topped up since),
  immediately call `confirmRidePayment`. If still insufficient, return a
  plain "still insufficient" result — no error, this is an expected outcome
  the frontend shows as a message, not a failure state.

### 2. Proactive notification (backend)

New `notification_templates` row (migration mirroring
`036_notification_templates.sql`'s pattern): slug `payment_failed`, channels
`in_app` + `push`, body referencing `{{amount}}` and the ride. Sent via the
existing `notifyOwner()` (same call shape as `ride_completed`), with
`rideId` in the payload so the notification can deep-link.

Two trigger points, both already-existing code paths gaining one new call:

- `reconcilePendingRidePayments` (Task 10): when it marks an online payment
  `failed` after the grace window, call `notifyOwner()`.
- The wallet branch of the ride-completion hook (Task 7, `rides.service.ts`):
  when `payFromUserWallet` returns `false`, call `notifyOwner()` immediately
  — this failure is already known synchronously, no sweep needed for wallet.

### 3. Surfacing status + retry (frontend)

`apps/user/app/(main)/ride/[id]/receipt/page.tsx` — already the rider's
post-trip detail page, already shows the fare breakdown — gains:

- A payment-status banner, shown only when `payment_status` is
  `pending`/`failed` on `online`/`wallet` channel ("Payment pending — Pay
  now" / "Payment failed — Pay now"), backed by a small addition to
  whatever query currently backs this page (add `payments.status` +
  `payments.channel` to the response).
- A "Pay now" button calling `rideApi.retryPayment(rideId)` (new method,
  mirrors `verifyPayment`'s shape). For `online`, the response's
  `{orderId, key, amount}` opens Checkout via the shared helper (see §4)
  and on success calls `rideApi.verifyPayment` exactly like the live-tracking
  flow. For `wallet`, the response is shown as a toast/inline message
  (success → banner clears; still-insufficient → "top up your wallet and try
  again").

Notification tap navigation: `apps/user/lib/notifications-context.tsx` /
`notifications/page.tsx` currently do not navigate anywhere on tap for *any*
notification type (confirmed: tap only marks read). Add a narrowly-scoped
exception: when a notification's `type === 'payment_failed'` and its payload
carries a `rideId`, tapping navigates to `/ride/{rideId}/receipt`. Other
notification types are untouched — this is not a general tap-to-navigate
rework.

### 4. Shared Checkout helper (refactor, in scope for this fix)

`openRidePaymentCheckout` currently lives only in
`apps/user/app/(main)/ride/[id]/page.tsx` (added in the prior plan's Task
12). Extract it to `apps/user/lib/razorpay-checkout.ts` so the receipt
page's retry button can reuse it — this is now a second call site *within
`apps/user`*, which is the threshold a prior code review explicitly flagged
as reasonable to cross ("defer until a third caller" — for `apps/user` this
is the second, but for the whole payments feature it's the third overall
counting the driver app's copy). The separate `apps/driver` Checkout
integration (`Wallet.tsx`) is a different app with no shared runtime package
per CLAUDE.md (`packages/` is "shared config only") — not touched here.

### 5. Testing

Per this repo's convention (backend has Vitest infra, `apps/user` does not):

- `retryRidePayment`: unit tests for both channels — online resets +
  re-creates order; wallet resets + re-attempts debit, both success and
  still-insufficient outcomes; rejects when payment/ride state doesn't
  qualify (already completed, wrong owner, cash channel).
- `notifyOwner()` call sites: unit tests confirming the two new trigger
  points (reconciliation-marks-failed, wallet-insufficient-at-completion)
  actually call it with the right `rideId`/type.
- Frontend (no test infra): `tsc`/build verification + manual/static code
  review, same as the prior plan's frontend tasks.

## Out of scope

- Letting the rider switch payment method on retry.
- A dedicated "payment center" / cross-ride payment-issues list — this fix
  is scoped to the single-ride receipt page.
- Cash-channel handling — cash never enters a `pending`/`failed` state in
  this flow.
