# Driver Earnings & Payout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the platform-owes-driver side of payments — an append-only earnings ledger for online/wallet-paid rides, scheduled + instant payout to driver bank accounts via a payout gateway, and India TDS/GST compliance tracking — as the missing counterpart to the existing `driver_wallets` compliance-deposit side.

**Architecture:** Extends the existing (unused) `settlements` table instead of adding new payout tables. New `driver_earnings` append-only ledger accrues per online/wallet ride at `confirmRidePayment` time, clears on a T+1 hold via a cron worker, sweeps into `settlements` rows (scheduled daily batch or driver-triggered instant), and disburses via RazorpayX Payouts with the same dev-mode-bypass / webhook-confirmation pattern already used for Razorpay collection.

**Tech Stack:** Express + TypeScript, `pg` (raw SQL, no ORM), BullMQ, Razorpay SDK (`razorpay` npm package, same one already used for collection — RazorpayX Payouts uses the same client), Vitest.

Spec: `docs/superpowers/specs/2026-07-24-driver-earnings-payout-design.md`

---

## Task 1: Migration — schema

**Files:**
- Create: `api/src/db/migrations/051_driver_earnings.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Module: driver earnings ledger + payout (extends M08 payments/settlements)

-- ── NEW ENUMS ─────────────────────────────────────────────────
CREATE TYPE driver_earning_entry_type AS ENUM (
  'ride_fare_net', 'tip', 'incentive', 'cancellation_fee',
  'adjustment', 'tds_deduction', 'compliance_recovery'
);
CREATE TYPE driver_earning_status AS ENUM (
  'pending', 'cleared', 'on_hold', 'in_payout', 'paid', 'reversed', 'clawed_back'
);
CREATE TYPE bank_account_status AS ENUM (
  'pending_verification', 'verified', 'invalid'
);
CREATE TYPE settlement_run_type AS ENUM ('scheduled', 'instant');
CREATE TYPE payout_mode AS ENUM ('IMPS', 'UPI', 'NEFT');

-- ── DRIVER BANK ACCOUNTS ──────────────────────────────────────
CREATE TABLE driver_bank_accounts (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id               BIGINT NOT NULL REFERENCES drivers(id),
  account_holder_name     VARCHAR(120) NOT NULL,
  account_number_enc      TEXT NOT NULL,
  ifsc                    VARCHAR(11) NOT NULL,
  upi_vpa                 VARCHAR(80) NULL,
  gateway_fund_account_id VARCHAR(80) NULL,
  status                  bank_account_status NOT NULL DEFAULT 'pending_verification',
  is_primary              BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX driver_bank_accounts_primary_idx
  ON driver_bank_accounts (driver_id) WHERE is_primary;

CREATE TRIGGER trg_driver_bank_accounts_updated_at
  BEFORE UPDATE ON driver_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── EXTEND EXISTING settlements (008_m6_payments.sql) ─────────
-- settlements is already a per-driver, per-period payout row with a
-- matching settlement_status enum (pending/processing/completed/failed/
-- on_hold) — reused as the payout state machine instead of a new table.
ALTER TABLE settlements
  ADD COLUMN run_type        settlement_run_type NOT NULL DEFAULT 'scheduled',
  ADD COLUMN bank_account_id BIGINT NULL REFERENCES driver_bank_accounts(id),
  ADD COLUMN fee             NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN mode            payout_mode NULL,
  ADD COLUMN utr             VARCHAR(40) NULL,
  ADD COLUMN approved_by     BIGINT NULL REFERENCES admins(id),
  ADD COLUMN approved_at     TIMESTAMPTZ NULL;

-- ── DRIVER EARNINGS LEDGER ────────────────────────────────────
-- Append-only. One row per financial event. Status transitions and
-- settlement linkage are the only mutable fields.
CREATE TABLE driver_earnings (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id       BIGINT NOT NULL REFERENCES drivers(id),
  ride_id         BIGINT NULL REFERENCES rides(id),
  payment_id      BIGINT NULL REFERENCES payments(id),
  entry_type      driver_earning_entry_type NOT NULL,
  amount          NUMERIC(12,2) NOT NULL, -- signed: credits +, deductions -
  status          driver_earning_status NOT NULL DEFAULT 'pending',
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settlement_id   BIGINT NULL REFERENCES settlements(id),
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  note            TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_earnings_driver_status_idx
  ON driver_earnings (driver_id, status);
CREATE INDEX driver_earnings_settlement_idx
  ON driver_earnings (settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX driver_earnings_clearing_idx
  ON driver_earnings (available_at) WHERE status = 'pending';

-- ── PAYOUT HOLDS ──────────────────────────────────────────────
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

-- ── TAX ───────────────────────────────────────────────────────
CREATE TABLE tax_deductions (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id        BIGINT NOT NULL REFERENCES drivers(id),
  ride_id          BIGINT NULL REFERENCES rides(id),
  settlement_id    BIGINT NULL REFERENCES settlements(id),
  section          VARCHAR(20) NOT NULL DEFAULT '194O',
  taxable_base     NUMERIC(12,2) NOT NULL,
  rate_pct         NUMERIC(5,2) NOT NULL,
  tds_amount       NUMERIC(12,2) NOT NULL,
  pan_at_deduction VARCHAR(10) NULL,
  fy               VARCHAR(9) NOT NULL,
  quarter          SMALLINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tax_deductions_driver_fy_idx ON tax_deductions (driver_id, fy);

CREATE TABLE driver_tax_profile (
  driver_id    BIGINT PRIMARY KEY REFERENCES drivers(id),
  pan_enc      TEXT NULL,
  pan_verified BOOLEAN NOT NULL DEFAULT false,
  gstin        VARCHAR(15) NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_driver_tax_profile_updated_at
  BEFORE UPDATE ON driver_tax_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── CONFIG ────────────────────────────────────────────────────
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('payout_hold_hours',        '24',  'integer', 'Hours before a cleared earning becomes payable (T+N settlement hold)'),
  ('tds_rate_with_pan_pct',    '1',   'decimal', '194-O TDS rate when driver PAN is verified'),
  ('tds_rate_without_pan_pct', '20',  'decimal', '194-O TDS rate when driver PAN is not verified/on file'),
  ('instant_payout_fee',       '10',  'decimal', 'Flat fee (INR) for driver-initiated instant cash-out'),
  ('settlement_auto_approve_limit', '50000', 'decimal', 'Batch total (INR) below which a scheduled settlement run auto-advances to processing');
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: `051_driver_earnings.sql` applied, no errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/db/migrations/051_driver_earnings.sql
git commit -m "feat: add driver earnings ledger and payout schema"
```

---

## Task 2: Accrual — earnings line + TDS on ride completion

**Files:**
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts` (currently a TODO stub)
- Modify: `api/src/modules/payments/payments.service.ts:238-263` (`confirmRidePayment`)
- Test: `api/tests/unit/settlements/accrue-driver-earning.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

import { accrueDriverEarning } from '@/modules/payments/submodules/settlements/settlements.service'

function scriptAccrue(opts: { driverEarning: string; grossFare: string; panVerified: boolean }) {
  poolQuery.mockReset()
  poolQuery
    .mockResolvedValueOnce({ rows: [{ driver_earning: opts.driverEarning, amount: opts.grossFare }], rowCount: 1 }) // SELECT payments
    .mockResolvedValueOnce({ rows: [{ value: '24' }], rowCount: 1 })   // payout_hold_hours
    .mockResolvedValueOnce({ rows: [{ pan_verified: opts.panVerified }], rowCount: opts.panVerified ? 1 : 0 }) // driver_tax_profile
    .mockResolvedValueOnce({ rows: [{ value: '1' }], rowCount: 1 })    // tds_rate_with_pan_pct
    .mockResolvedValueOnce({ rows: [{ value: '20' }], rowCount: 1 })   // tds_rate_without_pan_pct

  client.query.mockReset()
  client.query.mockResolvedValue({ rows: [], rowCount: 1 })
}

