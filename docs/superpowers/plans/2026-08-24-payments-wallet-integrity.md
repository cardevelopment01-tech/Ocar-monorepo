# Payments & Wallet Integrity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four payments/wallet/commission correctness gaps from §04 of the 2026-08-24 security-hardening design: no debt recovery on top-up (§04.1), non-atomic ride settlement (§04.2), uncapped refunds (§04.3), and gateway error-body leakage in settlements (§04.4).

**Architecture:** Four independent changes inside the payments module (plus `disputes.service.ts`'s refund insert). Task B introduces one shared `pool.connect()`/`BEGIN`/`COMMIT` transaction across the settlement steps by giving `deductCommission`/`creditCashback`/`accrueDriverEarning` an **optional `client` parameter** — when a caller passes its own client the function joins that transaction and skips its own `BEGIN`/`COMMIT`/`release`; when omitted it self-manages exactly as today (so every existing standalone caller is unaffected). Tasks A, C reuse the existing `FOR UPDATE` row-lock pattern. Task D adds a `failure_code` column and a static code map, keeping raw gateway detail in Pino logs only.

**Tech Stack:** Express + TypeScript 5 (`exactOptionalPropertyTypes: true`), `pg` Pool/PoolClient, Vitest (mocked pool, no live DB in unit tests), raw SQL migrations run via `pnpm migrate`.

---

## Scope & Cross-Cutting Notes (read once before starting)

- **Exclusive scope:** `api/src/modules/payments/**` (incl. `submodules/settlements/**`), `api/src/modules/safety/disputes.service.ts` (refund logic only), and new migrations under `api/src/db/migrations/`. Do **not** edit files outside this set — other agents are editing rides/OTP/docs/safety/fare in parallel.
- **`consumePackageBalance` is out of scope** — it lives in `api/src/modules/packages/packages.service.ts` (packages module), so Task B cannot thread a shared client through it. Commission-mode settlement (the dominant path and the exact one §04.2 describes) becomes fully atomic; the package-mode `consumePackageBalance` sub-step keeps its own transaction, called *inside* `confirmRidePayment`'s try block *before* the shared `COMMIT` so a consume failure still rolls back the status flip. This residual is marked with a `ponytail:` comment and left as a follow-up.
- **Migration numbering:** highest existing migration is `090_document_expiry_notification_templates.sql`. This plan adds exactly **one** migration, `091_settlement_failure_code.sql` (Task D). Task C needs **no** migration — the `CHECK (amount > 0)` the design proposes **already exists** on `refunds.amount` (`008_m6_payments.sql:99`, inline, auto-named `refunds_amount_check`). If `091` is already taken by a parallel plan at execution time, bump to the next free number and keep the same body.
- **Error style:** `disputes.service.ts` uses `throw Object.assign(new Error('msg'), { httpStatus, code })`; `settlements.service.ts` uses `httpError(status, msg, code)` from `@/lib/errors`. Match the local file's style in each task.
- **Test command shape:** all unit tests are `pool`-mocked. Run a single file with `cd api && npx vitest run <relative-path>`. Run the whole affected suite with `cd api && npx vitest run tests/unit/payments tests/unit/settlements tests/unit/safety`.
- After each task's implementation lands, `graphify update .` keeps the code graph current (AST-only, no API cost) — included as the last action of each commit step.

---

## File Structure

**Modified:**
- `api/src/modules/payments/payments.service.ts` — `topUpDriverWallet` (Task A), `deductCommission` + `creditCashback` + `confirmRidePayment` (Task B), `handleWebhookEvent` payout-failed path (Task D).
- `api/src/modules/payments/submodules/settlements/settlements.service.ts` — `accrueDriverEarning` optional client (Task B), `FAILURE_CODE_MAP` + `mapPayoutFailureCode` + `submitSettlementRow` catch + `getSettlementBatchDetail` SELECT (Task D).
- `api/src/modules/safety/disputes.service.ts` — refund-cap validation in `resolveDispute` (Task C).

**Created:**
- `api/src/db/migrations/091_settlement_failure_code.sql` (Task D).
- `api/tests/unit/safety/resolve-dispute.test.ts` (Task C — no resolve-dispute test exists yet).
- `api/tests/unit/settlements/settlement-failure-code.test.ts` (Task D).

**Tests rewritten (Task B changes the transaction shape they assert on):**
- `api/tests/unit/payments/confirm-ride-payment.test.ts`
- `api/tests/unit/payments/settle-package-mode-ride.test.ts`
- `api/tests/unit/payments/topup-driver-wallet.test.ts` (Task A — add cases)
- `api/tests/unit/settlements/submit-processing-settlements.test.ts` (Task D — one assertion)

---

## Task A: Debt-first allocation on driver wallet top-up (§04.1)

**Context:** `driver_wallets.balance` is a single **signed** `NUMERIC` (migration `064` dropped the `>= 0` CHECK; negative = dues owed to the platform). `topUpDriverWallet` already computes `newBalance = balance + amount`, which *mathematically already* clears debt first before any remainder is spendable. The gap §04.1 wants closed is that this debt-clearing is **invisible in the ledger** — a driver, ops, or an auditor can't see that ₹200 of a ₹500 top-up went to arrears. This task makes the split explicit and auditable in the ledger note and adds regression tests locking the debt-first math with concrete numbers. No migration, no balance-math change, no new enum value (reuses the existing `'topup'` entry type).

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts` (`topUpDriverWallet`, ~L537-600)
- Test: `api/tests/unit/payments/topup-driver-wallet.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these two cases inside the existing `describe('topUpDriverWallet', ...)` block in `api/tests/unit/payments/topup-driver-wallet.test.ts` (the file already defines `scriptTopup(balance, existingDupe)` and the `client` mock):

```typescript
  it('negative balance: top-up clears debt first, only the remainder is spendable, split shown in ledger note', async () => {
    scriptTopup('-200.00', false) // driver owes ₹200
    await topUpDriverWallet(BigInt(42), 500, 'pay_debt')

    const ledgerCall = client.query.mock.calls.find(c => (c[0] as string).includes('driver_wallet_ledger'))
    expect(ledgerCall, 'expected a driver_wallet_ledger insert').toBeDefined()
    const params = ledgerCall![1] as unknown[]
    // balance_after = -200 + 500 = 300 — the spendable remainder after clearing ₹200 dues
    expect(params[3]).toBe(300)
    // note documents the debt-first split: ₹200 cleared, ₹300 spendable
    const note = params[5] as string
    expect(note).toContain('200')
    expect(note).toContain('300')

    const updateCall = client.query.mock.calls.find(c => (c[0] as string).includes('UPDATE driver_wallets'))
    expect((updateCall![1] as unknown[])[1]).toBe(300)
  })

  it('positive balance: full amount spendable, plain top-up note (no debt-clearing text)', async () => {
    scriptTopup('100.00', false)
    await topUpDriverWallet(BigInt(42), 500, 'pay_pos')

    const ledgerCall = client.query.mock.calls.find(c => (c[0] as string).includes('driver_wallet_ledger'))
    const params = ledgerCall![1] as unknown[]
    expect(params[3]).toBe(600) // 100 + 500
    expect(params[5] as string).toBe('Wallet top-up via Razorpay')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/unit/payments/topup-driver-wallet.test.ts`
Expected: FAIL — the negative-balance case fails on `expect(note).toContain('200')` because the current ledger note is the hardcoded `'Wallet top-up via Razorpay'` (the note is not yet parameterized).

- [ ] **Step 3: Implement debt-first allocation in `topUpDriverWallet`**

In `api/src/modules/payments/payments.service.ts`, replace the balance computation and the ledger INSERT inside `topUpDriverWallet`. Change this block:

```typescript
    const newBalance = Math.round((parseFloat(wallet.balance) + amount) * 100) / 100

    await client.query(
      `UPDATE driver_wallets
       SET balance = $2,
           lifetime_topup = lifetime_topup + $3
       WHERE id = $1`,
      [wallet.id, newBalance, amount]
    )

    await client.query(
      `INSERT INTO driver_wallet_ledger (
         wallet_id, driver_id, entry_type,
         amount, direction, balance_after, reference_id, note
       ) VALUES ($1,$2,'topup',$3,'credit',$4,$5,'Wallet top-up via Razorpay')`,
      [wallet.id, driverId, amount, newBalance, referenceId]
    )
```

to:

```typescript
    const prevBalance = parseFloat(wallet.balance)
    const newBalance = Math.round((prevBalance + amount) * 100) / 100

    // Debt-first allocation: a negative balance means the driver owes the
    // platform (dues). balance is a single signed column, so `prevBalance + amount`
    // already zeroes the debt before any remainder becomes spendable — this makes
    // that split explicit and auditable in the ledger note instead of hiding it.
    const debtCleared = prevBalance < 0 ? Math.min(amount, -prevBalance) : 0
    const spendable = Math.round((amount - debtCleared) * 100) / 100
    const note = debtCleared > 0
      ? `Wallet top-up ₹${amount} via Razorpay (₹${debtCleared} cleared dues, ₹${spendable} spendable)`
      : 'Wallet top-up via Razorpay'

    await client.query(
      `UPDATE driver_wallets
       SET balance = $2,
           lifetime_topup = lifetime_topup + $3
       WHERE id = $1`,
      [wallet.id, newBalance, amount]
    )

    await client.query(
      `INSERT INTO driver_wallet_ledger (
         wallet_id, driver_id, entry_type,
         amount, direction, balance_after, reference_id, note
       ) VALUES ($1,$2,'topup',$3,'credit',$4,$5,$6)`,
      [wallet.id, driverId, amount, newBalance, referenceId, note]
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/unit/payments/topup-driver-wallet.test.ts`
Expected: PASS — all four cases (2 existing + 2 new) green.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/payments/payments.service.ts api/tests/unit/payments/topup-driver-wallet.test.ts
git commit -m "fix(payments): make debt-first wallet top-up allocation explicit in the ledger"
graphify update .
```

---

## Task B: Atomic ride settlement transaction (§04.2)

**Context:** `confirmRidePayment` (payments.service.ts:239) flips `payments.status` pending→completed with a standalone `pool.query`, then calls `deductCommission` / `accrueDriverEarning` / `creditCashback`, **each opening its own `pool.connect()` transaction**. A crash between steps leaves the payment `completed` but earnings/cashback unwritten, with no reconciliation. This task wraps the status flip + the three commission-path steps in **one** transaction, so a rollback un-flips the status and the ride re-enters settlement on retry — where the existing `WHERE status = 'pending'` guard makes the retry a correct single-application, not a no-op past half-applied state.

**Approach:** give `deductCommission`, `creditCashback`, and `accrueDriverEarning` an optional trailing `sharedClient?: PoolClient` parameter. When present, the function runs its writes on that client and does **not** issue `BEGIN`/`COMMIT`/`ROLLBACK` or `release` (the caller owns the transaction). When absent, behavior is byte-for-byte the current self-managed transaction, so every existing standalone caller (`collectCash`, `settleRideCompletionPayment`, retry/webhook paths, and the standalone unit tests) is unaffected. `deductCommission`'s low-balance notify must fire **after** the outer commit, so in shared mode it returns the crossing info to the caller instead of notifying itself.

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts` (`deductCommission` ~L81-169, `creditCashback` ~L173-232, `confirmRidePayment` ~L239-278; add `PoolClient` import)
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts` (`accrueDriverEarning` ~L24-91; add `PoolClient` import)
- Test: `api/tests/unit/payments/confirm-ride-payment.test.ts` (rewrite), `api/tests/unit/payments/settle-package-mode-ride.test.ts` (rewrite)

- [ ] **Step 1: Add the optional-client parameter to `deductCommission`**

In `api/src/modules/payments/payments.service.ts`, add the `pg` type import near the top (after the existing imports):

```typescript
import type { PoolClient } from 'pg'
```

Then replace the entire `deductCommission` function with:

```typescript
export async function deductCommission(
  rideId: bigint,
  driverId: bigint,
  sharedClient?: PoolClient
): Promise<{ newBalance: number } | null> {
  const payRes = await pool.query(
    `SELECT commission_amount FROM payments WHERE ride_id = $1`,
    [rideId]
  )
  const payment = payRes.rows[0]
  if (!payment) return null

  const commission = parseFloat(payment.commission_amount)
  const minBalance = await getMinWalletBalance()

  const client = sharedClient ?? await pool.connect()
  const owns = !sharedClient
  try {
    if (owns) await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_wallets (driver_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (driver_id) DO NOTHING`,
      [driverId]
    )

    const walletRes = await client.query(
      `SELECT id, balance, is_frozen
       FROM driver_wallets
       WHERE driver_id = $1
       FOR UPDATE`,
      [driverId]
    )

    const wallet = walletRes.rows[0]
    if (!wallet || wallet.is_frozen) {
      if (owns) await client.query('ROLLBACK')
      return null
    }

    const currentBalance = parseFloat(wallet.balance)
    // Signed balance: negative = driver owes the platform (cash dues).
    const newBalance = Math.round((currentBalance - commission) * 100) / 100

    await client.query(
      `UPDATE driver_wallets
       SET balance = $2,
           lifetime_commission = lifetime_commission + $3
       WHERE id = $1`,
      [wallet.id, newBalance, commission]
    )

    await client.query(
      `INSERT INTO driver_wallet_ledger (
         wallet_id, driver_id, entry_type,
         amount, direction, balance_after,
         ride_id, note
       ) VALUES ($1,$2,'commission_debit',$3,'debit',$4,$5,$6)`,
      [
        wallet.id, driverId, commission,
        newBalance, rideId,
        `Commission ₹${commission} for ride #${rideId}`,
      ]
    )

    const justCrossedBelowMin = currentBalance >= minBalance && newBalance < minBalance

    if (owns) {
      await client.query('COMMIT')
      if (justCrossedBelowMin) {
        try {
          await notifyDriverLowWalletBalance(driverId, newBalance, minBalance)
        } catch (err) {
          log.error({ err }, 'low-balance notify failed')
        }
      }
      return null
    }

    // Shared transaction: the notify must wait until the caller commits, so
    // hand the crossing info back instead of firing it inside an open txn.
    return justCrossedBelowMin ? { newBalance } : null
  } catch (err) {
    if (owns) await client.query('ROLLBACK')
    throw err
  } finally {
    if (owns) (client as PoolClient).release()
  }
}
```

- [ ] **Step 2: Add the optional-client parameter to `creditCashback`**

Replace the entire `creditCashback` function with:

```typescript
export async function creditCashback(
  rideId: bigint,
  userId: bigint,
  fareAmount: number,
  sharedClient?: PoolClient
): Promise<void> {
  const cashbackPct = await getCashbackPercent()
  const cashbackAmt = Math.round(fareAmount * cashbackPct) / 100
  if (cashbackAmt <= 0) return

  const expiryDays = await getCashbackExpiryDays()

  const client = sharedClient ?? await pool.connect()
  const owns = !sharedClient
  try {
    if (owns) await client.query('BEGIN')

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
    const newBalance = Math.round((parseFloat(wallet.balance) + cashbackAmt) * 100) / 100

    await client.query(
      `UPDATE user_wallets
       SET balance = $2,
           lifetime_earned = lifetime_earned + $3
       WHERE id = $1`,
      [wallet.id, newBalance, cashbackAmt]
    )

    await client.query(
      `INSERT INTO user_wallet_ledger (
         wallet_id, user_id, entry_type,
         amount, direction, balance_after,
         ride_id, expires_at, note
       ) VALUES ($1,$2,'cashback',$3,'credit',$4,$5,
         now() + ($6 || ' days')::interval, $7)`,
      [
        wallet.id, userId, cashbackAmt,
        newBalance, rideId, expiryDays,
        `${cashbackPct}% cashback on ride #${rideId}`,
      ]
    )

    if (owns) await client.query('COMMIT')
  } catch (err) {
    if (owns) await client.query('ROLLBACK')
    throw err
  } finally {
    if (owns) (client as PoolClient).release()
  }
}
```

- [ ] **Step 3: Add the optional-client parameter to `accrueDriverEarning`**

In `api/src/modules/payments/submodules/settlements/settlements.service.ts`, add near the top imports:

```typescript
import type { PoolClient } from 'pg'
```

Then change the `accrueDriverEarning` signature and its transaction management. Its read-only pre-computation (payment amount, tax profile, config rates) stays on `pool`; only the write transaction becomes client-aware. Replace the function's signature line and the `const client = await pool.connect()` transaction block:

Change the signature from:
```typescript
export async function accrueDriverEarning(rideId: bigint, driverId: bigint): Promise<void> {
```
to:
```typescript
export async function accrueDriverEarning(rideId: bigint, driverId: bigint, sharedClient?: PoolClient): Promise<void> {
```

Then change the transaction wrapper. Replace:
```typescript
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
```
with:
```typescript
  const client = sharedClient ?? await pool.connect()
  const owns = !sharedClient
  try {
    if (owns) await client.query('BEGIN')
```

and replace the tail of the function:
```typescript
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```
with:
```typescript
    if (owns) await client.query('COMMIT')
  } catch (err) {
    if (owns) await client.query('ROLLBACK')
    throw err
  } finally {
    if (owns) (client as PoolClient).release()
  }
}
```

- [ ] **Step 4: Rewrite `confirmRidePayment` to run one transaction**

Replace the entire `confirmRidePayment` function (payments.service.ts, keep the explanatory comment block above it) with:

```typescript
export async function confirmRidePayment(
  rideId: bigint,
  razorpayPaymentId?: string
): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const params: unknown[] = [rideId]
    let extraSet = ''
    if (razorpayPaymentId !== undefined) {
      params.push(razorpayPaymentId)
      extraSet = ', razorpay_payment_id = $2'
    }

    // The idempotency lock (WHERE status='pending') is now INSIDE the txn: a
    // rollback un-flips the status, so a retried settlement re-enters this
    // guarded UPDATE as 'pending' instead of no-opping past half-applied state.
    const res = await client.query(
      `UPDATE payments
         SET status = 'completed', captured_at = now()${extraSet}
       WHERE ride_id = $1 AND status = 'pending'
       RETURNING driver_id, user_id, amount`,
      params
    )
    if ((res.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK')
      return false
    }
    const row = res.rows[0]

    const rideRes = await client.query<{ billing_mode_snapshot: BillingMode | null }>(
      `SELECT billing_mode_snapshot FROM rides WHERE id = $1`,
      [rideId]
    )
    const billingMode = rideRes.rows[0]?.billing_mode_snapshot ?? 'commission'

    let crossedBelowMin: { newBalance: number } | null = null
    if (billingMode === 'package') {
      // ponytail: consumePackageBalance lives in the packages module (out of this
      // plan's scope) and manages its own connection, so it can't join this txn.
      // It runs before COMMIT so a consume failure still rolls back the status
      // flip and the ride re-enters settlement on retry. Follow-up: thread a
      // shared client through consumePackageBalance to make package mode fully
      // atomic too — commission mode (the else branch) is already fully atomic.
      await packagesService.consumePackageBalance(rideId, BigInt(row.driver_id), parseFloat(row.amount))
    } else {
      crossedBelowMin = await deductCommission(rideId, BigInt(row.driver_id), client)
    }
    await accrueDriverEarning(rideId, BigInt(row.driver_id), client)
    await creditCashback(rideId, BigInt(row.user_id), parseFloat(row.amount), client)

    await client.query('COMMIT')

    if (crossedBelowMin) {
      try {
        const minBalance = await getMinWalletBalance()
        await notifyDriverLowWalletBalance(BigInt(row.driver_id), crossedBelowMin.newBalance, minBalance)
      } catch (err) {
        log.error({ err }, 'low-balance notify failed')
      }
    }
    return true
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 5: Rewrite `confirm-ride-payment.test.ts` for the single-transaction shape**

The old test asserted `pool.connect` was called **twice** (one txn per wallet function) and scripted the status flip on `pool.query`. Both are now wrong — there is one `pool.connect`, and the flip runs on the client. Replace the whole file `api/tests/unit/payments/confirm-ride-payment.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Everything now runs on ONE client transaction. The client mock answers every
// query by SQL shape; pool.query still serves the read-only pre-computation
// (deductCommission's commission_amount SELECT, config reads).
const fakeClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({
  pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) },
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('15') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyDriverLowWalletBalance: vi.fn(),
}))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({
  accrueDriverEarning: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/packages/packages.service', () => ({
  consumePackageBalance: vi.fn().mockResolvedValue(undefined),
}))

import { pool } from '@/db/client'
import { confirmRidePayment } from '@/modules/payments/payments.service'

// Client answers by SQL: the guarded flip, the billing-mode lookup, the wallet
// FOR UPDATE reads, and everything else (BEGIN/INSERT/UPDATE/COMMIT) → generic ok.
function scriptClientHappyPath() {
  fakeClient.query.mockReset()
  fakeClient.query.mockImplementation((sql: string) => {
    if (/UPDATE payments/.test(sql)) {
      return Promise.resolve({ rows: [{ driver_id: '9', user_id: '42', amount: '500.00' }], rowCount: 1 })
    }
    if (/billing_mode_snapshot/.test(sql)) {
      return Promise.resolve({ rows: [{ billing_mode_snapshot: null }], rowCount: 1 })
    }
    if (/SELECT id, balance, is_frozen/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
    }
    if (/SELECT id, balance FROM user_wallets/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 2, balance: '0' }], rowCount: 1 })
    }
    return Promise.resolve({ rows: [], rowCount: 1 })
  })
}

describe('confirmRidePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // pool.query serves deductCommission's commission_amount SELECT.
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ commission_amount: '50.00' }], rowCount: 1 } as never)
  })

  it('already-completed (guarded flip hits 0 rows) → rolls back, returns false, no settlement', async () => {
    fakeClient.query.mockReset()
    fakeClient.query.mockImplementation((sql: string) => {
      if (/UPDATE payments/.test(sql)) return Promise.resolve({ rows: [], rowCount: 0 })
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    const result = await confirmRidePayment(BigInt(101))

    expect(result).toBe(false)
    const calls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(calls.some(s => s.includes('BEGIN'))).toBe(true)
    expect(calls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(calls.some(s => s.includes('COMMIT'))).toBe(false)
    // no wallet writes happened
    expect(calls.some(s => s.includes('driver_wallet_ledger'))).toBe(false)
  })

  it('pending → completed: one transaction, records razorpay_payment_id, commits all four steps', async () => {
    scriptClientHappyPath()

    const result = await confirmRidePayment(BigInt(101), 'pay_abc123')

    expect(result).toBe(true)
    expect(pool.connect).toHaveBeenCalledTimes(1) // ONE shared transaction, not one per step

    const calls = fakeClient.query.mock.calls
    const sqls = calls.map(c => c[0] as string)
    const flip = calls.find(c => (c[0] as string).includes('UPDATE payments'))!
    expect(flip[0] as string).toContain("status = 'pending'")
    expect(flip[0] as string).toContain('razorpay_payment_id')
    expect(flip[1] as unknown[]).toContain('pay_abc123')

    // commission + cashback ledger writes ran on the SAME client, inside BEGIN/COMMIT
    expect(sqls.some(s => s.includes('driver_wallet_ledger'))).toBe(true)
    expect(sqls.some(s => s.includes('user_wallet_ledger'))).toBe(true)
    expect(sqls.filter(s => s.includes('BEGIN')).length).toBe(1)
    expect(sqls.filter(s => s.includes('COMMIT')).length).toBe(1)
    expect(sqls.some(s => s.includes('ROLLBACK'))).toBe(false)
  })

  it('a settlement step throwing rolls the whole transaction back (status flip not left committed)', async () => {
    scriptClientHappyPath()
    // Make the LAST settlement write (cashback ledger) blow up mid-transaction.
    fakeClient.query.mockImplementation((sql: string) => {
      if (/UPDATE payments/.test(sql)) {
        return Promise.resolve({ rows: [{ driver_id: '9', user_id: '42', amount: '500.00' }], rowCount: 1 })
      }
      if (/billing_mode_snapshot/.test(sql)) return Promise.resolve({ rows: [{ billing_mode_snapshot: null }], rowCount: 1 })
      if (/SELECT id, balance, is_frozen/.test(sql)) return Promise.resolve({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
      if (/SELECT id, balance FROM user_wallets/.test(sql)) return Promise.resolve({ rows: [{ id: 2, balance: '0' }], rowCount: 1 })
      if (/INSERT INTO user_wallet_ledger/.test(sql)) return Promise.reject(new Error('db exploded mid-settlement'))
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    await expect(confirmRidePayment(BigInt(101))).rejects.toThrow('db exploded mid-settlement')

    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(sqls.some(s => s.includes('COMMIT'))).toBe(false)
    expect(fakeClient.release).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 6: Rewrite `settle-package-mode-ride.test.ts` for the client-run flip**

The package-mode test scripted the flip and billing-mode read on `pool.query`; they now run on the client. Replace the whole file `api/tests/unit/payments/settle-package-mode-ride.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// confirmRidePayment now runs the status flip + billing-mode read + wallet writes
// on ONE client transaction. consumePackageBalance (packages module) and
// accrueDriverEarning (settlements module) mock cleanly across module boundaries.
const fakeClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('15') }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyDriverLowWalletBalance: vi.fn() }))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({
  accrueDriverEarning: vi.fn().mockResolvedValue(undefined),
}))
const consumePackageBalance = vi.fn().mockResolvedValue(undefined)
vi.mock('@/modules/packages/packages.service', () => ({
  consumePackageBalance: (...a: unknown[]) => consumePackageBalance(...a),
}))

