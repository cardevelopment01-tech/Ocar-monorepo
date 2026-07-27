# Driver Cash Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ponytail is active — take the highest rung that works, don't add speculative structure.

**Goal:** After a cash ride ends, the driver confirms cash collection on a dedicated screen (swipe-to-confirm the exact fare, or log a different/not-collected amount); commission accrues to a now-signed driver wallet so uncollected cash becomes tracked dues that block going online until cleared.

**Architecture:** Cash settlement moves from an automatic side-effect of end-OTP verification to an explicit `POST /rides/:id/collect-cash` step. The driver wallet's `balance >= 0` floor is dropped so cash commission that exceeds earnings becomes a negative balance (= dues). The existing `goOnline` low-balance gate (`rides.service.ts:128`) becomes the dues gate for free. Online/wallet ride settlement is untouched.

**Tech Stack:** Express + TS + pg (backend), Vite + React + Zustand + framer-motion (driver app), PostgreSQL. Reuses `SwipeToConfirm.tsx`, `system-config` helpers, `driver_wallet_ledger`.

**Research basis:** `docs/superpowers/research/` findings — Uber/Bolt/inDrive all use a single signed balance (cash debits commission, digital credits earnings, netting between), a go-online gate on negative balance, and "log actual amount → flag discrepancy to ops, don't block." We deliberately skip hysteresis dual-thresholds (YAGNI — the single min-balance floor + explicit clear-dues action can't flap) and the GST/subscription model.

---

## Decisions locked (from brainstorming)

1. **Negative-capable wallet** — one signed `driver_wallets.balance`. Drop the `>= 0` check. Cash ride debits commission (can go negative = dues); digital rides credit earnings and net it back up.
2. **Not-collected → log amount + flag ops, don't block.** Commission still accrues on the fare snapshot regardless (driver owes on the fare they earned); discrepancy is flagged for admin review.
3. **Dues gate = existing `driver_minimum_balance` floor.** No new threshold config; a driver who owes is below the floor and already blocked by `goOnline`.
4. **Kill switch** `cash_collection_enabled` (default `'true'`) mirrors the `driver_payouts_enabled` pattern — off ⇒ old auto-settle behavior, so this can ship dark.

---

## File Structure

**Backend (`api/`)**
- Create: `src/db/migrations/064_cash_collection.sql` — drop wallet floor, add `rides` cash columns, seed config.
- Modify: `src/modules/payments/payments.service.ts` — `deductCommission` allows negative; new `flagCashDiscrepancy`.
- Modify: `src/modules/rides/rides.service.ts` — `settleRideCompletionPayment` defers cash; new `collectCash`.
- Modify: `src/modules/rides/rides.routes.ts` — `POST /:id/collect-cash`.
- Modify: `src/modules/rides/rides.repository.ts` — surface `payment_channel` + cash fields in ride detail.
- Test: `src/modules/rides/__tests__/collect-cash.test.ts`, extend payments commission test.

**Driver app (`apps/driver/`)**
- Create: `src/pages/ActiveRide/CollectCash.tsx` — the collection screen.
- Modify: `src/lib/ride-api.ts` — `RideDetail.payment_channel`, `collectCash()`.
- Modify: `src/store/useRideStore.ts` — `ActiveRide.paymentChannel`.
- Modify: `src/pages/ActiveRide/TripInProgress.tsx` — branch after end-OTP.
- Modify: `src/pages/ActiveRide/TripEnd.tsx` — cash-aware earnings copy, drop hardcoded 20%.
- Modify: driver router — add `/ride/collect-cash`.
- Modify: `src/pages/GoOnline` (or the go-online screen) — dues-blocked state.

**Admin (`apps/admin/`)**
- Modify: rides list — surface/filter `cash_discrepancy`.

**Phase dependency graph:**
```
P1 (schema + negative wallet)
 └─> P2 (backend collect-cash + defer)
      ├─> P3 (driver collection screen)   ──> P5 (admin discrepancy view)
      └─> P4 (driver dues-gate UX)
```
P3 and P4 depend only on P2 and can run in parallel. P5 depends on P2 (data) and is trivial.

**After every phase:** run `cd api && npx tsc --noEmit`, run the phase's tests, then `graphify update .`. Commit. Request review before starting the next phase.

---

## Phase 1 — Schema + negative-capable wallet

### Task 1.1: Migration — drop wallet floor, add cash columns, seed config

**Files:**
- Create: `api/src/db/migrations/064_cash_collection.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 064: Driver cash collection — negative-capable wallet + ride cash-collection state.
-- Cash rides now settle on explicit driver confirmation (POST /rides/:id/collect-cash),
-- not automatically on end-OTP. Uncollected commission becomes a negative wallet
-- balance (= dues) which the existing goOnline min-balance gate already blocks on.

-- Signed balance: dropping the >= 0 floor turns "commission we couldn't collect"
-- into tracked dues instead of silently floored-at-zero revenue leakage.
ALTER TABLE driver_wallets DROP CONSTRAINT driver_wallets_balance_check;

-- Per-ride cash collection state. Null cash_collected_at = not yet confirmed.
ALTER TABLE rides
  ADD COLUMN cash_collected_amount NUMERIC(10,2) NULL,
  ADD COLUMN cash_collected_at     TIMESTAMPTZ   NULL,
  ADD COLUMN cash_discrepancy      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN cash_collection_note  TEXT          NULL;

-- Admin queue: rides needing ops review because collected != fare (or not collected).
CREATE INDEX rides_cash_discrepancy_idx
  ON rides (completed_at DESC)
  WHERE cash_discrepancy = true;

-- Config (system_config is key/value text; read via getConfigValue).
INSERT INTO system_config (key, value, description) VALUES
  ('cash_collection_enabled', 'true',
   'When true, cash rides require driver collection confirmation before settlement. Off = legacy auto-settle on end-OTP.'),
  ('cash_collection_tolerance', '1',
   'Rupee tolerance; |collected - fare| above this flags the ride as a cash discrepancy for ops.')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: `064_cash_collection.sql` applied, no error. (If `system_config` INSERT column names differ, adjust to the actual columns — verify with `\d system_config`.)

- [ ] **Step 3: Verify schema**

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "\d driver_wallets" -c "\d rides"`
Expected: no `balance >= 0` check on `driver_wallets`; `rides` has the four new columns.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/064_cash_collection.sql
git commit -m "feat(cash): migration — negative-capable wallet, ride cash-collection state, config"
```

### Task 1.2: `deductCommission` allows negative balance

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts:113-117`
- Test: `api/src/modules/payments/__tests__/deduct-commission.test.ts` (create or extend existing)

- [ ] **Step 1: Write the failing test**

```typescript
// deduct-commission.test.ts — assert commission can push balance below zero.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the pool so we can assert the UPDATE balance value.
const queries: Array<{ text: string; params: unknown[] }> = []
const clientQuery = vi.fn(async (text: string, params?: unknown[]) => {
  queries.push({ text, params: params ?? [] })
  if (text.includes('FOR UPDATE')) return { rows: [{ id: 1, balance: '100.00', is_frozen: false }] }
  return { rows: [] }
})
vi.mock('@/db/client', () => ({
  pool: {
    query: async () => ({ rows: [{ commission_amount: '150.00' }] }),
    connect: async () => ({ query: clientQuery, release: vi.fn() }),
  },
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: async (_k: string, d: string) => d }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyDriverLowWalletBalance: vi.fn() }))

import { deductCommission } from '@/modules/payments/payments.service'

describe('deductCommission negative balance', () => {
  beforeEach(() => { queries.length = 0 })
  it('lets balance go negative when commission exceeds balance', async () => {
    await deductCommission(1n, 1n)
    const update = queries.find(q => q.text.includes('UPDATE driver_wallets'))
    // 100 - 150 = -50, NOT floored to 0
    expect(update?.params[1]).toBe(-50)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/modules/payments/__tests__/deduct-commission.test.ts`
Expected: FAIL — current code floors at 0, so `params[1]` is `0` not `-50`.

- [ ] **Step 3: Remove the floor**

In `payments.service.ts`, change lines 114-117 from:

```typescript
    const newBalance = Math.max(
      Math.round((currentBalance - commission) * 100) / 100,
      0
    )
```

to:

```typescript
    // Signed balance: negative = driver owes the platform (cash dues). The goOnline
    // min-balance gate blocks re-activation until this is cleared (netted by digital
    // earnings or topped up). See migration 064.
    const newBalance = Math.round((currentBalance - commission) * 100) / 100
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/modules/payments/__tests__/deduct-commission.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/payments/payments.service.ts api/src/modules/payments/__tests__/deduct-commission.test.ts
git commit -m "feat(cash): allow driver wallet to go negative (cash dues) on commission debit"
```

**Phase 1 checkpoint:** `npx tsc --noEmit` clean, tests green, `graphify update .`. Request review.

---

## Phase 2 — Backend: defer cash settlement + `collect-cash` endpoint

### Task 2.1: Defer cash settlement behind the kill switch

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts:1326-1330` (the cash branch of `settleRideCompletionPayment`)

- [ ] **Step 1: Write the failing test**

```typescript
// In api/src/modules/rides/__tests__/collect-cash.test.ts (new file).
// Assert that with cash_collection_enabled='true', settleRideCompletionPayment
// does NOT create a payment or deduct commission for a cash ride.
import { describe, it, expect, vi } from 'vitest'

const created: string[] = []
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(async () => { created.push('payment') }),
  deductCommission:    vi.fn(async () => { created.push('commission') }),
  creditCashback:      vi.fn(async () => { created.push('cashback') }),
  confirmRidePayment:  vi.fn(),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: async (k: string, d: string) => k === 'cash_collection_enabled' ? 'true' : d }))
