# City-Configurable Driver Billing Mode: Package vs Commission

*2026-08-05*

## Problem

Today every ride, in every city, uses the same flat per-ride commission model:
`deductCommission()` debits `commission_percent` (global `system_config`, currently
15%) from `driver_wallets.balance` on ride settlement, and `goOnline()` blocks a
driver whose wallet balance is below `driver_minimum_balance`.

The client wants to introduce a second billing model — a **prepaid ride-value
package** (modeled on Rapido's captain recharge system) — and run it **per city**,
alongside the existing commission model in other cities. Example: Bhubaneswar
drivers buy packages (₹39 → ₹1,000 of ride-acceptance value, ₹500 → ₹10,000, etc.);
Paradeep drivers stay on the existing flat commission cut. Both models must be able
to run simultaneously across different cities without touching each other's code
paths.

## How the package model works (mechanic, confirmed via research — see
`docs/architecture/` chat history for sourcing)

A driver buys a package: pay a fixed price, receive a **ride-acceptance
threshold** — a cap on the *cumulative fare value* of rides they can accept.
Every ride they complete consumes threshold value equal to that ride's final
fare. Once the threshold is used up (balance ≤ 0), the driver **stops receiving
new ride offers** until they buy another package. Multiple purchases stack
(additive), never expire, and larger packages buy a better ₹-per-₹ ratio (e.g.
₹500→₹10,000 is a better rate than ₹39→₹1,000).

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Depletion behavior | Block **new ride acceptance** only — driver stays online/visible, just isn't offered new rides. Current ride (if any) completes normally. |
| Granularity | Per **city** only, applies to all vehicle categories in that city. No per-category override in v1. |
| Purchase flow | Real Razorpay checkout in the driver app — not an admin-only stub. |
| Package tiers | Admin-configurable catalog (like `rate_cards`), not hardcoded. |
| Top-up behavior | Additive — remaining balance + newly purchased threshold. |
| Expiry | Never expires. No cron, no forfeiture logic. |
| City resolution for a ride | Driver's own live GPS at ride-match time (nearest `cities.centroid`), **not** the ride's pickup point and **not** a static driver "home city." |
| Admin scope | Full: city billing-mode toggle, tier CRUD, per-driver balance + ledger history view, manual balance adjustment tool, revenue reporting. |
| Manual override | Yes — admin can adjust a driver's package balance with a required reason, audited via ledger. |

## Why not reuse `driver_wallets`?

`driver_wallets.balance` has a DB-level `CHECK (balance >= 0)` and is documented
as a "compliance deposit account" — commission is a small % debited per ride and
the driver must keep topping it up to *stay above* a floor. The package model is
structurally different: it can legitimately go **negative** the moment a ride's
final fare exceeds the driver's remaining balance (e.g. balance ₹50, ride settles
at ₹80 → balance ends at -₹30; the driver simply doesn't get offered a next ride
until they recharge). Reusing the wallet table means either relaxing a
money-critical constraint on a table already live in production for a different
purpose, or special-casing it per row — both riskier than a second, small,
purpose-built table that mirrors the existing `driver_wallets` /
`driver_wallet_ledger` shape.

## Data model

New migration `078_city_billing_mode.sql` (next free number as of 2026-08-05 —
confirm at implementation time):

```sql
CREATE TYPE city_billing_mode AS ENUM ('commission', 'package');

ALTER TABLE cities
  ADD COLUMN billing_mode city_billing_mode NOT NULL DEFAULT 'commission';

CREATE TABLE package_tiers (
  id             BIGSERIAL PRIMARY KEY,
  label          VARCHAR(100) NOT NULL,
  price          NUMERIC(10,2) NOT NULL CHECK (price > 0),
  threshold_value NUMERIC(10,2) NOT NULL CHECK (threshold_value > 0),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_by     BIGINT REFERENCES admins(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE driver_package_wallets (
  id               BIGSERIAL PRIMARY KEY,
  driver_id        BIGINT NOT NULL UNIQUE REFERENCES drivers(id),
  balance          NUMERIC(12,2) NOT NULL DEFAULT 0,  -- can go negative, see above
  is_frozen        BOOLEAN NOT NULL DEFAULT false,
  frozen_reason    TEXT,
  lifetime_topup   NUMERIC(14,2) NOT NULL DEFAULT 0,
  lifetime_consumed NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE driver_package_ledger_entry_type AS ENUM
  ('topup', 'ride_consumption', 'admin_adjustment');

CREATE TABLE driver_package_ledger (
  id           BIGSERIAL PRIMARY KEY,
  wallet_id    BIGINT NOT NULL REFERENCES driver_package_wallets(id),
  driver_id    BIGINT NOT NULL REFERENCES drivers(id),
  entry_type   driver_package_ledger_entry_type NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,
  direction    VARCHAR(6) NOT NULL CHECK (direction IN ('credit','debit')),
  balance_after NUMERIC(12,2) NOT NULL,
  ride_id      BIGINT REFERENCES rides(id),
  reference_id VARCHAR(100),  -- razorpay order/payment id for topups
  note         TEXT,
  created_by   BIGINT REFERENCES admins(id),  -- set only for admin_adjustment
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE rides
  ADD COLUMN billing_mode_snapshot city_billing_mode;  -- NULL until assignment; see below
```