import { pool } from '@/db/client'
import { confirmRidePayment } from '@/modules/payments/payments.service'

describe('confirmRidePayment — package-mode branch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('billing_mode_snapshot = package → consumes package balance, never touches the driver commission wallet', async () => {
    fakeClient.query.mockImplementation((sql: string) => {
      if (/UPDATE payments/.test(sql)) return Promise.resolve({ rows: [{ driver_id: '42', user_id: '7', amount: '80.00' }], rowCount: 1 })
      if (/billing_mode_snapshot/.test(sql)) return Promise.resolve({ rows: [{ billing_mode_snapshot: 'package' }], rowCount: 1 })
      if (/SELECT id, balance FROM user_wallets/.test(sql)) return Promise.resolve({ rows: [{ id: 2, balance: '0' }], rowCount: 1 })
      // deductCommission's driver_wallets FOR UPDATE must never run in package mode
      if (/driver_wallets/.test(sql) || /driver_wallet_ledger/.test(sql)) throw new Error(`unexpected driver-wallet query: ${sql}`)
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    const result = await confirmRidePayment(BigInt(1))

    expect(result).toBe(true)
    expect(consumePackageBalance).toHaveBeenCalledWith(BigInt(1), BigInt(42), 80)
    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('driver_wallet_ledger'))).toBe(false)
    expect(sqls.filter(s => s.includes('COMMIT')).length).toBe(1)
  })

  it('billing_mode_snapshot = null (commission) → deducts commission, never calls consumePackageBalance', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ commission_amount: '12.00' }], rowCount: 1 } as never)
    fakeClient.query.mockImplementation((sql: string) => {
      if (/UPDATE payments/.test(sql)) return Promise.resolve({ rows: [{ driver_id: '42', user_id: '7', amount: '80.00' }], rowCount: 1 })
      if (/billing_mode_snapshot/.test(sql)) return Promise.resolve({ rows: [{ billing_mode_snapshot: null }], rowCount: 1 })
      if (/SELECT id, balance, is_frozen/.test(sql)) return Promise.resolve({ rows: [{ id: 1, balance: '1000', is_frozen: false }], rowCount: 1 })
      if (/SELECT id, balance FROM user_wallets/.test(sql)) return Promise.resolve({ rows: [{ id: 2, balance: '0' }], rowCount: 1 })
      return Promise.resolve({ rows: [], rowCount: 1 })
    })

    const result = await confirmRidePayment(BigInt(2))

    expect(result).toBe(true)
    expect(consumePackageBalance).not.toHaveBeenCalled()
    const commissionLedger = fakeClient.query.mock.calls.find(
      c => (c[0] as string).includes('driver_wallet_ledger') && (c[1] as unknown[]).includes(BigInt(2))
    )
    expect(commissionLedger, 'commission ledger write must run in commission mode').toBeDefined()
  })
})
```

- [ ] **Step 7: Run the affected suites and confirm the untouched standalone tests still pass**

Run: `cd api && npx vitest run tests/unit/payments/confirm-ride-payment.test.ts tests/unit/payments/settle-package-mode-ride.test.ts tests/unit/payments/deduct-commission-notifies.test.ts tests/unit/payments/deduct-commission-negative-balance.test.ts tests/unit/settlements/accrue-driver-earning.test.ts`
Expected: PASS all. The `deduct-commission-*` and `accrue-driver-earning` standalone tests are unchanged because they call the functions **without** a client, exercising the unchanged `owns === true` path (they ignore the now-returned value).

- [ ] **Step 8: Typecheck (the optional-client signature change touches call sites)**

Run: `cd api && npx tsc --noEmit`
Expected: no errors. (`confirmRidePayment` is the only caller passing a client; all other callers of the three functions omit it, which is valid under the optional parameter.)

- [ ] **Step 9: Commit**

```bash
git add api/src/modules/payments/payments.service.ts api/src/modules/payments/submodules/settlements/settlements.service.ts api/tests/unit/payments/confirm-ride-payment.test.ts api/tests/unit/payments/settle-package-mode-ride.test.ts
git commit -m "fix(payments): settle a ride's commission/earning/cashback in one transaction"
graphify update .
```

---

## Task C: Cap refund amount against the original payment (§04.3)

**Context:** `resolveDispute` (disputes.service.ts:65) inserts `input.refundAmount` verbatim into `refunds` with no check against the payment total or prior refunds — a resolver can refund more than was ever paid. This becomes real money-loss the moment auto-refund disbursement ships. The insert already runs inside a `pool.connect()` transaction; this task adds a `FOR UPDATE` lock on the payment row plus a remaining-refundable check before the insert. **No migration:** the `CHECK (amount > 0)` the design calls for already exists (`008_m6_payments.sql:99`), so the DB-layer defense-in-depth is already in place; the cross-row `SUM <= amount` cap can't be a CHECK and is enforced by the app guard under the `FOR UPDATE` lock.

**Files:**
- Modify: `api/src/modules/safety/disputes.service.ts` (`resolveDispute`, refund block ~L87-108)
- Test: `api/tests/unit/safety/resolve-dispute.test.ts` (new)

- [ ] **Step 1: Write the failing tests (new file)**

Create `api/tests/unit/safety/resolve-dispute.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
vi.mock('@/modules/safety/safety.repository', () => ({ getDisputeById: vi.fn() }))
vi.mock('@/modules/geo/geo.service', () => ({ getRoute: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import { resolveDispute } from '@/modules/safety/disputes.service'

// Client answers by SQL shape: payment lookup (FOR UPDATE), prior-refund SUM,
// and everything else (BEGIN/UPDATE disputes/INSERT dispute_actions/INSERT refunds/COMMIT).
function scriptClient(paymentAmount: string, alreadyRefunded: string) {
  fakeClient.query.mockReset()
  fakeClient.query.mockImplementation((sql: string) => {
    if (/SELECT id, amount FROM payments/.test(sql)) return Promise.resolve({ rows: [{ id: 55, amount: paymentAmount }], rowCount: 1 })
    if (/SUM\(amount\)/.test(sql)) return Promise.resolve({ rows: [{ sum: alreadyRefunded }], rowCount: 1 })
    return Promise.resolve({ rows: [], rowCount: 1 })
  })
}

const base = { adminId: 1n, note: 'resolved via test' }

describe('resolveDispute — refund cap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getDisputeById).mockResolvedValue({ id: 10n, ride_id: 500n, driver_id: 42n } as never)
  })

  it('refund within the remaining balance → inserts the refund row', async () => {
    scriptClient('500.00', '0')
    await resolveDispute(10n, { ...base, outcome: 'partial_refund', refundAmount: 100 })

    const insert = fakeClient.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO refunds'))
    expect(insert, 'expected a refund insert').toBeDefined()
    expect((insert![1] as unknown[])).toContain(100)
    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('COMMIT'))).toBe(true)
  })

  it('refund exceeding the payment total → throws REFUND_EXCEEDS_PAYMENT, inserts nothing, rolls back', async () => {
    scriptClient('500.00', '0')
    await expect(
      resolveDispute(10n, { ...base, outcome: 'full_refund', refundAmount: 600 })
    ).rejects.toMatchObject({ httpStatus: 400, code: 'REFUND_EXCEEDS_PAYMENT' })

    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('INSERT INTO refunds'))).toBe(false)
    expect(sqls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(sqls.some(s => s.includes('COMMIT'))).toBe(false)
  })

  it('refund exceeding the REMAINING balance after prior refunds → throws', async () => {
    scriptClient('500.00', '400') // only ₹100 left refundable
    await expect(
      resolveDispute(10n, { ...base, outcome: 'partial_refund', refundAmount: 150 })
    ).rejects.toMatchObject({ httpStatus: 400, code: 'REFUND_EXCEEDS_PAYMENT' })
  })

  it('refund exactly at the remaining balance → allowed', async () => {
    scriptClient('500.00', '0')
    await resolveDispute(10n, { ...base, outcome: 'full_refund', refundAmount: 500 })
    const insert = fakeClient.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO refunds'))
    expect(insert).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/unit/safety/resolve-dispute.test.ts`
Expected: FAIL — the "exceeding" cases resolve instead of throwing (no cap yet), and the within-balance case fails because the current code's payment SELECT is `SELECT id FROM payments ...` (no `amount`) and there is no `SUM(amount)` query, so the `scriptClient` branches never match and the insert params differ.

- [ ] **Step 3: Add the refund-cap guard in `resolveDispute`**

In `api/src/modules/safety/disputes.service.ts`, replace the refund block (currently lines ~87-108) with:

```typescript
    if (
      input.refundAmount &&
      input.refundAmount > 0 &&
      (input.outcome === 'full_refund' || input.outcome === 'partial_refund' || input.outcome === 'fare_adjusted')
    ) {
      // Lock the payment row for the duration of this txn so a concurrent
      // resolve on the same ride can't race two refunds past the cap.
      const payRes = await client.query(
        `SELECT id, amount FROM payments WHERE ride_id = $1 LIMIT 1 FOR UPDATE`,
        [dispute.ride_id]
      )
      const payment = payRes.rows[0]
      if (payment) {
        const refundedRes = await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS sum FROM refunds WHERE payment_id = $1`,
          [payment.id]
        )
        const alreadyRefunded = parseFloat(refundedRes.rows[0].sum)
        const remaining = Math.round((parseFloat(payment.amount) - alreadyRefunded) * 100) / 100
        if (input.refundAmount > remaining) {
          throw Object.assign(new Error('Refund amount exceeds the remaining refundable balance'), {
            httpStatus: 400, code: 'REFUND_EXCEEDS_PAYMENT',
          })
        }
        await client.query(
          `INSERT INTO refunds
             (payment_id, ride_id, dispute_id, amount, reason, status, initiated_by)
           VALUES ($1,$2,$3,$4,$5,'requested',$6)`,
          [
            payment.id, dispute.ride_id, id,
            input.refundAmount, input.note, input.adminId,
          ]
        )
      }
    }
```

(The `throw` propagates to the existing `catch` in `resolveDispute`, which issues `ROLLBACK` and rethrows — no other change needed.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/unit/safety/resolve-dispute.test.ts`
Expected: PASS — all four cases green.

- [ ] **Step 5: Confirm the pre-existing `CHECK (amount > 0)` is present (no migration to add)**

Run: `cd api && npx vitest run tests/unit/safety` — confirms `disputes` behavior; then eyeball `api/src/db/migrations/008_m6_payments.sql:99` to confirm `amount NUMERIC(12,2) NOT NULL CHECK (amount > 0)` is already there. No migration file is created in this task.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/safety/disputes.service.ts api/tests/unit/safety/resolve-dispute.test.ts
git commit -m "fix(safety): cap dispute refunds at the payment's remaining refundable balance"
graphify update .
```

---

## Task D: Map gateway payout failures to a code, keep raw detail in logs only (§04.4)

**Context:** Two code paths persist the raw RazorpayX error body into `settlements.failure_reason`: `submitSettlementRow`'s catch (settlements.service.ts:378, stores `err.message` which embeds the raw HTTP body) and `handleWebhookEvent`'s payout.failed path (payments.service.ts:707, stores the gateway `failure_reason` string). `getSettlementBatchDetail` returns `failure_reason` verbatim to the admin API. This task adds a `failure_code` column, a static `FAILURE_CODE_MAP`, maps both write paths to a safe code, keeps full detail in Pino logs only, and switches the admin read to return `failure_code`.

**Files:**
- Create: `api/src/db/migrations/091_settlement_failure_code.sql`
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts` (add `FAILURE_CODE_MAP` + `mapPayoutFailureCode`; rework `submitSettlementRow` error path; `getSettlementBatchDetail` SELECT)
- Modify: `api/src/modules/payments/payments.service.ts` (`handleWebhookEvent` payout.failed path; import `mapPayoutFailureCode`)
- Test: `api/tests/unit/settlements/settlement-failure-code.test.ts` (new), `api/tests/unit/settlements/submit-processing-settlements.test.ts` (one assertion updated)

- [ ] **Step 1: Write the migration**

Create `api/src/db/migrations/091_settlement_failure_code.sql`:

```sql
-- 091: store a mapped, safe failure code on settlements instead of the raw
-- RazorpayX error body. Full gateway detail (status + body) now lives only in
-- structured Pino/Loki logs — never in a column the admin API returns.
-- failure_reason is retained for historical rows but is no longer written to.
ALTER TABLE settlements ADD COLUMN failure_code TEXT NULL;
```

- [ ] **Step 2: Write the failing tests (new file)**

Create `api/tests/unit/settlements/settlement-failure-code.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...args: unknown[]) => poolQuery(...args) } }))

