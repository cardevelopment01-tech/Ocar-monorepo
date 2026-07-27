# Ride Completion + Payment Flow — Code Map (for cash-collection feature)

Source: codebase exploration, 2026-07-27. File:line refs valid as of commit 1310931.

## Completion (backend)
- `POST /rides/:id/end-otp` → `rides.routes.ts:245` → `service.verifyEndOTP(...)` `rides.service.ts:~1075`.
- verifyEndOTP: guard `in_progress`, verify end OTP, `updateRideStatus('completed')`, finalize `fare_snapshots`, free session, emit socket, enqueue `ride_completed`, then **non-blocking** `void settleRideCompletionPayment(rideId, driverId)` (`rides.service.ts:1269`).
- Status enum `002_enums.sql:62`; `payment_status` enum `002_enums.sql:87` already has `disputed`.

## Payment method + cash divergence
- `rides.payment_channel VARCHAR(10) DEFAULT 'cash' CHECK IN ('cash','online','wallet')` — migration `047_ride_payment_channel.sql:4`. (No `payment_method` column; this is the name.)
- `settleRideCompletionPayment` `rides.service.ts:1280-1331` branches on `payment_channel`:
  - online → pending payment + Razorpay order.
  - wallet → pending payment + `payFromUserWallet` → confirm/notify.
  - **cash (default) `:1326` → `createPaymentRecord('cash_direct')` (status completed) + `deductCommission` + `creditCashback` — immediately, no driver confirmation.** ← the seam we move.
- `payments` one row per ride (`ride_id UNIQUE`), `008_m6_payments.sql:7`.

## Wallet / commission
- `driver_wallets` (`011_wallet.sql:8`) — `balance CHECK (>= 0)` ← drop this. `driver_wallet_ledger` (`:28`) immutable.
- `payments.service.ts`: `getCommissionPercent()` (config `commission_percent` default 15), `createPaymentRecord` `:29` (computes commission/driver_earning, ON CONFLICT ride_id DO NOTHING), `deductCommission` `:74` (locks wallet FOR UPDATE, **floors newBalance at 0** `:114-117` ← remove floor), `creditCashback` `:166`.
- **No "driver owes"/dues/negative concept exists** — this feature adds it.
- `getConfigValue(key, default)` from `@/lib/system-config`.

## Go-online gate (= dues gate)
- `goOnline` `rides.service.ts:110`; at `:123-130` reads `getMinWalletBalance()` (config `driver_minimum_balance` default 500) and throws `LOW_WALLET_BALANCE` if `balance < minBalance`. **Once balance is signed, a driver who owes is below the floor and already blocked here.**

## Driver app
- In-progress: `apps/driver/src/pages/ActiveRide/TripInProgress.tsx` — "Complete Trip" → end-OTP sheet; `OtpVerifyPanel` `onVerified` `:756` navigates `/ride/end`. ← branch here for cash.
- Post-completion: `TripEnd.tsx` `:16` (route `/ride/end`). **Hardcodes 20% commission `:24`** (backend default 15%) — fix.
- Reusable `SwipeToConfirm.tsx` — `default export`, props `{ label, onConfirm, disabled, color }`, threshold 0.7, auto-reset 1800ms. Already used in TripInProgress for stop-advance.
- API client `apps/driver/src/lib/ride-api.ts` — `RideDetail` type `:26-46` (**no `payment_channel`** — add), `driverRideApi` `:79`, `verifyEndOtp` `:143`. No collect-cash method.
- Store `apps/driver/src/store/useRideStore.ts` — `ActiveRide` `:15-33` (**no paymentChannel** — add). Persist key `ocar_driver_ride`.

## User app
- Payment selection real (localStorage `ocar_payment_channel`): `apps/user/lib/payment-channel.ts`, `apps/user/app/(main)/payment-methods/page.tsx`. Cash is a real channel, informational post-ride.

## Gaps this feature closes
1. Cash auto-settles with zero driver ack. 2. No dues/negative-balance model. 3. Driver app never receives `payment_channel`. 4. `SwipeToConfirm` ready to reuse. 5. TripEnd hardcoded 20% vs config 15%.