`rides.billing_mode_snapshot` freezes the mode at ride assignment time (same
principle `fare_snapshots` already applies to rate cards) so a mid-shift city
toggle by an admin can't retroactively change how an in-flight ride settles.

## Billing-mode resolution and broadcast integration

Ride matching (`rides.repository.ts`: `findNearbyDrivers`, `findReturnCabDrivers`)
already narrows candidates via `ST_DWithin`. Add a `LATERAL` join per candidate to
find their nearest `cities.centroid` and read that city's `billing_mode`, then
branch the eligibility filter:

- `commission` → existing wallet balance / frozen check, unchanged.
- `package` → `driver_package_wallets.balance > 0` and not frozen.

When a ride is assigned, write the resolved `billing_mode` onto
`rides.billing_mode_snapshot`.

`goOnline()` is **not** touched for package-mode drivers — per the depletion
decision above, a package-mode driver can go online with zero balance; they just
won't be offered rides until they recharge. The existing wallet-balance gate in
`goOnline()` continues to apply only to commission-mode drivers (resolved the same
nearest-city way, at go-online time).

## Ride settlement

`payments.service.ts` / `rides.service.ts collectCash()` branch on
`rides.billing_mode_snapshot`:

- `commission` → today's `deductCommission()`, completely unchanged.
- `package` → new `consumePackageBalance(rideId, driverId, finalFare)`: debits the
  ride's full final fare (not a %) from `driver_package_wallets.balance`, writes a
  `ride_consumption` ledger row. No `payments.commission_amount` / `driver_wallets`
  involvement at all for these rides.

## Purchase flow

Driver app gets a "Recharge" screen listing active `package_tiers`. Selecting a
tier creates a Razorpay order; on the `payment.captured` webhook, credit
`driver_package_wallets.balance` by `threshold_value`, write a `topup` ledger
entry with `reference_id` = the Razorpay payment id. Whether this reuses the
existing `razorpay_orders` table (adding an order-type discriminator column) or
needs a small sibling table is an implementation detail to confirm against the
current schema during planning — not a design fork either way behaves the same
from the ledger's perspective.

## Admin surface

- **Cities page**: `billing_mode` dropdown per city (same pattern as the existing
  `is_rental_enabled` toggle).
- **Package Tiers**: new tab (on the existing Pricing page or a new one) — CRUD
  the tier catalog, `is_active` toggle instead of hard delete.
- **Driver detail page**: package balance + ledger history section; **Adjust
  Balance** action (signed amount + required reason) that writes an
  `admin_adjustment` ledger entry and updates the wallet, audited via
  `created_by`.
- **Analytics**: package top-up revenue reported alongside existing commission
  revenue — extends existing analytics queries rather than a new dashboard.

## Testing

Money-path logic, so tests are not optional (per project security rules and the
karpathy goal-driven-execution guideline):

- Unit tests: `consumePackageBalance` ledger math (including the negative-balance
  overrun case), topup credit, admin adjustment — balance/ledger consistency in
  all three.
- Broadcast eligibility test: a package-mode driver with balance ≤ 0 is excluded
  from `findNearbyDrivers` results; a commission-mode driver's existing behavior
  is unaffected by the new join.
- Webhook test: `payment.captured` for a package order credits the correct
  wallet and tier amount exactly once (idempotency — mirrors however the existing
  Razorpay wallet-topup webhook already guards against double-processing).

## Explicitly out of scope for v1

- Per-vehicle-category billing mode within a city.
- Package expiry / time-boxed thresholds.
- Automatic mode-switch mid-ride if a city's billing_mode changes (frozen via the
  snapshot column instead).
- Refunds for purchased-but-unused package balance.