import { mapPayoutFailureCode, getSettlementBatchDetail } from '@/modules/payments/submodules/settlements/settlements.service'

describe('mapPayoutFailureCode', () => {
  it('maps a known RazorpayX reason to a stable safe code', () => {
    expect(mapPayoutFailureCode('invalid_fund_account')).toBe('PAYOUT_INVALID_ACCOUNT')
    expect(mapPayoutFailureCode('insufficient_balance')).toBe('PAYOUT_INSUFFICIENT_PLATFORM_BALANCE')
  })

  it('falls back to PAYOUT_FAILED for unknown or missing reasons', () => {
    expect(mapPayoutFailureCode('some_brand_new_reason')).toBe('PAYOUT_FAILED')
    expect(mapPayoutFailureCode(undefined)).toBe('PAYOUT_FAILED')
    expect(mapPayoutFailureCode(null)).toBe('PAYOUT_FAILED')
  })
})

describe('getSettlementBatchDetail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns failure_code, never the raw failure_reason text', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: '1', failure_code: 'PAYOUT_FAILED' }] })
    await getSettlementBatchDetail('2026-07-23', '2026-07-24')
    const [sql] = poolQuery.mock.calls[0] as [string]
    expect(sql).toContain('failure_code')
    expect(sql).not.toContain('failure_reason')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/unit/settlements/settlement-failure-code.test.ts`
Expected: FAIL — `mapPayoutFailureCode` is not exported yet (import error), and `getSettlementBatchDetail`'s SELECT still contains `failure_reason`.

- [ ] **Step 4: Add `FAILURE_CODE_MAP` + `mapPayoutFailureCode` and rework `submitSettlementRow`**

In `api/src/modules/payments/submodules/settlements/settlements.service.ts`, add after the existing `const log = logger.child(...)` line:

```typescript
// Static map of observed RazorpayX payout error reasons → stable, safe codes
// returned by the admin API. Extend as new reasons show up in the Pino logs.
export const FAILURE_CODE_MAP: Record<string, string> = {
  invalid_account_number: 'PAYOUT_INVALID_ACCOUNT',
  invalid_fund_account: 'PAYOUT_INVALID_ACCOUNT',
  insufficient_balance: 'PAYOUT_INSUFFICIENT_PLATFORM_BALANCE',
  beneficiary_bank_offline: 'PAYOUT_BANK_OFFLINE',
}