// ...mock repo.getRideById -> { payment_channel: 'cash', user_id: 5 }, pool fare query -> 480
// (wire the same way the existing rides.service tests mock pool + repo)

import { settleRideCompletionPayment } from '@/modules/rides/rides.service'

describe('settleRideCompletionPayment — cash deferral', () => {
  it('does not settle cash when cash_collection_enabled', async () => {
    created.length = 0
    await settleRideCompletionPayment(1n, 2n)
    expect(created).toEqual([]) // nothing settled until driver confirms
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/modules/rides/__tests__/collect-cash.test.ts`
Expected: FAIL — current cash branch calls `createPaymentRecord` + `deductCommission` immediately.

- [ ] **Step 3: Guard the cash branch**

In `rides.service.ts`, replace the cash branch (lines ~1326-1330) with:

```typescript
  // cash (default) — settlement now happens on explicit driver confirmation
  // (POST /rides/:id/collect-cash). Kill switch reverts to legacy auto-settle.
  const cashCollectionEnabled = (await getConfigValue('cash_collection_enabled', 'true')) === 'true'
  if (cashCollectionEnabled) {
    // Tell the driver app to show the cash-collection screen.
    socketEvents.sendRideStatusUpdate(rideId.toString(), {
      status:         'completed',
      paymentChannel: 'cash',
      needsCashCollection: true,
      amount:         fareAmount,
    })
    return
  }
  await createPaymentRecord(rideId, 'cash_direct')
  await deductCommission(rideId, driverId)
  if (rideData?.user_id == null || fareAmount <= 0) return
  await creditCashback(rideId, BigInt(rideData.user_id), fareAmount)
```

Ensure `getConfigValue` is imported at the top of `rides.service.ts` (it is used elsewhere — verify; if not, add `import { getConfigValue } from '@/lib/system-config'`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/modules/rides/__tests__/collect-cash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/src/modules/rides/__tests__/collect-cash.test.ts
git commit -m "feat(cash): defer cash ride settlement to explicit collection (kill-switch guarded)"
```

### Task 2.2: `collectCash` service + discrepancy flag

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts` — add `flagCashDiscrepancy` is NOT needed (flag lives on the ride); instead export a small helper if useful. Keep flag inline in `collectCash`.
- Modify: `api/src/modules/rides/rides.service.ts` — add `collectCash`.
- Test: extend `collect-cash.test.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// Add to collect-cash.test.ts:
// 1. happy path: collectCash(driver, ride, {collectedAmount: 480}) with fare 480
//    -> creates cash payment, deducts commission, credits cashback, no discrepancy.
// 2. discrepancy: collectedAmount 300 (fare 480, tolerance 1)
//    -> ride.cash_discrepancy = true, commission STILL accrues on fare.
// 3. notCollected: {notCollected: true} -> collected_amount 0, discrepancy true, note set.
// 4. idempotency: calling collectCash twice does not double-charge (payment ON CONFLICT).
// Assert via the mocked pool query log (which INSERT/UPDATE ran) + payment mock calls.
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run src/modules/rides/__tests__/collect-cash.test.ts`
Expected: FAIL — `collectCash` does not exist.

- [ ] **Step 3: Implement `collectCash`**

Add to `rides.service.ts` (near `settleRideCompletionPayment`):

```typescript
// Explicit driver confirmation that cash was collected. Idempotent (the payment
// row's ON CONFLICT(ride_id) guards double-settle). Commission always accrues on
// the *fare* (the driver owes on what they earned); a collected amount that differs
// from the fare beyond tolerance flags the ride for ops review but never blocks.
export async function collectCash(
  driverId: bigint,
  rideId: bigint,
  input: { collectedAmount?: number; notCollected?: boolean; note?: string }
): Promise<{ collected: number; discrepancy: boolean }> {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  if (String(ride.driver_id) !== String(driverId)) throw httpError(403, 'Not your ride', 'FORBIDDEN')
  if (ride.status !== 'completed') throw httpError(409, 'Ride is not completed', 'RIDE_NOT_COMPLETED')
  if ((ride.payment_channel ?? 'cash') !== 'cash') throw httpError(409, 'Ride is not a cash ride', 'NOT_CASH_RIDE')
  if (ride.cash_collected_at) return { collected: parseFloat(ride.cash_collected_amount), discrepancy: ride.cash_discrepancy }

  const fareRow = await pool.query(
    `SELECT COALESCE(total_final, total_estimated) AS amount FROM fare_snapshots WHERE ride_id = $1`,
    [rideId]
  )
  const fare = parseFloat(fareRow.rows[0]?.amount ?? '0')
  const collected = input.notCollected ? 0 : (input.collectedAmount ?? fare)
  const tolerance = parseFloat(await getConfigValue('cash_collection_tolerance', '1'))
  const discrepancy = input.notCollected === true || Math.abs(collected - fare) > tolerance

  await pool.query(
    `UPDATE rides
     SET cash_collected_amount = $2, cash_collected_at = now(),
         cash_discrepancy = $3, cash_collection_note = $4
     WHERE id = $1`,
    [rideId, collected, discrepancy, input.note ?? null]
  )

  // Settle: commission on the fare (not the collected amount) so short/no collection
  // still owes the platform. createPaymentRecord is ON CONFLICT DO NOTHING = idempotent.
  await createPaymentRecord(rideId, 'cash_direct')
  await deductCommission(rideId, driverId)
  if (ride.user_id != null && fare > 0) await creditCashback(rideId, BigInt(ride.user_id), fare)

  if (discrepancy) {
    await notifyAllAdmins({
      type:  'cash_discrepancy',
      title: 'Cash discrepancy',
      body:  `Ride #${rideId}: fare ₹${fare}, driver logged ₹${collected}${input.notCollected ? ' (not collected)' : ''}.`,
      payload: { rideId: rideId.toString(), fare, collected },
    }).catch(() => {})
  }

  return { collected, discrepancy }
}
```

Verify imports: `httpError`, `getConfigValue`, `createPaymentRecord`, `deductCommission`, `creditCashback`, and `notifyAllAdmins` (from `@/modules/notifications/notifications.service`). Match the exact `notifyAllAdmins` signature — read it first; adapt the object shape to the real one (it may take `(ownerless, data)` differently). If the signature doesn't fit cleanly, fall back to the ride flag only (admin sees it via the discrepancy filter in Phase 5) and drop the notify — **that is the lazy-correct fallback, not a gap.**

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run src/modules/rides/__tests__/collect-cash.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.service.ts
git commit -m "feat(cash): collectCash — settle on confirmation, flag discrepancies for ops"
```

### Task 2.3: Route + surface `payment_channel`/cash fields to driver

**Files:**
- Modify: `api/src/modules/rides/rides.routes.ts` (near line 245, alongside `end-otp`)
- Modify: `api/src/modules/rides/rides.repository.ts` — the ride-detail SELECT the driver app reads (the one backing `getRideById`/driver ride detail). Add `r.payment_channel`, `r.cash_collected_at`.

- [ ] **Step 1: Add the route**

```typescript
// rides.routes.ts — driver-authenticated, mirrors end-otp wiring.
router.post('/:id/collect-cash', authenticate, requireRole('driver'), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const rideId = BigInt(req.params['id']!)
    const body = z.object({
      collectedAmount: z.number().nonnegative().optional(),
      notCollected:    z.boolean().optional(),
      note:            z.string().max(280).optional(),
    }).parse(req.body)
    const result = await service.collectCash(driverId, rideId, body)
    res.json(result)
  } catch (err) { next(err) }
})
```

(Match the file's actual middleware names — `authenticate`, `requireRole`, and the `z` import as used by sibling routes.)

- [ ] **Step 2: Surface fields in the driver ride-detail query**

In `rides.repository.ts`, find the SELECT backing the driver's ride detail (the one that returns `user_name`, `total_estimated`, `stops`, etc. per `RideDetail`) and add `r.payment_channel`, `r.cash_collected_at` to the column list.

- [ ] **Step 3: Verify (typecheck + manual)**

Run: `cd api && npx tsc --noEmit`
Expected: clean. Then hit `POST /api/v1/rides/<id>/collect-cash` for a completed cash ride (see Phase 3 for the app path) and confirm a `payments` row + negative-or-reduced wallet balance appear.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/rides/rides.routes.ts api/src/modules/rides/rides.repository.ts
git commit -m "feat(cash): POST /rides/:id/collect-cash + surface payment_channel to driver"
```

**Phase 2 checkpoint:** tests green, `tsc` clean, `graphify update .`. Request review. **Run the security-reviewer subagent** on the payments/rides diff (money path + new endpoint).

---

## Phase 3 — Driver app: cash collection screen

### Task 3.1: Types + API client + store field

**Files:**
- Modify: `apps/driver/src/lib/ride-api.ts` — add `payment_channel` + `cash_collected_at` to `RideDetail` (line 26-46); add `collectCash`.
- Modify: `apps/driver/src/store/useRideStore.ts` — add `paymentChannel` to `ActiveRide` (line 15-33) and populate it wherever the ride is loaded from `RideDetail`.

- [ ] **Step 1: Extend `RideDetail` + add API method**

In `ride-api.ts`, add to `RideDetail`:

```typescript
  payment_channel: 'cash' | 'online' | 'wallet'
  cash_collected_at: string | null
```

And to `driverRideApi`:

```typescript
  collectCash(rideId: string, body: { collectedAmount?: number; notCollected?: boolean; note?: string }) {
    return api.post(`/rides/${rideId}/collect-cash`, body).then(r => r.data as { collected: number; discrepancy: boolean })
  },
```

(Match the file's axios instance name — `api` vs `client`.)

- [ ] **Step 2: Add `paymentChannel` to the store**

In `useRideStore.ts`, add `paymentChannel?: 'cash' | 'online' | 'wallet'` to the `ActiveRide` interface, and set it from `RideDetail.payment_channel` wherever `setRide`/equivalent maps the detail into the store.

- [ ] **Step 3: Verify**

Run: `cd apps/driver && npx tsc --noEmit` (or `pnpm build`)
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/lib/ride-api.ts apps/driver/src/store/useRideStore.ts
git commit -m "feat(cash): driver app — payment_channel on ride + collectCash client"
```

### Task 3.2: The `CollectCash` screen

**Files:**
- Create: `apps/driver/src/pages/ActiveRide/CollectCash.tsx`
- Modify: driver router (where `/ride/end` is registered) — add `/ride/collect-cash`.

Design (from research — action + amount log, exact fare dominant, swipe-to-confirm the money action; reuse `SwipeToConfirm`, don't build a new control):

- [ ] **Step 1: Build the screen**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Banknote, ChevronDown } from 'lucide-react'
import SwipeToConfirm from '@/components/ui/SwipeToConfirm'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi } from '@/lib/ride-api'

function fmt(n: number) { const s = n.toFixed(2); return s.endsWith('.00') ? s.slice(0, -3) : s }

export default function CollectCash() {
  const navigate = useNavigate()
  const { activeRide } = useRideStore()
  const fare = activeRide?.fare ?? 0
  const [submitting, setSubmitting] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [amount, setAmount] = useState('')       // different-amount entry
  const [error, setError] = useState(false)

  async function confirm(body: { collectedAmount?: number; notCollected?: boolean }) {
    if (!activeRide || submitting) return
    setSubmitting(true); setError(false)
    try {
      await driverRideApi.collectCash(activeRide.id, body)
      navigate('/ride/end', { replace: true })
    } catch { setError(true); setSubmitting(false) }
  }

  return (
    <div className="min-h-[100dvh] bg-bg text-text-primary px-5 flex flex-col"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 2.5rem)', paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-full bg-accent-green/15 flex items-center justify-center mb-5">
          <Banknote size={30} className="text-accent-green" />
        </div>
        <p className="text-text-muted text-sm font-semibold uppercase tracking-wider">Collect cash from rider</p>
        {/* Exact fare — dominant, high-contrast, glanceable in sunlight (research). */}
        <motion.p initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 14 }}
          className="text-[64px] leading-none font-black text-text-primary my-3">₹{fmt(fare)}</motion.p>
        <p className="text-text-secondary text-sm">{activeRide?.userName ?? 'Rider'} · Cash</p>
      </div>

      {error && <p className="text-status-error text-xs text-center mb-3">Could not save — try again.</p>}

      <div className="mb-3">
        <SwipeToConfirm label={`Slide — collected ₹${fmt(fare)}`} color="#16A34A"
          disabled={submitting} onConfirm={() => void confirm({ collectedAmount: fare })} />
      </div>

      <button type="button" onClick={() => setSheetOpen(true)}
        className="w-full py-3 text-sm font-semibold text-text-secondary flex items-center justify-center gap-1">
        Different amount / not collected <ChevronDown size={16} />
      </button>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSheetOpen(false)} />
          <div className="relative w-full bg-surface rounded-t-3xl border-t border-border p-5"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.25rem)' }}>
            <div className="w-10 h-1.5 rounded-full bg-border mx-auto mb-4" />
            <p className="font-bold text-base mb-3">Log actual amount</p>
            <input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={`Fare is ₹${fmt(fare)}`}
              className="w-full rounded-2xl border border-border bg-bg px-4 py-3 text-lg font-bold mb-3" />
            <button type="button" disabled={submitting || !amount}
              onClick={() => void confirm({ collectedAmount: parseFloat(amount) })}
              className="w-full py-3 rounded-2xl bg-primary text-white font-semibold disabled:opacity-60 mb-2">
              Confirm ₹{amount || '0'} collected
            </button>
            <button type="button" disabled={submitting}
              onClick={() => void confirm({ notCollected: true })}
              className="w-full py-3 rounded-2xl border border-status-error text-status-error font-semibold">
              Cash not collected
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

Add `<Route path="/ride/collect-cash" element={<CollectCash />} />` next to the `/ride/end` route (import `CollectCash`).

- [ ] **Step 3: Verify**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: clean. (Confirm token names `activeRide.userName`, `bg-accent-green`, `text-status-error` match the codebase — TripEnd.tsx uses them.)

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/pages/ActiveRide/CollectCash.tsx apps/driver/src/<router-file>
git commit -m "feat(cash): driver cash-collection screen (swipe-to-confirm + discrepancy sheet)"
```

### Task 3.3: Branch the flow after end-OTP; make TripEnd cash-aware

**Files:**
- Modify: `apps/driver/src/pages/ActiveRide/TripInProgress.tsx:756` (the `onVerified` of the end-OTP panel)
- Modify: `apps/driver/src/pages/ActiveRide/TripEnd.tsx:24-25,164` (drop hardcoded 20%, cash-aware copy)

- [ ] **Step 1: Route to collection for cash rides**

In `TripInProgress.tsx`, change the end-OTP `onVerified` (line 756) from:

```tsx
onVerified={() => navigate('/ride/end', { replace: true })}
```

to:

```tsx
onVerified={() => navigate(
  activeRide?.paymentChannel === 'cash' ? '/ride/collect-cash' : '/ride/end',
  { replace: true },
)}
```

(Use whatever the ride object is named in scope — `activeRide`/`ride`.)

- [ ] **Step 2: Fix TripEnd commission + cash copy**

In `TripEnd.tsx`: replace the hardcoded `const commission = Math.round(fare * 0.2)` (line 24) with a value derived from the real net earning. Simplest correct fix given the store: read the commission percent isn't available client-side, so **display the driver's net from the API rather than recomputing**, OR keep a single shared constant. Lazy-correct choice: import the commission percent from a shared const if one exists; otherwise show fare-based framing without asserting a specific %.

For cash rides, change the earnings framing to reflect that the driver holds the cash and owes commission:

```tsx
const isCash = activeRide?.paymentChannel === 'cash'
// ...in the earnings card, when isCash:
//   headline: "You collected" ₹fare (cash in hand)
//   line: "Commission ₹{commission} debited to your wallet"
// else keep the existing "You earned" net framing.
```

Keep the change minimal — one conditional label swap, not a redesign.

- [ ] **Step 3: Verify end-to-end in the app**

Run the API + driver app (`cd api && pnpm dev`, `cd apps/driver && pnpm dev`). Complete a **cash** ride through end-OTP → confirm the CollectCash screen appears → swipe → lands on TripEnd → check DB: `payments` row `channel='cash_direct'`, `driver_wallets.balance` reduced by commission (or negative), `driver_wallet_ledger` has the debit. Complete an **online** ride → confirm it skips CollectCash and goes straight to `/ride/end` (regression check).

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/pages/ActiveRide/TripInProgress.tsx apps/driver/src/pages/ActiveRide/TripEnd.tsx
git commit -m "feat(cash): route cash rides through collection screen; cash-aware trip summary"
```

**Phase 3 checkpoint:** `tsc` clean, manual cash + online flows verified, `graphify update .`. Request review.

---

## Phase 4 — Driver app: dues-gate UX

The gate already blocks (`goOnline` throws `LOW_WALLET_BALANCE` when `balance < driver_minimum_balance`). This phase just makes the blocked state legible as *cash dues* and shows how to clear them.

### Task 4.1: Dues-aware blocked state on Go Online

**Files:**
- Modify: the go-online screen (find via `grep -rn "goOnline\|LOW_WALLET_BALANCE\|go online" apps/driver/src`) and the wallet balance source.

- [ ] **Step 1: Surface the owed amount**

When `goOnline` fails with `LOW_WALLET_BALANCE`, fetch the driver's wallet balance (existing driver wallet API) and, if negative, render a **"Clear your cash dues"** state: show `₹{Math.abs(balance)} owed`, a one-line explainer ("Collected cash includes our commission — clear dues to go back online. Digital rides auto-adjust, or top up your wallet."), and a button to the existing wallet/top-up page. If balance is positive-but-below-min, keep the existing low-balance copy.

- [ ] **Step 2: Verify**

Force a negative balance (a cash ride whose commission exceeds balance, or `UPDATE driver_wallets SET balance = -120 WHERE driver_id = X`), try to go online, confirm the dues state renders with the right amount, and that clearing (top-up back above min) re-enables going online.

- [ ] **Step 3: Commit**

```bash
git add apps/driver/src/<go-online + wallet files>
git commit -m "feat(cash): dues-aware Go Online blocked state with clear-dues guidance"
```

**Phase 4 checkpoint:** manual negative-balance flow verified, `graphify update .`. Request review.

> `ponytail:` clear-dues explicit top-up reuses the existing wallet page; a dedicated in-line "pay dues via UPI now" flow and hysteresis dual-thresholds are deferred — add only if drivers actually get stuck. Netting on digital earnings already clears dues for active drivers.

---

## Phase 5 — Admin: cash discrepancy visibility

### Task 5.1: Surface flagged rides to ops

**Files:**
- Modify: admin rides list page + its API (`apps/admin` rides page; the admin rides backend query).

- [ ] **Step 1: Expose the flag**

Add `cash_discrepancy` (and `cash_collected_amount`) to the admin rides list query/response, and add a filter/badge on the admin rides page so ops can find flagged cash rides (the `rides_cash_discrepancy_idx` from migration 064 backs this). Reuse the existing rides table UI — a red "Cash flag" chip on the row is enough.

- [ ] **Step 2: Verify**

Create a discrepancy (log a cash ride with a different amount), open the admin rides page, filter to flagged, confirm the ride shows with fare vs collected.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/<rides files> api/<admin rides query>
git commit -m "feat(cash): admin — surface cash discrepancy flag on rides list"
```

**Phase 5 checkpoint + feature close:** full end-to-end pass (cash ride → collect → discrepancy → admin sees it → dues block → clear → online). `graphify update .`. Final review, then update `CLAUDE.md` (remove the "payment method is display-only Cash" caveat; note cash-collection is live). Flip `cash_collection_enabled` on for good once verified in an environment.

---

## Self-Review (against decisions + gaps)

- **Negative wallet (decision 1):** Task 1.1 drops the constraint, 1.2 removes the code floor. ✓
- **Not-collected → log + flag, don't block (decision 2):** `collectCash` computes `discrepancy`, flags via ride column + admin notify, never blocks; commission accrues on fare. ✓
- **Dues gate = min-balance (decision 3):** No new threshold; Phase 4 only re-skins the existing `goOnline` block. ✓
- **Kill switch (decision 4):** `cash_collection_enabled` guards the deferral; off = legacy path intact. ✓
- **Regression risk — online/wallet rides:** unchanged branches in `settleRideCompletionPayment`; Task 3.3 Step 3 explicitly regression-tests the online flow skipping CollectCash. ✓
- **Idempotency:** `createPaymentRecord` ON CONFLICT + `cash_collected_at` early-return in `collectCash`. ✓
- **Known follow-ups (not gaps):** fraud signals (GPS-drop-vs-status mismatch, per-driver divergence counter) from research are deliberately out of scope for v1; hysteresis deferred (Phase 4 note). The `TripEnd` commission % display is corrected to stop asserting a wrong 20%.
- **Verify before "done":** each phase has a runnable check (unit tests for money paths; manual app drive-through for UI) — matches ponytail's "one runnable check behind non-trivial logic."
