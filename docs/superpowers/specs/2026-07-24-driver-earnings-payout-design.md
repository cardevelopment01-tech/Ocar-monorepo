# Driver earnings & payout — design

Date: 2026-07-24
Status: approved for planning

## Context

M08 Payments (as built) covers only the driver-owes-platform side:
`driver_wallets` is a compliance deposit account — driver tops it up via
Razorpay, `deductCommission` debits ride commission from it after every ride,
and the driver must stay above `driver_minimum_balance` to receive rides
(`payments.service.ts`, `011_wallet.sql`).

There is no platform-owes-driver side. `payments.driver_earning` (fare minus
commission) is already computed and stored per ride
(`createPaymentRecord`, `payments.service.ts:35-76`), but:

- For **cash rides** (`channel='cash_direct'`) this is informational only —
  the driver already physically holds the fare.
- For **online/wallet rides** (`channel='razorpay_online'` /
  `'platform_wallet'`) the platform collected the money via Razorpay or the
  rider's `user_wallets` balance, and currently just... keeps it. There is no
  ledger of what's owed, no payout mechanism, and no path for that money to
  reach the driver's bank account.

`settlements.service.ts` and `wallet.service.ts` (payments submodules) are
still empty TODO stubs — this spec is what fills the settlements one.

Research into how Uber/Ola/Lyft/Rapido architect this (industry-knowledge
synthesis, not sourced from this repo) converged on one core principle: run
**two separate ledgers** (driver-owes-platform vs platform-owes-driver),
reconciled only at payout time — never one net balance. Mixing them breaks
tax treatment (commission GST vs fare TDS are different obligations) and
makes reconciliation against the payment gateway unreliable. This spec keeps
`driver_wallets` exactly as-is and adds the missing other half.

## Decisions

- **Scope**: full pipeline — accrual ledger, scheduled + instant payout,
  RazorpayX Payouts (or equivalent) disbursal to driver bank accounts, and
  Indian tax compliance (TDS u/s 194-O, GST-on-commission tracking) from the
  start. Not deferred to a later pass — retrofitting tax fields onto
  already-paid-out money is worse than building it in now.
- **Only online/wallet-channel rides accrue an earnings line.** Cash rides
  never enter this ledger — the driver already has the cash; only the
  existing commission-recovery flow applies to them.
- **Payout cadence**: daily scheduled auto-batch, plus driver-initiated
  instant cash-out (small flat fee) — matches Uber Instant Pay / Rapido /
  inDrive patterns and is a real driver-retention lever, not just
  scheduled-only.
- **Settlement hold**: `T+1` (configurable) between a ride's earning line
  going `pending` and becoming `cleared`/payable, mirroring Razorpay's own
  settlement lag to the platform and covering the short refund/dispute
  window.
- **`driver_wallets` is untouched.** No coupling between commission recovery
  and payout eligibility — a driver with a low compliance wallet balance can
  still receive their earnings payout; the two are netted only via an
  explicit `compliance_recovery` adjustment line if ever needed, never a
  silent cross-ledger transfer.

## Design

### 1. Data model

New tables (`api/src/db/migrations/037_driver_earnings_payouts.sql`), enums
added to `002_enums.sql`-style pattern (new migration, since `002` is already
applied):