export function mapPayoutFailureCode(raw?: string | null): string {
  if (!raw) return 'PAYOUT_FAILED'
  return FAILURE_CODE_MAP[raw] ?? 'PAYOUT_FAILED'
}
```

Then, in `submitSettlementRow`, replace the `!payoutRes.ok` throw:

```typescript
    if (!payoutRes.ok) {
      const errBody = await payoutRes.text()
      throw new Error(`RazorpayX payout API returned ${payoutRes.status}: ${errBody}`)
    }
```

with a throw that carries the gateway reason separately from the raw body:

```typescript
    if (!payoutRes.ok) {
      const errBody = await payoutRes.text()
      let gatewayReason: string | undefined
      try {
        const parsed = JSON.parse(errBody) as { error?: { reason?: string; code?: string } }
        gatewayReason = parsed.error?.reason ?? parsed.error?.code
      } catch { /* non-JSON body — leave gatewayReason undefined → PAYOUT_FAILED */ }
      throw Object.assign(new Error('RazorpayX payout failed'), {
        gatewayReason, gatewayStatus: payoutRes.status, gatewayBody: errBody,
      })
    }
```

Then replace the `catch (err)` block of `submitSettlementRow`:

```typescript
  } catch (err) {
    log.error({ err, settlementId: row.id }, 'payout submit failed')
    await pool.query(
      `UPDATE settlements
         SET status = 'failed', failed_at = now(), failure_reason = $2, razorpay_payout_id = NULL
       WHERE id = $1`,
      [row.id, err instanceof Error ? err.message : 'unknown error']
    )
    await pool.query(
      `UPDATE driver_earnings SET status = 'cleared', settlement_id = NULL WHERE settlement_id = $1`,
      [row.id]
    )
  }