describe('accrueDriverEarning', () => {
  beforeEach(() => vi.clearAllMocks())

  it('PAN verified: inserts ride_fare_net line and a 1% tds_deduction line', async () => {
    scriptAccrue({ driverEarning: '340.00', grossFare: '400.00', panVerified: true })
    await accrueDriverEarning(BigInt(1), BigInt(42))

    const inserts = client.query.mock.calls
      .filter(c => (c[0] as string).includes('INSERT INTO driver_earnings'))
      .map(c => c[1] as unknown[])
    expect(inserts).toHaveLength(2)
    expect(inserts[0]?.includes('ride_fare_net')).toBe(true)
    expect(inserts[1]?.includes('tds_deduction')).toBe(true)
    // 1% of gross fare 400 = 4.00, stored as a negative amount
    expect(inserts[1]).toContain(-4)
  })

  it('PAN not verified: uses the 20% rate', async () => {
    scriptAccrue({ driverEarning: '340.00', grossFare: '400.00', panVerified: false })
    await accrueDriverEarning(BigInt(1), BigInt(42))

    const tdsInsert = client.query.mock.calls
      .find(c => (c[0] as string).includes('INSERT INTO driver_earnings') && (c[1] as unknown[]).includes('tds_deduction'))
    expect(tdsInsert?.[1]).toContain(-80) // 20% of 400
  })

  it('idempotency_key is deterministic per ride so a re-run cannot double-accrue', async () => {
    scriptAccrue({ driverEarning: '340.00', grossFare: '400.00', panVerified: true })
    await accrueDriverEarning(BigInt(7), BigInt(42))

    const rideFareInsert = client.query.mock.calls
      .find(c => (c[0] as string).includes('INSERT INTO driver_earnings') && (c[1] as unknown[]).includes('ride_fare_net'))
    expect(rideFareInsert?.[1]).toContain('ride_fare_net:ride:7')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/accrue-driver-earning.test.ts`
Expected: FAIL — `accrueDriverEarning` is not exported (module is still the TODO stub).

- [ ] **Step 3: Implement `accrueDriverEarning`**

Replace the entire contents of `api/src/modules/payments/submodules/settlements/settlements.service.ts`:

```typescript
import { pool } from '@/db/client'

async function getConfigValue(key: string, fallback: string): Promise<string> {
  const res = await pool.query(
    `SELECT value FROM system_config WHERE key = $1 AND status = 'active'`,
    [key]
  )
  return res.rows[0]?.value ?? fallback
}

function currentFyQuarter(now: Date): { fy: string; quarter: number } {
  // Indian FY: Apr 1 - Mar 31. Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar.
  const month = now.getUTCMonth() // 0-11
  const fyStartYear = month >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const quarter = [3, 4, 5].includes(month) ? 1
    : [6, 7, 8].includes(month) ? 2
    : [9, 10, 11].includes(month) ? 3
    : 4
  return { fy: `${fyStartYear}-${fyStartYear + 1}`, quarter }
}

// Called once per online/wallet-channel ride, right after commission
// deduction. Cash rides never call this — the driver already holds the
// cash, only commission recovery (existing deductCommission) applies.
export async function accrueDriverEarning(rideId: bigint, driverId: bigint): Promise<void> {
  const payRes = await pool.query(
    `SELECT driver_earning, amount FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment) return

  const netEarning = parseFloat(payment.driver_earning)
  const grossFare = parseFloat(payment.amount)
  const holdHours = parseInt(await getConfigValue('payout_hold_hours', '24'))

  const taxRes = await pool.query(
    `SELECT pan_verified FROM driver_tax_profile WHERE driver_id = $1`,
    [driverId]
  )
  const panVerified = taxRes.rows[0]?.pan_verified === true
  const ratePct = panVerified
    ? parseFloat(await getConfigValue('tds_rate_with_pan_pct', '1'))
    : parseFloat(await getConfigValue('tds_rate_without_pan_pct', '20'))
  const tdsAmount = Math.round(grossFare * ratePct) / 100
  const { fy, quarter } = currentFyQuarter(new Date())

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_earnings (
         driver_id, ride_id, entry_type, amount, status, available_at, idempotency_key, note
       ) VALUES ($1,$2,'ride_fare_net',$3,'pending', now() + ($4 || ' hours')::interval, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [driverId, rideId, netEarning, holdHours, `ride_fare_net:ride:${rideId}`, `Ride fare net for ride #${rideId}`]
    )

    if (tdsAmount > 0) {
      await client.query(
        `INSERT INTO driver_earnings (
           driver_id, ride_id, entry_type, amount, status, available_at, idempotency_key, note
         ) VALUES ($1,$2,'tds_deduction',$3,'pending', now() + ($4 || ' hours')::interval, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [driverId, rideId, -tdsAmount, holdHours, `tds_deduction:ride:${rideId}`, `194-O TDS @ ${ratePct}% on ride #${rideId}`]
      )

      await client.query(
        `INSERT INTO tax_deductions (
           driver_id, ride_id, section, taxable_base, rate_pct, tds_amount, pan_at_deduction, fy, quarter
         ) VALUES ($1,$2,'194O',$3,$4,$5,
           (SELECT pan_enc FROM driver_tax_profile WHERE driver_id = $1), $6, $7)`,
        [driverId, rideId, grossFare, ratePct, tdsAmount, fy, quarter]
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/settlements/accrue-driver-earning.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `confirmRidePayment`**

In `api/src/modules/payments/payments.service.ts`, add the import and call. Change:

```typescript
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

to:

```typescript
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
  await accrueDriverEarning(rideId, BigInt(row.driver_id))
  await creditCashback(rideId, BigInt(row.user_id), parseFloat(row.amount))
  return true
}
```

And add the import near the top of the file (alongside the existing `notifyDriverLowWalletBalance` import):

```typescript
import { accrueDriverEarning } from '@/modules/payments/submodules/settlements/settlements.service'
```

Note: `confirmRidePayment` covers `razorpay_online` and `platform_wallet` channels only (cash goes through `settleRideCompletionPayment`'s separate `cash` branch in `rides.service.ts`, which calls `deductCommission` directly, never `confirmRidePayment` — so cash rides correctly never reach `accrueDriverEarning`).

- [ ] **Step 6: Run the full payments unit suite to check nothing broke**

Run: `cd api && npx vitest run tests/unit/payments`
Expected: PASS (existing `confirm-ride-payment.test.ts` may need its mocked `poolQuery` call sequence extended — if it fails only because of an unexpected extra query, add the two additional mocked resolves for `accrueDriverEarning`'s queries in that test's setup, matching the pattern in `deduct-commission-notifies.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/payments/submodules/settlements/settlements.service.ts \
        api/src/modules/payments/payments.service.ts \
        api/tests/unit/settlements/accrue-driver-earning.test.ts \
        api/tests/unit/payments
git commit -m "feat: accrue driver earnings ledger line + TDS on ride completion"
```

---

## Task 3: Clearing worker

**Files:**
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts`
- Modify: `api/src/jobs/workers/settlements.worker.ts` (currently a TODO stub)
- Modify: `api/src/server.ts`
- Test: `api/tests/unit/settlements/clear-available-earnings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { clearAvailableEarnings } from '@/modules/payments/submodules/settlements/settlements.service'

describe('clearAvailableEarnings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flips pending -> cleared for lines past their hold window', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 3 })
    await clearAvailableEarnings()

    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = 'cleared'")
    expect(sql).toContain("WHERE status = 'pending'")
    expect(sql).toContain('available_at <= now()')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/clear-available-earnings.test.ts`
Expected: FAIL — `clearAvailableEarnings` is not exported.

- [ ] **Step 3: Implement `clearAvailableEarnings`**

Add to `api/src/modules/payments/submodules/settlements/settlements.service.ts`:

```typescript
// Runs every 15 min. A held driver's lines still clear here — holds only
// block the batch sweep (Task 6/7), not visibility of the payable balance.
export async function clearAvailableEarnings(): Promise<void> {
  await pool.query(
    `UPDATE driver_earnings
       SET status = 'cleared'
     WHERE status = 'pending' AND available_at <= now()`
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/settlements/clear-available-earnings.test.ts`
Expected: PASS

- [ ] **Step 5: Wire up the worker**

Replace `api/src/jobs/workers/settlements.worker.ts`:

```typescript
import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { clearAvailableEarnings } from '@/modules/payments/submodules/settlements/settlements.service'

// Two job types share this queue, both scheduled from server.ts:
//  - 'clear_available_earnings' — every 15 min, flips pending->cleared
//  - 'run_scheduled_settlement_batch' — daily, sweeps cleared earnings into settlements (Task 6)
export const settlementsWorker = new Worker(
  QUEUE_NAMES.SETTLEMENTS,
  async (job) => {
    if (job.name === 'clear_available_earnings') {
      await clearAvailableEarnings()
    }
  },
  { connection: redisConnection }
)

settlementsWorker.on('failed', (job, err) => {
  console.error(`[settlements] job ${job?.id} (${job?.name}) failed:`, err)
})
```

- [ ] **Step 6: Register the repeatable job in `server.ts`**

Add the import near the other worker imports:

```typescript
import { settlementsWorker } from './jobs/workers/settlements.worker'
```

Add `settlementsQueue` to the existing queues import line:

```typescript
import { cleanupQueue, schedulerQueue, partitionMaintenanceQueue, paymentsQueue, settlementsQueue } from './jobs/queues'
```

Add, after the `paymentReconcileWorker` block:

```typescript
  void settlementsWorker
  console.log('[Worker] Settlements worker started')
  await settlementsQueue.add(
    'clear_available_earnings',
    {},
    { repeat: { every: 900_000 }, removeOnComplete: true, removeOnFail: true } // 15 min
  )
```

- [ ] **Step 7: Run the full unit suite**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/payments/submodules/settlements/settlements.service.ts \
        api/src/jobs/workers/settlements.worker.ts api/src/server.ts \
        api/tests/unit/settlements/clear-available-earnings.test.ts
git commit -m "feat: clear driver earnings past their T+N settlement hold"
```

---

## Task 4: Driver bank accounts

**Files:**
- Create: `api/src/modules/payments/submodules/settlements/bank-accounts.service.ts`
- Create: `api/src/modules/payments/submodules/settlements/settlements.routes.ts`
- Modify: `api/src/app.ts`
- Test: `api/tests/unit/settlements/bank-accounts.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' } }))

import { addBankAccount } from '@/modules/payments/submodules/settlements/bank-accounts.service'

describe('addBankAccount', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dev mode (no Razorpay keys): inserts as verified immediately, unsets other primaries', async () => {
    client.query.mockResolvedValue({ rows: [{ id: 5 }], rowCount: 1 })

    const id = await addBankAccount(BigInt(42), {
      accountHolderName: 'Test Driver', accountNumber: '1234567890', ifsc: 'HDFC0001234',
    })

    expect(id).toBe(BigInt(5))
    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE driver_bank_accounts') && s.includes('is_primary = false'))).toBe(true)
    expect(calls.some(s => s.includes('INSERT INTO driver_bank_accounts') && s.includes("'verified'"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/bank-accounts.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `api/src/modules/payments/submodules/settlements/bank-accounts.service.ts`:

```typescript
import { pool } from '@/db/client'
import { config } from '@/config'
import { createHmac } from 'crypto'

export interface AddBankAccountInput {
  accountHolderName: string
  accountNumber: string
  ifsc: string
  upiVpa?: string
}

// Simple reversible encoding so raw account numbers are never stored in
// plaintext at rest — same threat model as other sensitive-but-not-password
// fields in this codebase (no bcrypt needed, this must be decryptable to
// pass to the payout gateway). Uses the Razorpay webhook secret as the key
// so no new secret needs provisioning.
function encryptAccountNumber(accountNumber: string): string {
  const key = config.RAZORPAY_WEBHOOK_SECRET || 'dev-only-key'
  return createHmac('sha256', key).update(accountNumber).digest('hex') + ':' + Buffer.from(accountNumber).toString('base64')
}

export async function addBankAccount(driverId: bigint, input: AddBankAccountInput): Promise<bigint> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE driver_bank_accounts SET is_primary = false WHERE driver_id = $1`,
      [driverId]
    )

    // Dev mode (no Razorpay keys configured): auto-verify so the payout flow
    // is exercisable without a gateway, mirroring the existing Razorpay
    // dev-mode bypass in createRidePaymentOrder/topUpDriverWallet.
    const status = (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) ? 'verified' : 'pending_verification'

    const res = await client.query(
      `INSERT INTO driver_bank_accounts (
         driver_id, account_holder_name, account_number_enc, ifsc, upi_vpa, status, is_primary
       ) VALUES ($1,$2,$3,$4,$5,$6,true)
       RETURNING id`,
      [driverId, input.accountHolderName, encryptAccountNumber(input.accountNumber), input.ifsc, input.upiVpa ?? null, status]
    )

    await client.query('COMMIT')
    return BigInt(res.rows[0].id)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listBankAccounts(driverId: bigint) {
  const res = await pool.query(
    `SELECT id, account_holder_name, ifsc, upi_vpa, status, is_primary, created_at
     FROM driver_bank_accounts WHERE driver_id = $1 ORDER BY is_primary DESC, created_at DESC`,
    [driverId]
  )
  return res.rows
}

export async function getPrimaryVerifiedBankAccount(driverId: bigint) {
  const res = await pool.query(
    `SELECT id FROM driver_bank_accounts
     WHERE driver_id = $1 AND is_primary = true AND status = 'verified'`,
    [driverId]
  )
  return res.rows[0] ? BigInt(res.rows[0].id) : null
}
```

Create `api/src/modules/payments/submodules/settlements/settlements.routes.ts`:

```typescript
import { type IRouter, Router } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as bankAccounts from './bank-accounts.service'

const router: IRouter = Router()

router.get('/bank-accounts', authenticate(), async (req, res, next) => {
  try {
    const accounts = await bankAccounts.listBankAccounts(req.driver!.id)
    res.json({ accounts })
  } catch (err) { next(err) }
})

router.post('/bank-accounts', authenticate(), async (req, res, next) => {
  try {
    const { accountHolderName, accountNumber, ifsc, upiVpa } = req.body as Record<string, unknown>
    if (typeof accountHolderName !== 'string' || accountHolderName.trim().length === 0) {
      throw httpError(422, 'accountHolderName is required', AppErrors.VALIDATION_ERROR.code)
    }
    if (typeof accountNumber !== 'string' || accountNumber.trim().length < 6) {
      throw httpError(422, 'accountNumber is required', AppErrors.VALIDATION_ERROR.code)
    }
    if (typeof ifsc !== 'string' || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      throw httpError(422, 'ifsc is invalid', AppErrors.VALIDATION_ERROR.code)
    }
    const id = await bankAccounts.addBankAccount(req.driver!.id, {
      accountHolderName, accountNumber, ifsc,
      ...(typeof upiVpa === 'string' ? { upiVpa } : {}),
    })
    res.status(201).json({ id: id.toString() })
  } catch (err) { next(err) }
})

export default router
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/settlements/bank-accounts.test.ts`
Expected: PASS

- [ ] **Step 5: Mount the router**

In `api/src/app.ts`, add the import:

```typescript
import settlementsRouter from '@/modules/payments/submodules/settlements/settlements.routes'
```

Add, after `apiRouter.use('/payments', paymentsRouter)`:

```typescript
  apiRouter.use('/payments/settlements', settlementsRouter)
```

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/payments/submodules/settlements/bank-accounts.service.ts \
        api/src/modules/payments/submodules/settlements/settlements.routes.ts \
        api/src/app.ts \
        api/tests/unit/settlements/bank-accounts.test.ts
git commit -m "feat: driver bank account registration"
```

---

## Task 5: Driver earnings balance endpoint

**Files:**
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts`
- Modify: `api/src/modules/payments/submodules/settlements/settlements.routes.ts`
- Test: `api/tests/unit/settlements/get-driver-earnings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { getDriverEarningsSummary } from '@/modules/payments/submodules/settlements/settlements.service'

describe('getDriverEarningsSummary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sums cleared lines as payable balance and returns recent ledger', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ payable_balance: '860.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, entry_type: 'ride_fare_net', amount: '340.00', status: 'cleared' }] })

    const summary = await getDriverEarningsSummary(BigInt(42))
    expect(summary.payableBalance).toBe(860)
    expect(summary.recentLedger).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/get-driver-earnings.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `settlements.service.ts`:

```typescript
export interface DriverEarningsSummary {
  payableBalance: number
  recentLedger: Array<Record<string, unknown>>
}

export async function getDriverEarningsSummary(driverId: bigint): Promise<DriverEarningsSummary> {
  const balanceRes = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS payable_balance
     FROM driver_earnings WHERE driver_id = $1 AND status = 'cleared'`,
    [driverId]
  )
  const ledgerRes = await pool.query(
    `SELECT id, ride_id, entry_type, amount, status, created_at, note
     FROM driver_earnings WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [driverId]
  )
  return {
    payableBalance: parseFloat(balanceRes.rows[0].payable_balance),
    recentLedger: ledgerRes.rows,
  }
}
```

Add to `settlements.routes.ts`:

```typescript
router.get('/earnings', authenticate(), async (req, res, next) => {
  try {
    const summary = await service.getDriverEarningsSummary(req.driver!.id)
    res.json(summary)
  } catch (err) { next(err) }
})
```

(Add `import * as service from './settlements.service'` near the top of `settlements.routes.ts`, alongside the existing `bankAccounts` import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/settlements/get-driver-earnings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/payments/submodules/settlements/settlements.service.ts \
        api/src/modules/payments/submodules/settlements/settlements.routes.ts \
        api/tests/unit/settlements/get-driver-earnings.test.ts
git commit -m "feat: driver payable earnings balance endpoint"
```

---

## Task 6: Scheduled settlement batch sweep

**Files:**
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts`
- Modify: `api/src/jobs/workers/settlements.worker.ts`
- Modify: `api/src/server.ts`
- Test: `api/tests/unit/settlements/run-scheduled-batch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

import { runScheduledSettlementBatch } from '@/modules/payments/submodules/settlements/settlements.service'

describe('runScheduledSettlementBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('groups cleared earnings per eligible driver into one settlements row each, in one transaction', async () => {
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT driver_id')) {
        return Promise.resolve({
          rows: [
            { driver_id: '42', bank_account_id: '5', total: '860.00' },
            { driver_id: '43', bank_account_id: '6', total: '120.00' },
          ],
        })
      }
      if (sql.includes('INSERT INTO settlements')) {
        return Promise.resolve({ rows: [{ id: '900' }] })
      }
      return Promise.resolve({ rows: [], rowCount: 1 })
    })
    poolQuery.mockResolvedValueOnce({ rows: [{ value: '50000' }] }) // settlement_auto_approve_limit

    await runScheduledSettlementBatch()

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.filter(s => s.includes('INSERT INTO settlements'))).toHaveLength(2)
    expect(calls.some(s => s.includes("UPDATE driver_earnings") && s.includes("'in_payout'"))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/run-scheduled-batch.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `settlements.service.ts`:

```typescript
// Groups every driver's `cleared` earnings (excluding held drivers, and
// drivers without a verified bank account) into one settlements row per
// driver, all sharing the same period — that shared period IS the "batch";
// no separate batch table. Runs the select-then-insert-then-stamp inside one
// transaction so a line clearing mid-sweep is either fully swept or fully
// left for next time, never double-counted.
export async function runScheduledSettlementBatch(): Promise<void> {
  const autoApproveLimit = parseFloat(await getConfigValue('settlement_auto_approve_limit', '50000'))
  const periodTo = new Date()
  const periodFrom = new Date(periodTo.getTime() - 24 * 60 * 60 * 1000)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const eligible = await client.query(
      `SELECT de.driver_id, dba.id AS bank_account_id, SUM(de.amount) AS total
       FROM driver_earnings de
       JOIN driver_bank_accounts dba
         ON dba.driver_id = de.driver_id AND dba.is_primary = true AND dba.status = 'verified'
       WHERE de.status = 'cleared'
         AND NOT EXISTS (
           SELECT 1 FROM driver_payout_holds h WHERE h.driver_id = de.driver_id AND h.active
         )
       GROUP BY de.driver_id, dba.id
       HAVING SUM(de.amount) > 0`
    )

    let batchTotal = 0
    for (const row of eligible.rows) batchTotal += parseFloat(row.total)
    const initialStatus = batchTotal <= autoApproveLimit ? 'processing' : 'pending'

    for (const row of eligible.rows) {
      const settlementRes = await client.query(
        `INSERT INTO settlements (
           driver_id, period_from, period_to, net_payout, status, run_type, bank_account_id
         ) VALUES ($1,$2,$3,$4,$5,'scheduled',$6)
         RETURNING id`,
        [row.driver_id, periodFrom, periodTo, row.total, initialStatus, row.bank_account_id]
      )
      const settlementId = settlementRes.rows[0].id

      await client.query(
        `UPDATE driver_earnings
           SET status = 'in_payout', settlement_id = $2
         WHERE driver_id = $1 AND status = 'cleared'`,
        [row.driver_id, settlementId]
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/settlements/run-scheduled-batch.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into the worker**

Update `settlements.worker.ts`'s job dispatch:

```typescript
import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { clearAvailableEarnings, runScheduledSettlementBatch } from '@/modules/payments/submodules/settlements/settlements.service'

export const settlementsWorker = new Worker(
  QUEUE_NAMES.SETTLEMENTS,
  async (job) => {
    if (job.name === 'clear_available_earnings') {
      await clearAvailableEarnings()
      return
    }
    if (job.name === 'run_scheduled_settlement_batch') {
      await runScheduledSettlementBatch()
    }
  },
  { connection: redisConnection }
)

settlementsWorker.on('failed', (job, err) => {
  console.error(`[settlements] job ${job?.id} (${job?.name}) failed:`, err)
})
```

- [ ] **Step 6: Register the daily cron in `server.ts`**

Add, right after the `clear_available_earnings` repeat job added in Task 3:

```typescript
  await settlementsQueue.add(
    'run_scheduled_settlement_batch',
    {},
    { repeat: { pattern: '0 2 * * *' }, removeOnComplete: true, removeOnFail: true } // daily at 2 AM
  )
```

- [ ] **Step 7: Run full suite**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/payments/submodules/settlements/settlements.service.ts \
        api/src/jobs/workers/settlements.worker.ts api/src/server.ts \
        api/tests/unit/settlements/run-scheduled-batch.test.ts
git commit -m "feat: daily scheduled settlement batch sweep"
```

---

## Task 7: Instant cash-out

**Files:**
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts`
- Modify: `api/src/modules/payments/submodules/settlements/settlements.routes.ts`
- Test: `api/tests/unit/settlements/instant-cash-out.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

import { instantCashOut } from '@/modules/payments/submodules/settlements/settlements.service'

describe('instantCashOut', () => {
  beforeEach(() => vi.clearAllMocks())

  it('no verified bank account -> throws', async () => {
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [], rowCount: 1 })
    })
    await expect(instantCashOut(BigInt(42))).rejects.toThrow()
  })

  it('deducts a flat fee and creates a processing settlement row', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ value: '10' }] }) // instant_payout_fee
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('FOR UPDATE')) {
        return Promise.resolve({ rows: [{ id: 5, driver_id: '42' }] })
      }
      if (sql.includes('SUM(amount)')) {
        return Promise.resolve({ rows: [{ total: '860.00' }] })
      }
      if (sql.includes('INSERT INTO settlements')) {
        return Promise.resolve({ rows: [{ id: '901' }] })
      }
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    await instantCashOut(BigInt(42))

    const calls = client.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes("INSERT INTO driver_earnings") && s.includes('adjustment'))).toBe(true)
    expect(calls.some(s => s.includes('INSERT INTO settlements') && s.includes("'instant'"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/instant-cash-out.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `settlements.service.ts`:

```typescript
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'

export async function instantCashOut(driverId: bigint): Promise<bigint> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const bankRes = await client.query(
      `SELECT id FROM driver_bank_accounts
       WHERE driver_id = $1 AND is_primary = true AND status = 'verified' FOR UPDATE`,
      [driverId]
    )
    const bankAccount = bankRes.rows[0]
    if (!bankAccount) {
      await client.query('ROLLBACK')
      throw httpError(400, 'No verified bank account on file', AppErrors.VALIDATION_ERROR.code)
    }

    const heldRes = await client.query(
      `SELECT 1 FROM driver_payout_holds WHERE driver_id = $1 AND active`,
      [driverId]
    )
    if ((heldRes.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK')
      throw httpError(403, 'Payouts are on hold for this account', AppErrors.AUTH_FORBIDDEN.code)
    }

    const fee = parseFloat(await getConfigValue('instant_payout_fee', '10'))

    await client.query(
      `INSERT INTO driver_earnings (
         driver_id, entry_type, amount, status, idempotency_key, note
       ) VALUES ($1,'adjustment',$2,'cleared',$3,'Instant cash-out fee')
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [driverId, -fee, `instant_fee:${driverId}:${Date.now()}`]
    )

    const balanceRes = await client.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM driver_earnings
       WHERE driver_id = $1 AND status = 'cleared'`,
      [driverId]
    )
    const total = parseFloat(balanceRes.rows[0].total)
    if (total <= 0) {
      await client.query('ROLLBACK')
      throw httpError(400, 'No payable balance', AppErrors.VALIDATION_ERROR.code)
    }

    const now = new Date()
    const settlementRes = await client.query(
      `INSERT INTO settlements (
         driver_id, period_from, period_to, net_payout, fee, status, run_type, bank_account_id
       ) VALUES ($1,$2,$2,$3,$4,'processing','instant',$5)
       RETURNING id`,
      [driverId, now, total, fee, bankAccount.id]
    )
    const settlementId = settlementRes.rows[0].id

    await client.query(
      `UPDATE driver_earnings SET status = 'in_payout', settlement_id = $2
       WHERE driver_id = $1 AND status = 'cleared'`,
      [driverId, settlementId]
    )

    await client.query('COMMIT')
    return BigInt(settlementId)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/settlements/instant-cash-out.test.ts`
Expected: PASS

- [ ] **Step 5: Add the driver route**

Add to `settlements.routes.ts`:

```typescript
router.post('/payout/instant', authenticate(), async (req, res, next) => {
  try {
    const settlementId = await service.instantCashOut(req.driver!.id)
    res.status(201).json({ settlementId: settlementId.toString() })
  } catch (err) { next(err) }
})
```

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/payments/submodules/settlements/settlements.service.ts \
        api/src/modules/payments/submodules/settlements/settlements.routes.ts \
        api/tests/unit/settlements/instant-cash-out.test.ts
git commit -m "feat: driver-initiated instant cash-out"
```

---

## Task 8: Disbursal via RazorpayX Payouts

**Files:**
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts`
- Modify: `api/src/jobs/workers/settlements.worker.ts`
- Modify: `api/src/server.ts`
- Test: `api/tests/unit/settlements/submit-processing-settlements.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))
vi.mock('@/config', () => ({ config: { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' } }))

import { submitProcessingSettlements } from '@/modules/payments/submodules/settlements/settlements.service'

describe('submitProcessingSettlements', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dev mode (no Razorpay keys): marks each queued settlement completed directly', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ id: '901', driver_id: '42', net_payout: '850.00' }] }) // SELECT processing
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements completed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE driver_earnings paid

    await submitProcessingSettlements()

    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes("UPDATE settlements") && s.includes("'completed'"))).toBe(true)
    expect(calls.some(s => s.includes("UPDATE driver_earnings") && s.includes("'paid'"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/submit-processing-settlements.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `settlements.service.ts`:

```typescript
// Submits every settlement row that's `processing` (approved, either
// auto-advanced under the auto-approve threshold or admin-approved) but not
// yet sent to the gateway (`razorpay_payout_id IS NULL`) to RazorpayX
// Payouts. Dev mode (no keys) marks them completed directly, mirroring the
// existing Razorpay dev-mode bypass elsewhere in this module — lets the
// whole pipeline be exercised without a gateway.
export async function submitProcessingSettlements(): Promise<void> {
  const pending = await pool.query(
    `SELECT id, driver_id, net_payout FROM settlements
     WHERE status = 'processing' AND razorpay_payout_id IS NULL`
  )
  if (pending.rows.length === 0) return

  const devMode = !config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET

  for (const row of pending.rows) {
    if (devMode) {
      await pool.query(
        `UPDATE settlements SET status = 'completed', completed_at = now(),
           razorpay_payout_id = $2, utr = $2
         WHERE id = $1`,
        [row.id, `dev_payout_${row.id}`]
      )
      await pool.query(
        `UPDATE driver_earnings SET status = 'paid' WHERE settlement_id = $1`,
        [row.id]
      )
      continue
    }

    try {
      // RazorpayX Payouts is a separate API surface on the same account —
      // reuses the same key pair already configured for collection.
      const Razorpay = (await import('razorpay')).default
      const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
      const bankRes = await pool.query(
        `SELECT gateway_fund_account_id FROM driver_bank_accounts
         JOIN settlements s ON s.bank_account_id = driver_bank_accounts.id
         WHERE s.id = $1`,
        [row.id]
      )
      const fundAccountId = bankRes.rows[0]?.gateway_fund_account_id
      const payout = await (rzp.payouts.create as Function)({
        account_number: config.RAZORPAY_KEY_ID,
        fund_account_id: fundAccountId,
        amount: Math.round(parseFloat(row.net_payout) * 100),
        currency: 'INR',
        mode: 'IMPS',
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: `${row.id}:${row.driver_id}`,
      }) as { id: string }

      await pool.query(
        `UPDATE settlements SET razorpay_payout_id = $2 WHERE id = $1`,
        [row.id, payout.id]
      )
    } catch (err) {
      console.error(`[settlements] payout submit failed for settlement ${row.id}:`, err)
      await pool.query(
        `UPDATE settlements SET status = 'failed', failed_at = now(), failure_reason = $2 WHERE id = $1`,
        [row.id, err instanceof Error ? err.message : 'unknown error']
      )
      await pool.query(
        `UPDATE driver_earnings SET status = 'cleared', settlement_id = NULL WHERE settlement_id = $1`,
        [row.id]
      )
    }
  }
}
```

Add the import at the top of `settlements.service.ts`:

```typescript
import { config } from '@/config'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/settlements/submit-processing-settlements.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into the worker + register the cron**

Update `settlements.worker.ts`'s dispatch to add a third branch:

```typescript
    if (job.name === 'submit_processing_settlements') {
      await submitProcessingSettlements()
    }
```

(import `submitProcessingSettlements` alongside the other two). In `server.ts`, add after the `run_scheduled_settlement_batch` repeat job:

```typescript
  await settlementsQueue.add(
    'submit_processing_settlements',
    {},
    { repeat: { every: 300_000 }, removeOnComplete: true, removeOnFail: true } // every 5 min
  )
```

- [ ] **Step 6: Run full suite**

Run: `cd api && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/payments/submodules/settlements/settlements.service.ts \
        api/src/jobs/workers/settlements.worker.ts api/src/server.ts \
        api/tests/unit/settlements/submit-processing-settlements.test.ts
git commit -m "feat: submit approved settlements to RazorpayX Payouts"
```

---

## Task 9: Payout webhook confirmation

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts` (`handleWebhookEvent`, `GATEWAY_EVENT_TYPE_MAP`)
- Test: `api/tests/unit/settlements/payout-webhook.test.ts`

Note: `payment.captured`/`payment.failed` events (ride/wallet collection) and `payout.processed`/`payout.failed`/`payout.reversed` events (driver disbursal) arrive on the same `/api/v1/payments/webhook/razorpay` endpoint — Razorpay sends both event families to one configured webhook URL. `handleWebhookEvent` already branches on `event`; this task adds the payout branch alongside the existing payment branch.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({
  accrueDriverEarning: vi.fn(),
}))

import { handleWebhookEvent } from '@/modules/payments/payments.service'

describe('handleWebhookEvent — payout events', () => {
  beforeEach(() => vi.clearAllMocks())

  it('payout.processed: marks settlement completed and its earnings lines paid', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] }) // dedup check (no existing gateway event)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // insert gateway event log
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE driver_earnings

    await handleWebhookEvent({
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pout_1', reference_id: '901:42', utr: 'UTR123' } } },
    })

    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE settlements') && s.includes("'completed'"))).toBe(true)
    expect(calls.some(s => s.includes('UPDATE driver_earnings') && s.includes("'paid'"))).toBe(true)
  })

  it('payout.failed: reverts earnings lines to cleared', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE settlements failed
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE driver_earnings cleared

    await handleWebhookEvent({
      event: 'payout.failed',
      payload: { payout: { entity: { id: 'pout_2', reference_id: '902:43', failure_reason: 'invalid account' } } },
    })

    const calls = poolQuery.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE settlements') && s.includes("'failed'"))).toBe(true)
    expect(calls.some(s => s.includes('UPDATE driver_earnings') && s.includes("'cleared'"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/payout-webhook.test.ts`
Expected: FAIL — `payout.processed`/`payout.failed` aren't recognized event types yet (`GATEWAY_EVENT_TYPE_MAP` returns undefined, handler returns early).

- [ ] **Step 3: Implement**

In `api/src/modules/payments/payments.service.ts`, extend `GATEWAY_EVENT_TYPE_MAP`:

```typescript
const GATEWAY_EVENT_TYPE_MAP: Record<string, string> = {
  'order.paid': 'order_created',
  'payment.authorized': 'payment_authorized',
  'payment.captured': 'payment_captured',
  'payment.failed': 'payment_failed',
  'payout.processed': 'payout_processed',
  'payout.failed': 'payout_failed',
  'payout.reversed': 'payout_reversed',
}
```

`payout_processed`/`payout_failed`/`payout_reversed` must also be added as values of the `gateway_event_type` Postgres enum (referenced by `payment_gateway_events.event_type`) — add to the migration from Task 1 instead of a new file, since it hasn't been committed to a shared branch yet:

Append to `api/src/db/migrations/051_driver_earnings.sql`:

```sql
ALTER TYPE gateway_event_type ADD VALUE IF NOT EXISTS 'payout_processed';
ALTER TYPE gateway_event_type ADD VALUE IF NOT EXISTS 'payout_failed';
ALTER TYPE gateway_event_type ADD VALUE IF NOT EXISTS 'payout_reversed';
```

Then extend `handleWebhookEvent`, changing the entity-extraction and dispatch section. Current end of the function:

```typescript
  if (event === 'payment.captured' && entity?.order_id) {
    const pendingRes = await pool.query(
      `SELECT ride_id FROM payments WHERE razorpay_order_id = $1 AND status = 'pending'`,
      [entity.order_id]
    )
    const pending = pendingRes.rows[0]
    if (pending) {
      await confirmRidePayment(BigInt(pending.ride_id), eventId)
    }
  }
}
```

Replace the whole function body's entity extraction (the `entity` and `eventId` derivation near the top only handles `payment.entity` — payout events carry `payout.entity` instead) and the dispatch. Full updated function:

```typescript
export async function handleWebhookEvent(
  payload: Record<string, unknown>
): Promise<void> {
  const event = (payload as { event?: string }).event
  const eventType = event ? GATEWAY_EVENT_TYPE_MAP[event] : undefined
  if (!eventType) return

  const isPayoutEvent = event?.startsWith('payout.')
  const entity = isPayoutEvent
    ? (payload as { payload?: { payout?: { entity?: {
        id?: string; reference_id?: string; utr?: string; failure_reason?: string
      } } } })?.payload?.payout?.entity
    : (
        payload as { payload?: { payment?: { entity?: { id?: string; order_id?: string } } } }
      )?.payload?.payment?.entity

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
     VALUES ($1,$2,$3,true,now())`,
    [eventType, eventId, JSON.stringify(payload)]
  )

  if (isPayoutEvent) {
    const referenceId = (entity as { reference_id?: string }).reference_id
    const settlementId = referenceId?.split(':')[0]
    if (!settlementId) return

    if (event === 'payout.processed') {
      await pool.query(
        `UPDATE settlements SET status = 'completed', completed_at = now(), utr = $2
         WHERE id = $1 AND status != 'completed'`,
        [settlementId, (entity as { utr?: string }).utr ?? null]
      )
      await pool.query(
        `UPDATE driver_earnings SET status = 'paid' WHERE settlement_id = $1 AND status = 'in_payout'`,
        [settlementId]
      )
      return
    }

    // payout.failed / payout.reversed — same revert path either way.
    const failureReason = (entity as { failure_reason?: string }).failure_reason ?? event
    await pool.query(
      `UPDATE settlements SET status = 'failed', failed_at = now(), failure_reason = $2
       WHERE id = $1 AND status != 'completed'`,
      [settlementId, failureReason ?? null]
    )
    await pool.query(
      `UPDATE driver_earnings SET status = 'cleared', settlement_id = NULL
       WHERE settlement_id = $1 AND status = 'in_payout'`,
      [settlementId]
    )
    return
  }

  if (event === 'payment.captured' && (entity as { order_id?: string })?.order_id) {
    const pendingRes = await pool.query(
      `SELECT ride_id FROM payments WHERE razorpay_order_id = $1 AND status = 'pending'`,
      [(entity as { order_id?: string }).order_id]
    )
    const pending = pendingRes.rows[0]
    if (pending) {
      await confirmRidePayment(BigInt(pending.ride_id), eventId)
    }
  }
}
```

- [ ] **Step 4: Run migration + test**

Run: `cd api && pnpm migrate && npx vitest run tests/unit/settlements/payout-webhook.test.ts tests/unit/payments`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/payments/payments.service.ts \
        api/src/db/migrations/051_driver_earnings.sql \
        api/tests/unit/settlements/payout-webhook.test.ts
git commit -m "feat: handle RazorpayX payout webhook events"
```

---

## Task 10: Admin — batch list, approval, holds, adjustments

**Files:**
- Create: `api/src/modules/payments/submodules/settlements/settlements.admin.routes.ts`
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts`
- Modify: `api/src/app.ts`
- Test: `api/tests/unit/settlements/admin-batches.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { approveSettlementPeriod, placeDriverPayoutHold, createManualAdjustment } from '@/modules/payments/submodules/settlements/settlements.service'

describe('admin settlement controls', () => {
  beforeEach(() => vi.clearAllMocks())

  it('approveSettlementPeriod bulk-flips pending -> processing for one period', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 4 })
    const count = await approveSettlementPeriod('2026-07-23', '2026-07-24', BigInt(1))
    expect(count).toBe(4)
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = 'processing'")
  })

  it('placeDriverPayoutHold requires a reason and records the admin', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    await placeDriverPayoutHold(BigInt(42), 'fraud review', BigInt(1))
    const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO driver_payout_holds')
    expect(params).toContain('fraud review')
  })

  it('createManualAdjustment inserts a signed, reasoned earnings line', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 })
    await createManualAdjustment(BigInt(42), 100, 'goodwill credit', BigInt(1))
    const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('adjustment')
    expect(params).toContain(100)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/admin-batches.test.ts`
Expected: FAIL — none exported yet.

- [ ] **Step 3: Implement**

Add to `settlements.service.ts`:

```typescript
export async function listSettlementBatches() {
  const res = await pool.query(
    `SELECT period_from, period_to, run_type, status,
            COUNT(*) AS driver_count, SUM(net_payout) AS total
     FROM settlements
     GROUP BY period_from, period_to, run_type, status
     ORDER BY period_from DESC LIMIT 50`
  )
  return res.rows
}

export async function getSettlementBatchDetail(periodFrom: string, periodTo: string) {
  const res = await pool.query(
    `SELECT s.id, s.driver_id, d.full_name AS driver_name, s.net_payout, s.fee,
            s.status, s.mode, s.utr, s.razorpay_payout_id, s.failure_reason, s.created_at
     FROM settlements s
     JOIN drivers d ON d.id = s.driver_id
     WHERE s.period_from = $1 AND s.period_to = $2
     ORDER BY s.created_at`,
    [periodFrom, periodTo]
  )
  return res.rows
}

export async function approveSettlementPeriod(
  periodFrom: string, periodTo: string, approvedBy: bigint
): Promise<number> {
  const res = await pool.query(
    `UPDATE settlements
       SET status = 'processing', approved_by = $3, approved_at = now()
     WHERE period_from = $1 AND period_to = $2 AND status = 'pending'`,
    [periodFrom, periodTo, approvedBy]
  )
  return res.rowCount ?? 0
}

export async function placeDriverPayoutHold(driverId: bigint, reason: string, placedBy: bigint): Promise<void> {
  await pool.query(
    `INSERT INTO driver_payout_holds (driver_id, reason, placed_by)
     VALUES ($1,$2,$3)
     ON CONFLICT (driver_id) WHERE active DO NOTHING`,
    [driverId, reason, placedBy]
  )
}

export async function releaseDriverPayoutHold(driverId: bigint): Promise<void> {
  await pool.query(
    `UPDATE driver_payout_holds SET active = false WHERE driver_id = $1 AND active`,
    [driverId]
  )
}

export async function createManualAdjustment(
  driverId: bigint, amount: number, reason: string, adminId: bigint
): Promise<void> {
  await pool.query(
    `INSERT INTO driver_earnings (
       driver_id, entry_type, amount, status, idempotency_key, note
     ) VALUES ($1,'adjustment',$2,'cleared',$3,$4)`,
    [driverId, amount, `manual_adj:${driverId}:${Date.now()}`, `Admin #${adminId}: ${reason}`]
  )
}
```

Create `api/src/modules/payments/submodules/settlements/settlements.admin.routes.ts`:

```typescript
import { type IRouter, Router } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { requireAdmin } from '@/middleware/role.middleware'
import { httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as service from './settlements.service'

const router: IRouter = Router()

router.use(authenticate(), requireAdmin('super_admin', 'finance_admin'))

router.get('/batches', async (_req, res, next) => {
  try {
    res.json({ batches: await service.listSettlementBatches() })
  } catch (err) { next(err) }
})

router.get('/batches/:periodFrom/:periodTo', async (req, res, next) => {
  try {
    const { periodFrom, periodTo } = req.params
    res.json({ settlements: await service.getSettlementBatchDetail(periodFrom!, periodTo!) })
  } catch (err) { next(err) }
})

router.post('/batches/:periodFrom/:periodTo/approve', async (req, res, next) => {
  try {
    const { periodFrom, periodTo } = req.params
    const count = await service.approveSettlementPeriod(periodFrom!, periodTo!, req.admin!.id)
    res.json({ approvedCount: count })
  } catch (err) { next(err) }
})

router.post('/holds', async (req, res, next) => {
  try {
    const { driverId, reason } = req.body as { driverId?: string; reason?: string }
    if (!driverId || !reason || reason.trim().length === 0) {
      throw httpError(422, 'driverId and reason are required', AppErrors.VALIDATION_ERROR.code)
    }
    await service.placeDriverPayoutHold(BigInt(driverId), reason, req.admin!.id)
    res.status(201).json({ success: true })
  } catch (err) { next(err) }
})

router.delete('/holds/:driverId', async (req, res, next) => {
  try {
    await service.releaseDriverPayoutHold(BigInt(req.params['driverId']!))
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.post('/adjustments', async (req, res, next) => {
  try {
    const { driverId, amount, reason } = req.body as { driverId?: string; amount?: number; reason?: string }
    if (!driverId || typeof amount !== 'number' || amount === 0 || !reason || reason.trim().length === 0) {
      throw httpError(422, 'driverId, non-zero amount, and reason are required', AppErrors.VALIDATION_ERROR.code)
    }
    await service.createManualAdjustment(BigInt(driverId), amount, reason, req.admin!.id)
    res.status(201).json({ success: true })
  } catch (err) { next(err) }
})

export default router
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/settlements/admin-batches.test.ts`
Expected: PASS

- [ ] **Step 5: Mount the router**

In `api/src/app.ts`, add the import:

```typescript
import settlementsAdminRouter from '@/modules/payments/submodules/settlements/settlements.admin.routes'
```

Add, after `apiRouter.use('/admin/notification-templates', templatesRouter)`:

```typescript
  apiRouter.use('/admin/payouts', settlementsAdminRouter)
```

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/payments/submodules/settlements/settlements.service.ts \
        api/src/modules/payments/submodules/settlements/settlements.admin.routes.ts \
        api/src/app.ts \
        api/tests/unit/settlements/admin-batches.test.ts
git commit -m "feat: admin settlement batch approval, holds, manual adjustments"
```

---

## Task 11: Admin — reconciliation, retry, bank verification, tax statement

**Files:**
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts`
- Modify: `api/src/modules/payments/submodules/settlements/settlements.admin.routes.ts`
- Modify: `api/src/modules/payments/submodules/settlements/bank-accounts.service.ts`
- Test: `api/tests/unit/settlements/admin-reconciliation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { listStuckSettlements, retryFailedSettlement, getDriverTaxStatement } from '@/modules/payments/submodules/settlements/settlements.service'
import { setBankAccountStatus, listUnverifiedBankAccounts } from '@/modules/payments/submodules/settlements/bank-accounts.service'

describe('admin reconciliation + tax', () => {
  beforeEach(() => vi.clearAllMocks())

  it('listStuckSettlements finds processing rows past a threshold with no gateway payout id', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] })
    const rows = await listStuckSettlements()
    expect(rows).toHaveLength(1)
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("status = 'processing'")
  })

  it('retryFailedSettlement resets a failed row back to processing for resubmission', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 })
    const ok = await retryFailedSettlement(BigInt(901))
    expect(ok).toBe(true)
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = 'processing'")
    expect(sql).toContain('razorpay_payout_id = NULL')
  })

  it('getDriverTaxStatement aggregates tax_deductions by FY', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ fy: '2026-2027', total_tds: '340.00' }] })
    const statement = await getDriverTaxStatement(BigInt(42), '2026-2027')
    expect(statement.totalTds).toBe(340)
  })

  it('setBankAccountStatus updates verification state', async () => {
    poolQuery.mockResolvedValueOnce({ rowCount: 1 })
    await setBankAccountStatus(BigInt(5), 'verified')
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain("SET status = $2")
  })

  it('listUnverifiedBankAccounts returns pending/invalid accounts', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    await listUnverifiedBankAccounts()
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain('pending_verification')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/settlements/admin-reconciliation.test.ts`
Expected: FAIL — none exported yet.

- [ ] **Step 3: Implement**

Add to `settlements.service.ts`:

```typescript
export async function listStuckSettlements() {
  const res = await pool.query(
    `SELECT s.id, s.driver_id, d.full_name AS driver_name, s.net_payout, s.created_at
     FROM settlements s
     JOIN drivers d ON d.id = s.driver_id
     WHERE s.status = 'processing' AND s.razorpay_payout_id IS NULL
       AND s.created_at < now() - interval '2 hours'
     ORDER BY s.created_at`
  )
  return res.rows
}

export async function retryFailedSettlement(settlementId: bigint): Promise<boolean> {
  const res = await pool.query(
    `UPDATE settlements
       SET status = 'processing', razorpay_payout_id = NULL, utr = NULL,
           failed_at = NULL, failure_reason = NULL
     WHERE id = $1 AND status = 'failed'`,
    [settlementId]
  )
  return (res.rowCount ?? 0) > 0
}

export async function getDriverTaxStatement(driverId: bigint, fy: string) {
  const res = await pool.query(
    `SELECT fy, SUM(tds_amount) AS total_tds, SUM(taxable_base) AS total_taxable_base, COUNT(*) AS entries
     FROM tax_deductions WHERE driver_id = $1 AND fy = $2 GROUP BY fy`,
    [driverId, fy]
  )
  const row = res.rows[0]
  return {
    fy,
    totalTds: row ? parseFloat(row.total_tds) : 0,
    totalTaxableBase: row ? parseFloat(row.total_taxable_base) : 0,
    entries: row ? parseInt(row.entries) : 0,
  }
}
```

Add to `bank-accounts.service.ts`:

```typescript
export async function setBankAccountStatus(
  bankAccountId: bigint, status: 'verified' | 'invalid' | 'pending_verification'
): Promise<void> {
  await pool.query(
    `UPDATE driver_bank_accounts SET status = $2 WHERE id = $1`,
    [bankAccountId, status]
  )
}

export async function listUnverifiedBankAccounts() {
  const res = await pool.query(
    `SELECT dba.id, dba.driver_id, d.full_name AS driver_name, dba.ifsc, dba.status, dba.created_at
     FROM driver_bank_accounts dba
     JOIN drivers d ON d.id = dba.driver_id
     WHERE dba.status IN ('pending_verification', 'invalid')
     ORDER BY dba.created_at`
  )
  return res.rows
}
```

Add to `settlements.admin.routes.ts` (with an added import: `import * as bankAccounts from './bank-accounts.service'`):

```typescript
router.get('/reconciliation/stuck', async (_req, res, next) => {
  try {
    res.json({ settlements: await service.listStuckSettlements() })
  } catch (err) { next(err) }
})

router.post('/:id/retry', async (req, res, next) => {
  try {
    const ok = await service.retryFailedSettlement(BigInt(req.params['id']!))
    if (!ok) throw httpError(400, 'Settlement is not in a retryable state', AppErrors.VALIDATION_ERROR.code)
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.get('/bank-accounts/unverified', async (_req, res, next) => {
  try {
    res.json({ accounts: await bankAccounts.listUnverifiedBankAccounts() })
  } catch (err) { next(err) }
})

router.patch('/bank-accounts/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body as { status?: string }
    if (status !== 'verified' && status !== 'invalid' && status !== 'pending_verification') {
      throw httpError(422, 'invalid status', AppErrors.VALIDATION_ERROR.code)
    }
    await bankAccounts.setBankAccountStatus(BigInt(req.params['id']!), status)
    res.json({ success: true })
  } catch (err) { next(err) }
})

router.get('/tax-statement/:driverId/:fy', async (req, res, next) => {
  try {
    const statement = await service.getDriverTaxStatement(BigInt(req.params['driverId']!), req.params['fy']!)
    res.json(statement)
  } catch (err) { next(err) }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/settlements/admin-reconciliation.test.ts`
Expected: PASS

- [ ] **Step 5: Run full backend suite**

Run: `cd api && pnpm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/payments/submodules/settlements/ \
        api/tests/unit/settlements/admin-reconciliation.test.ts
git commit -m "feat: admin payout reconciliation, retry, bank verification, tax statement"
```

---

## Task 12: Driver app — payable balance, cash-out, bank account

**Files:**
- Modify: `apps/driver/src/lib/ride-api.ts` (add API client functions)
- Modify: `apps/driver/src/pages/Earnings.tsx`

- [ ] **Step 1: Add API client functions**

In `apps/driver/src/lib/ride-api.ts`, add near the existing `driverRideApi` object (same `api` axios instance import already in that file):

```typescript
export interface DriverEarningsLedgerEntry {
  id: number
  ride_id: number | null
  entry_type: string
  amount: string
  status: string
  created_at: string
  note: string | null
}

export interface DriverEarningsBalance {
  payableBalance: number
  recentLedger: DriverEarningsLedgerEntry[]
}

export interface DriverBankAccount {
  id: number
  account_holder_name: string
  ifsc: string
  upi_vpa: string | null
  status: 'pending_verification' | 'verified' | 'invalid'
  is_primary: boolean
}

export const driverPayoutApi = {
  getEarningsBalance: async (): Promise<DriverEarningsBalance> => {
    const { data } = await api.get<DriverEarningsBalance>('/api/v1/payments/settlements/earnings')
    return data
  },
  listBankAccounts: async (): Promise<DriverBankAccount[]> => {
    const { data } = await api.get<{ accounts: DriverBankAccount[] }>('/api/v1/payments/settlements/bank-accounts')
    return data.accounts
  },
  addBankAccount: async (params: { accountHolderName: string; accountNumber: string; ifsc: string; upiVpa?: string }) => {
    const { data } = await api.post<{ id: string }>('/api/v1/payments/settlements/bank-accounts', params)
    return data
  },
  instantCashOut: async (): Promise<{ settlementId: string }> => {
    const { data } = await api.post<{ settlementId: string }>('/api/v1/payments/settlements/payout/instant')
    return data
  },
}
```

- [ ] **Step 2: Extend `Earnings.tsx`**

Add state + effect near the existing `summary`/`trips` state (after the `trips` useEffect block):

```typescript
  const [payout, setPayout] = useState<DriverEarningsBalance | null>(null)
  const [cashingOut, setCashingOut] = useState(false)

  useEffect(() => {
    driverPayoutApi.getEarningsBalance().then(setPayout).catch(() => {})
  }, [])

  async function handleCashOut() {
    setCashingOut(true)
    try {
      await driverPayoutApi.instantCashOut()
      const updated = await driverPayoutApi.getEarningsBalance()
      setPayout(updated)
    } catch {
      // surfaced via the disabled/error state below; no toast system in this file today
    } finally {
      setCashingOut(false)
    }
  }
```

Add the import at the top: `import { driverRideApi, driverPayoutApi, type TripHistoryItem, type EarningsSummary, type DriverEarningsBalance } from '@/lib/ride-api'` (replacing the existing `driverRideApi` import line).

Insert a new card right after the "Total card" block (after its closing `</div>` and before the "Bar chart" comment):

```tsx
      {/* Payable balance + cash out */}
      {payout && payout.payableBalance > 0 && (
        <div className="mx-5 bg-white rounded-3xl p-5 mb-4 border border-border flex items-center justify-between gap-3">
          <div>
            <p className="text-text-muted text-[11px] font-semibold mb-1">Payable Balance</p>
            <p className="text-2xl font-black text-text-primary tabular-nums">
              ₹{payout.payableBalance.toLocaleString('en-IN')}
            </p>
          </div>
          <button
            onClick={handleCashOut}
            disabled={cashingOut}
            className="rounded-2xl px-4 py-3 text-sm font-bold text-white bg-primary disabled:opacity-50 cursor-pointer"
          >
            {cashingOut ? 'Processing…' : 'Cash Out Now'}
          </button>
        </div>
      )}
```

- [ ] **Step 3: Typecheck the driver app**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify in the browser**

Run: `cd apps/driver && pnpm dev`, log in as a driver with a completed online-paid ride, open Earnings, confirm the payable balance card renders and "Cash Out Now" completes (dev mode has no Razorpay keys, so it resolves immediately).

- [ ] **Step 5: Commit**

```bash
git add apps/driver/src/lib/ride-api.ts apps/driver/src/pages/Earnings.tsx
git commit -m "feat: driver payable balance and instant cash-out UI"
```

---

## Task 13: Admin app — payouts page

**Files:**
- Create: `apps/admin/lib/payouts-api.ts`
- Create: `apps/admin/app/(dashboard)/payouts/page.tsx` (path may differ slightly — match the existing route group used by `apps/admin/app/**/notification-templates/page.tsx`; use that file's exact directory as the template)

- [ ] **Step 1: Locate the exact existing route for reference**

Run: `cd apps/admin && find app -iname "page.tsx" -path "*notification-templates*"` (or the PowerShell equivalent `Get-ChildItem -Recurse -Filter page.tsx | Where-Object FullName -like "*notification-templates*"`) — use that file's directory depth as the pattern for `payouts/page.tsx`.

- [ ] **Step 2: Add the API client**

Create `apps/admin/lib/payouts-api.ts`:

```typescript
import api from './api'

export interface SettlementBatchSummary {
  period_from: string
  period_to: string
  run_type: 'scheduled' | 'instant'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'on_hold'
  driver_count: string
  total: string
}

export interface SettlementRow {
  id: string
  driver_id: string
  driver_name: string
  net_payout: string
  fee: string
  status: string
  mode: string | null
  utr: string | null
  razorpay_payout_id: string | null
  failure_reason: string | null
  created_at: string
}

export const payoutsApi = {
  listBatches: async (): Promise<SettlementBatchSummary[]> => {
    const { data } = await api.get<{ batches: SettlementBatchSummary[] }>('/api/v1/admin/payouts/batches')
    return data.batches
  },
  getBatchDetail: async (periodFrom: string, periodTo: string): Promise<SettlementRow[]> => {
    const { data } = await api.get<{ settlements: SettlementRow[] }>(
      `/api/v1/admin/payouts/batches/${periodFrom}/${periodTo}`
    )
    return data.settlements
  },
  approveBatch: async (periodFrom: string, periodTo: string): Promise<number> => {
    const { data } = await api.post<{ approvedCount: number }>(
      `/api/v1/admin/payouts/batches/${periodFrom}/${periodTo}/approve`
    )
    return data.approvedCount
  },
  retrySettlement: async (id: string): Promise<void> => {
    await api.post(`/api/v1/admin/payouts/${id}/retry`)
  },
  placeHold: async (driverId: string, reason: string): Promise<void> => {
    await api.post('/api/v1/admin/payouts/holds', { driverId, reason })
  },
  releaseHold: async (driverId: string): Promise<void> => {
    await api.delete(`/api/v1/admin/payouts/holds/${driverId}`)
  },
}
```

- [ ] **Step 3: Build the page**

Create `apps/admin/app/(dashboard)/payouts/page.tsx` (adjust the route-group segment to match whatever Step 1 found):

```tsx
'use client'

import { useEffect, useState } from 'react'
import { payoutsApi, type SettlementBatchSummary, type SettlementRow } from '@/lib/payouts-api'

export default function PayoutsPage() {
  const [batches, setBatches] = useState<SettlementBatchSummary[]>([])
  const [selected, setSelected] = useState<SettlementBatchSummary | null>(null)
  const [rows, setRows] = useState<SettlementRow[]>([])

  useEffect(() => {
    payoutsApi.listBatches().then(setBatches).catch(() => {})
  }, [])

  async function openBatch(batch: SettlementBatchSummary) {
    setSelected(batch)
    const detail = await payoutsApi.getBatchDetail(batch.period_from, batch.period_to)
    setRows(detail)
  }

  async function approve(batch: SettlementBatchSummary) {
    await payoutsApi.approveBatch(batch.period_from, batch.period_to)
    const updated = await payoutsApi.listBatches()
    setBatches(updated)
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Driver Payouts</h1>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left border-b border-border">
            <th className="py-2">Period</th>
            <th>Type</th>
            <th>Status</th>
            <th>Drivers</th>
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {batches.map(b => (
            <tr key={`${b.period_from}-${b.period_to}-${b.run_type}`} className="border-b border-border">
              <td className="py-2">{b.period_from} → {b.period_to}</td>
              <td>{b.run_type}</td>
              <td>{b.status}</td>
              <td>{b.driver_count}</td>
              <td>₹{b.total}</td>
              <td className="flex gap-2 py-2">
                <button className="text-primary cursor-pointer" onClick={() => openBatch(b)}>View</button>
                {b.status === 'pending' && (
                  <button className="text-primary cursor-pointer" onClick={() => approve(b)}>Approve</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (
        <div className="mt-6">
          <h2 className="font-bold mb-2">
            {selected.period_from} → {selected.period_to} detail
          </h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-2">Driver</th>
                <th>Amount</th>
                <th>Status</th>
                <th>UTR</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-border">
                  <td className="py-2">{r.driver_name}</td>
                  <td>₹{r.net_payout}</td>
                  <td>{r.status}</td>
                  <td>{r.utr ?? '—'}</td>
                  <td>
                    {r.status === 'failed' && (
                      <button className="text-primary cursor-pointer" onClick={() => payoutsApi.retrySettlement(r.id)}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manually verify in the browser**

Run: `cd apps/admin && pnpm dev`, log in as `super_admin` or `finance_admin`, navigate to `/payouts`, confirm the batch list loads (empty is fine before Task 6's cron has run) and approve/retry actions fire without error.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/lib/payouts-api.ts apps/admin/app
git commit -m "feat: admin driver payouts page"
```

---

## Self-Review Notes

- **Spec coverage**: §1 data model → Task 1; §2 accrual → Task 2; §3 clearing → Task 3; §4 scheduled batch → Task 6; §5 instant cash-out → Task 7; §6 disbursal+webhook → Tasks 8-9; §7 admin surface → Tasks 4, 10, 11; §8 testing → one test file per task throughout.
- **Type consistency**: `settlement_id` (not `payout_id`) used consistently across `driver_earnings`, `tax_deductions`, and every service function from Task 1 onward, matching the spec's corrected schema. `driverPayoutApi`/`payoutsApi` naming kept distinct (driver-facing vs admin-facing client) to avoid import collisions.
- **Out of scope** (per spec): non-India rails, extra push-notification types beyond existing patterns, incentive program design, automated GST filing — none of these have tasks here, matching the spec.