```sql
-- Append-only ledger. One row per financial event. Never UPDATE amount/type;
-- status transitions and payout linkage are the only mutable fields.
CREATE TABLE driver_earnings (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id       BIGINT NOT NULL REFERENCES drivers(id),
  ride_id         BIGINT NULL REFERENCES rides(id),
  payment_id      BIGINT NULL REFERENCES payments(id),
  entry_type      driver_earning_entry_type NOT NULL,
  -- signed: credits positive, deductions negative
  amount          NUMERIC(12,2) NOT NULL,
  status          driver_earning_status NOT NULL DEFAULT 'pending',
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  payout_id       BIGINT NULL REFERENCES payouts(id),
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  note            TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_earnings_driver_status_idx
  ON driver_earnings (driver_id, status);
CREATE INDEX driver_earnings_payout_idx
  ON driver_earnings (payout_id) WHERE payout_id IS NOT NULL;

CREATE TABLE driver_bank_accounts (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id              BIGINT NOT NULL REFERENCES drivers(id),
  account_holder_name    VARCHAR(120) NOT NULL,
  account_number_enc     TEXT NOT NULL,
  ifsc                   VARCHAR(11) NOT NULL,
  upi_vpa                VARCHAR(80) NULL,
  gateway_fund_account_id VARCHAR(80) NULL,
  status                 bank_account_status NOT NULL DEFAULT 'pending_verification',
  is_primary             BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX driver_bank_accounts_primary_idx
  ON driver_bank_accounts (driver_id) WHERE is_primary;

CREATE TABLE payout_batches (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_type     payout_run_type NOT NULL, -- 'scheduled' | 'instant'
  status       payout_batch_status NOT NULL DEFAULT 'draft',
  cutoff_at    TIMESTAMPTZ NOT NULL,
  created_by   BIGINT NULL REFERENCES admins(id),
  approved_by  BIGINT NULL REFERENCES admins(id),
  approved_at  TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id         BIGINT NOT NULL REFERENCES payout_batches(id),
  driver_id        BIGINT NOT NULL REFERENCES drivers(id),
  bank_account_id  BIGINT NOT NULL REFERENCES driver_bank_accounts(id),
  amount           NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  fee              NUMERIC(12,2) NOT NULL DEFAULT 0,
  mode             payout_mode NULL, -- IMPS/UPI/NEFT, set once gateway assigns it
  gateway_payout_id VARCHAR(80) NULL,
  utr              VARCHAR(40) NULL,
  status           payout_status NOT NULL DEFAULT 'queued',
  failure_reason   TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payouts_batch_driver_idx ON payouts (batch_id, driver_id);

CREATE TABLE driver_payout_holds (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id  BIGINT NOT NULL REFERENCES drivers(id),
  reason     TEXT NOT NULL,
  placed_by  BIGINT NOT NULL REFERENCES admins(id),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX driver_payout_holds_active_idx
  ON driver_payout_holds (driver_id) WHERE active;

CREATE TABLE tax_deductions (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id        BIGINT NOT NULL REFERENCES drivers(id),
  ride_id          BIGINT NULL REFERENCES rides(id),
  payout_id        BIGINT NULL REFERENCES payouts(id),
  section          VARCHAR(20) NOT NULL DEFAULT '194O',
  taxable_base     NUMERIC(12,2) NOT NULL,
  rate_pct         NUMERIC(5,2) NOT NULL,
  tds_amount       NUMERIC(12,2) NOT NULL,
  pan_at_deduction VARCHAR(10) NULL,
  fy               VARCHAR(9) NOT NULL,  -- '2026-2027'
  quarter          SMALLINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE driver_tax_profile (
  driver_id     BIGINT PRIMARY KEY REFERENCES drivers(id),
  pan_enc       TEXT NULL,
  pan_verified  BOOLEAN NOT NULL DEFAULT false,
  gstin         VARCHAR(15) NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Enums: `driver_earning_entry_type` (`ride_fare_net`, `tip`, `incentive`,
`cancellation_fee`, `adjustment`, `tds_deduction`, `compliance_recovery`),
`driver_earning_status` (`pending`, `cleared`, `on_hold`, `in_payout`,
`paid`, `reversed`, `clawed_back`), `bank_account_status`
(`pending_verification`, `verified`, `invalid`), `payout_run_type`
(`scheduled`, `instant`), `payout_batch_status` (`draft`, `approved`,
`processing`, `completed`, `failed`), `payout_mode` (`IMPS`, `UPI`, `NEFT`),
`payout_status` (`queued`, `processing`, `processed`, `failed`, `reversed`).

`FOR UPDATE` locking, transactional balance math, and idempotency-via-unique-
constraint follow the exact pattern already used in `deductCommission` /
`topUpDriverWallet` — no new concurrency primitive introduced.

### 2. Accrual

New function `accrueDriverEarning(rideId, driverId)`, called from
`confirmRidePayment` (`payments.service.ts:238-263`) right after
`deductCommission`, only when `payments.channel IN ('razorpay_online',
'platform_wallet')`:

- Insert `driver_earnings` row: `entry_type='ride_fare_net'`,
  `amount = payments.driver_earning`, `status='pending'`,
  `available_at = now() + payout_hold_hours` (new `system_config` key,
  default `24`), `idempotency_key = 'ride_fare_net:ride:' || rideId`.
- Compute TDS (194-O, rate from `driver_tax_profile.pan_verified` — 1% with
  PAN, 5%/20% without per current law, read from `system_config` so it's
  adjustable without a deploy) against the **gross fare**, insert a paired
  negative `tds_deduction` earning line plus a `tax_deductions` row in the
  same transaction.
- Cash rides: no earnings line. `deductCommission` already ran unchanged.

### 3. Clearing

New BullMQ repeatable job (existing queue infra pattern from the
reconciliation sweep), every 15 minutes: `UPDATE driver_earnings SET
status='cleared' WHERE status='pending' AND available_at <= now()`. A
driver with an active `driver_payout_holds` row still clears normally —
holds block the *sweep into a batch*, not accrual/clearing visibility.

### 4. Scheduled payout batch

Daily cron: within one transaction, create a `payout_batches` row
(`run_type='scheduled'`, `status='draft'`), select `cleared` earnings for
drivers who are **not** held and have a `verified` bank account, group by
driver, insert one `payouts` row per driver, and stamp those `driver_earnings`
rows `status='in_payout', payout_id=<new id>` — same transaction, closing the
cutoff race (a line clearing mid-sweep is either fully in or fully out, never
double-counted). Batches under a configurable total auto-`approve`; larger
ones stay `draft` for admin approval.

### 5. Instant cash-out

Driver-initiated endpoint, same sweep logic scoped to one driver,
`run_type='instant'`, always auto-approved. A flat fee (from
`system_config`) is added as a negative `adjustment` earnings line before
the payout amount is summed.

### 6. Disbursal + webhook confirmation

Approved batch → for each `payouts` row, call RazorpayX Payouts with
`reference_id = batch_id || ':' || driver_id` as the idempotency key (guards
retried API calls). Store `gateway_payout_id`, set `status='processing'`.
Never mark `paid` from the synchronous API response.

Webhook handler (extends the existing `handleWebhookEvent` pattern —
signature verified against raw bytes, same as the ride-payment webhook):

- `payout.processed` → `payouts.status='processed'`, store `utr`; matching
  `driver_earnings` rows → `status='paid'`.
- `payout.failed` → `payouts.status='failed'`; `driver_earnings` rows revert
  to `cleared` (so they're picked up next batch); if the failure reason
  indicates bad account details, flag `driver_bank_accounts.status='invalid'`
  and notify the driver via the existing notifications module.
- `payout.reversed` → same revert-to-`cleared` path, offsetting entry noted.

### 7. Admin surface

New `api/src/modules/payments/submodules/settlements/` implementation
(currently a stub) + new admin routes under `/api/v1/admin/payouts/*`,
mirroring the existing admin notification-templates page pattern:

- Batch list + drill-in (per-driver `payouts` rows, statuses, UTRs).
- Batch approval action.
- Place/release `driver_payout_holds` (required reason), surfaced on the
  existing driver detail page next to the wallet section.
- Manual adjustment: admin creates a signed `driver_earnings` `adjustment`
  row (reason + admin_id required, never edits existing rows).
- Reconciliation view: `payouts` stuck `processing` beyond a threshold,
  flagged for manual retry/investigation.
- Retry failed payout (fresh idempotency key per retry attempt).
- Bank account verification queue (`pending_verification`/`invalid`),
  penny-drop validation via the gateway's fund-account API gating first
  payout.
- Per-driver, per-FY tax statement (aggregate `tax_deductions`).

Driver-side: extend `apps/driver/src/pages/Earnings.tsx` (already fetches
real data) with payable balance (`SUM(amount) WHERE status='cleared'`),
payout history, and an "Instant Cash Out" action; bank account entry screen
gated behind PAN capture (`driver_tax_profile`).

### 8. Testing

One `test_*`-style check per non-trivial branch, matching this repo's
existing convention:

- Accrual idempotency: `accrueDriverEarning` called twice for the same ride
  produces exactly one `ride_fare_net` line (unique constraint on
  `idempotency_key`).
- Batch-sweep atomicity: a `driver_earnings` row can't end up referenced by
  two `payout_batches` (no double-sweep across overlapping cron runs).
- TDS calc: PAN-verified vs unverified driver produce the correct rate and
  `tax_deductions` row.
- Webhook status transitions: `processed`/`failed`/`reversed` each move the
  linked earnings rows to the correct terminal/reverted status, and a
  duplicate webhook delivery is a no-op (mirrors the existing
  `payment_gateway_events` dedup pattern).

## Out of scope (future specs)

- Non-India payout rails / multi-currency.
- Driver-side push notifications for payout events beyond the existing
  low-balance/payment-failed notification patterns (reuse, not extend, for
  v1).
- Incentive/bonus *program design* (surge multipliers, referral bonuses) —
  this spec only builds the ledger primitive (`entry_type='incentive'`) that
  such a program would write into; the program logic itself is separate.
- Automated GST filing / government portal integration — `tax_deductions`
  and the per-driver statement are the data layer; actual filing is a
  finance-ops process outside this codebase.