```

with:

```typescript
  } catch (err) {
    const failureCode = mapPayoutFailureCode((err as { gatewayReason?: string }).gatewayReason)
    // Full gateway detail (status + raw body) stays in structured logs ONLY —
    // never persisted to a column the admin API returns (no error.message leak).
    log.error({ err, settlementId: row.id }, 'payout submit failed')
    await pool.query(
      `UPDATE settlements
         SET status = 'failed', failed_at = now(), failure_code = $2, razorpay_payout_id = NULL
       WHERE id = $1`,
      [row.id, failureCode]
    )
    await pool.query(
      `UPDATE driver_earnings SET status = 'cleared', settlement_id = NULL WHERE settlement_id = $1`,
      [row.id]
    )
  }
```

- [ ] **Step 5: Switch `getSettlementBatchDetail` to return `failure_code`**

In the same file, in `getSettlementBatchDetail`, change the SELECT column list from:

```sql
    `SELECT s.id, s.driver_id, d.full_name AS driver_name, s.net_payout, s.fee,
            s.status, s.mode, s.utr, s.razorpay_payout_id, s.failure_reason, s.created_at
```

to:

```sql
    `SELECT s.id, s.driver_id, d.full_name AS driver_name, s.net_payout, s.fee,
            s.status, s.mode, s.utr, s.razorpay_payout_id, s.failure_code, s.created_at
```

- [ ] **Step 6: Map the webhook payout.failed path too (root-cause: both writers)**

In `api/src/modules/payments/payments.service.ts`, add `mapPayoutFailureCode` to the existing settlements import (top of file, line 6):

```typescript
import { accrueDriverEarning } from '@/modules/payments/submodules/settlements/settlements.service'
```
becomes:
```typescript
import { accrueDriverEarning, mapPayoutFailureCode } from '@/modules/payments/submodules/settlements/settlements.service'
```

Then in `handleWebhookEvent`, replace the payout.failed/reversed block:

```typescript
    const failureReason = (entity as { failure_reason?: string }).failure_reason ?? event
    const settlementUpdate = await pool.query(
      `UPDATE settlements SET status = 'failed', failed_at = now(), failure_reason = $2
       WHERE id = $1 AND status != 'completed' AND razorpay_payout_id = $3`,
      [settlementId, failureReason ?? null, eventId]
    )
```

with:

```typescript
    const rawFailureReason = (entity as { failure_reason?: string }).failure_reason
    const failureCode = mapPayoutFailureCode(rawFailureReason)
    // Raw gateway reason stays in structured logs only, never in a returned column.
    log.warn({ settlementId, rawFailureReason, event }, 'settlement payout failed (webhook)')
    const settlementUpdate = await pool.query(
      `UPDATE settlements SET status = 'failed', failed_at = now(), failure_code = $2
       WHERE id = $1 AND status != 'completed' AND razorpay_payout_id = $3`,
      [settlementId, failureCode, eventId]
    )
```

- [ ] **Step 7: Update the one stale assertion in `submit-processing-settlements.test.ts`**

The live-gateway failure test asserts the raw body is stored. Update it to a JSON error body and assert the mapped code. In `api/tests/unit/settlements/submit-processing-settlements.test.ts`, in the test `'failure: reverts settlement to failed ...'`, change the fetch mock's `text` and the trailing assertions.

Change:
```typescript
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'Invalid fund account' })
```
to:
```typescript
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"error":{"reason":"invalid_fund_account"}}' })
```

Change:
```typescript
    const failUpdate = poolQuery.mock.calls[3]
    expect(failUpdate[0]).toContain("status = 'failed'")
    expect(failUpdate[0]).toContain('razorpay_payout_id = NULL')
    expect(failUpdate[1][0]).toBe('901')
    expect(failUpdate[1][1]).toContain('Invalid fund account')
```
to:
```typescript
    const failUpdate = poolQuery.mock.calls[3]
    expect(failUpdate[0]).toContain("status = 'failed'")
    expect(failUpdate[0]).toContain('razorpay_payout_id = NULL')
    expect(failUpdate[0]).toContain('failure_code = $2')
    expect(failUpdate[0]).not.toContain('failure_reason')
    expect(failUpdate[1][0]).toBe('901')
    expect(failUpdate[1][1]).toBe('PAYOUT_INVALID_ACCOUNT') // mapped, not the raw body
```

- [ ] **Step 8: Run the Task-D tests**

Run: `cd api && npx vitest run tests/unit/settlements/settlement-failure-code.test.ts tests/unit/settlements/submit-processing-settlements.test.ts tests/unit/settlements/payout-webhook.test.ts`
Expected: PASS all. (`payout-webhook.test.ts` stays green — its failure test only asserts `status = 'failed'` and the earnings revert, neither of which the column-name change affects.)

- [ ] **Step 9: Apply the migration and typecheck**

Run: `cd api && pnpm migrate && npx tsc --noEmit`
Expected: migration `091_settlement_failure_code.sql` applies cleanly (adds `failure_code` to `settlements`); no TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add api/src/db/migrations/091_settlement_failure_code.sql api/src/modules/payments/submodules/settlements/settlements.service.ts api/src/modules/payments/payments.service.ts api/tests/unit/settlements/settlement-failure-code.test.ts api/tests/unit/settlements/submit-processing-settlements.test.ts
git commit -m "fix(settlements): store a mapped failure_code, keep raw gateway detail in logs only"
graphify update .
```

---

## Final verification

- [ ] **Run the full affected test surface:**

Run: `cd api && npx vitest run tests/unit/payments tests/unit/settlements tests/unit/safety`
Expected: all PASS.

- [ ] **Typecheck the whole API:**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Confirm no out-of-scope files were touched:**

Run: `git diff --name-only main` and verify every path is under `api/src/modules/payments/`, `api/src/modules/safety/disputes.service.ts`, `api/tests/unit/{payments,settlements,safety}/`, or `api/src/db/migrations/091_*.sql`.

---

## Self-Review (performed against §04 + §07)

**Spec coverage:**
- §04.1 negative balance / debt recovery → Task A (debt-first allocation made explicit + audited). ✅ Note: the ops flip of `driver_minimum_balance` back to `500` is tracked in CLAUDE.md's Pending Ops Actions, not code — correctly out of this plan.
- §04.2 non-atomic settlement → Task B (single transaction across flip + commission + earning + cashback; idempotency guard verified still correct on retry after rollback via the "already-completed → rolls back, returns false" and "step throws → ROLLBACK, no COMMIT" tests). ✅
- §04.3 refund cap → Task C (app guard `refundAmount <= amount - SUM(prior refunds)` under `FOR UPDATE`; the `CHECK(amount>0)` defense-in-depth already exists, documented, so no redundant migration). ✅
- §04.4 error leakage → Task D (`failure_code` column + `FAILURE_CODE_MAP` at both writers; raw detail in Pino only; admin read returns `failure_code`). ✅
- §07 cross-cutting: Task A reuses the signed-balance ledger convention; Task B reuses the existing `pool.connect()/BEGIN/COMMIT/ROLLBACK/release` style verbatim; Task C reuses the `FOR UPDATE` row-lock pattern from `payFromUserWallet`/`deductCommission`; Task D mirrors the "code, not raw message" rule the bank-account verification route (`settlements.admin.routes.ts:89-93`) already follows. ✅

**Placeholder scan:** no TBD/TODO/"add error handling"/vague steps — every code step shows complete code; every test step shows full assertions; every run step gives an exact command and expected result. ✅

**Type consistency:** `deductCommission` returns `{ newBalance: number } | null` and `confirmRidePayment` consumes exactly that shape; `creditCashback`/`accrueDriverEarning` return `Promise<void>` with a trailing `sharedClient?: PoolClient` matching the single call site that passes `client`; `mapPayoutFailureCode(raw?: string | null): string` signature matches all three call sites (submit catch, webhook, tests). ✅

**Migration numbering:** single new migration `091`; documented fallback if a parallel plan claims it first. ✅
