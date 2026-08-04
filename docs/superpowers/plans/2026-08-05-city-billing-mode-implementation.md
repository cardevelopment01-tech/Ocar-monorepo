# City-Configurable Driver Billing Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each city run either the existing flat per-ride commission model or a new prepaid ride-value-threshold package model, with drivers auto-routed to the correct billing path based on their live location.

**Architecture:** New `driver_package_wallets`/`driver_package_ledger`/`package_tiers` tables alongside (not replacing) the existing `driver_wallets` system. A `cities.billing_mode` enum column drives a `LATERAL`-join branch in the two ride-broadcast queries and a snapshot column (`rides.billing_mode_snapshot`) frozen at ride-assignment time so settlement always knows which path to run, regardless of any later city config change.

**Tech Stack:** Express + TypeScript + `pg` (raw SQL, no ORM), PostgreSQL 18 + PostGIS, Vitest, Next.js 16 admin portal, Vite/React driver app, Razorpay.

**Spec:** `docs/superpowers/specs/2026-08-05-city-billing-mode-design.md`

---

### Task 1: Migration — schema for billing mode, package tiers, and package wallets

**Files:**
- Create: `api/src/db/migrations/078_city_billing_mode.sql`

- [ ] **Step 1: Confirm 078 is still the next free migration number**

Run: `ls api/src/db/migrations | sort | tail -3`
Expected: highest existing file is `077_widen_in_progress_idx.sql`. If a newer migration has landed since this plan was written, bump the number in this task's filename to match.

- [ ] **Step 2: Write the migration**

```sql
-- 078_city_billing_mode.sql
-- Per-city driver billing mode: 'commission' (existing flat % model, unchanged)
-- or 'package' (prepaid ride-value threshold, blocks new ride offers at zero).

CREATE TYPE city_billing_mode AS ENUM ('commission', 'package');

ALTER TABLE cities
  ADD COLUMN billing_mode city_billing_mode NOT NULL DEFAULT 'commission';

-- Admin-editable catalog of purchasable packages (price -> ride-value threshold).
CREATE TABLE package_tiers (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  label           VARCHAR(100) NOT NULL,
  price           NUMERIC(10,2) NOT NULL CHECK (price > 0),
  threshold_value NUMERIC(10,2) NOT NULL CHECK (threshold_value > 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      BIGINT NULL REFERENCES admins(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per driver. Balance CAN go negative (a ride's final fare can exceed
-- the remaining threshold) — unlike driver_wallets, there is no balance >= 0
-- CHECK here on purpose. Negative balance just blocks the *next* ride offer.
CREATE TABLE driver_package_wallets (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id          BIGINT NOT NULL UNIQUE REFERENCES drivers(id),
  balance            NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_frozen          BOOLEAN NOT NULL DEFAULT false,
  frozen_reason      TEXT NULL,
  lifetime_topup     NUMERIC(14,2) NOT NULL DEFAULT 0,
  lifetime_consumed  NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE driver_package_ledger_entry_type AS ENUM
  ('topup', 'ride_consumption', 'admin_adjustment');

CREATE TABLE driver_package_ledger (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wallet_id     BIGINT NOT NULL REFERENCES driver_package_wallets(id),
  driver_id     BIGINT NOT NULL REFERENCES drivers(id),
  entry_type    driver_package_ledger_entry_type NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  direction     VARCHAR(6) NOT NULL CHECK (direction IN ('credit', 'debit')),
  balance_after NUMERIC(12,2) NOT NULL,
  ride_id       BIGINT NULL REFERENCES rides(id),
  reference_id  VARCHAR(100) NULL,
  note          TEXT NULL,
  created_by    BIGINT NULL REFERENCES admins(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_package_ledger_driver_idx ON driver_package_ledger (driver_id, created_at DESC);

-- Razorpay orders for package purchases. Separate from `payments` because
-- `payments.ride_id`/`fare_snapshot_id` are NOT NULL and a package purchase
-- has neither.
CREATE TABLE package_purchase_orders (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id           BIGINT NOT NULL REFERENCES drivers(id),
  package_tier_id     BIGINT NOT NULL REFERENCES package_tiers(id),
  razorpay_order_id   VARCHAR(80) NULL UNIQUE,
  razorpay_payment_id VARCHAR(80) NULL UNIQUE,
  amount              NUMERIC(10,2) NOT NULL,
  threshold_value     NUMERIC(10,2) NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'completed', 'failed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ NULL
);

-- Freezes which billing path a ride settles under, resolved once at
-- assignment time (see acceptAssignment in rides.repository.ts). NULL for
-- rides assigned before this migration ships; those settle via the existing
-- commission path unconditionally (see Task 8).
ALTER TABLE rides
  ADD COLUMN billing_mode_snapshot city_billing_mode NULL;
```

- [ ] **Step 3: Run the migration**

Run: `cd api && pnpm migrate`
Expected: output includes `078_city_billing_mode.sql` applied, no errors.

- [ ] **Step 4: Verify schema**

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "\d driver_package_wallets" -c "\d package_tiers" -c "\d driver_package_ledger"`
Expected: all three tables listed with the columns above.

- [ ] **Step 5: Commit**

```bash
git add api/src/db/migrations/078_city_billing_mode.sql
git commit -m "feat(db): add schema for per-city driver billing mode (package vs commission)"
```

---

### Task 2: Package wallet repository — balance read, ledger write, tier CRUD

**Files:**
- Create: `api/src/modules/packages/packages.types.ts`
- Create: `api/src/modules/packages/packages.repository.ts`
- Test: `api/tests/unit/packages/packages-repository.test.ts`

- [ ] **Step 1: Write types**

```ts
// api/src/modules/packages/packages.types.ts
export interface PackageTier {
  id: string
  label: string
  price: string
  threshold_value: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DriverPackageWallet {
  id: string
  driver_id: string
  balance: string
  is_frozen: boolean
  frozen_reason: string | null
  lifetime_topup: string
  lifetime_consumed: string
}

export interface DriverPackageLedgerEntry {
  id: string
  entry_type: 'topup' | 'ride_consumption' | 'admin_adjustment'
  amount: string
  direction: 'credit' | 'debit'
  balance_after: string
  ride_id: string | null
  reference_id: string | null
  note: string | null
  created_at: string
}
```

- [ ] **Step 2: Write the failing test for `getPackageWallet`**

```ts
// api/tests/unit/packages/packages-repository.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { getPackageWallet } from '@/modules/packages/packages.repository'

describe('getPackageWallet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when the driver has no package wallet row yet', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    const result = await getPackageWallet(BigInt(42))
    expect(result).toBeNull()
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('FROM driver_package_wallets'), [BigInt(42)])
  })

  it('returns the wallet row when it exists', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: '1', driver_id: '42', balance: '250.00', is_frozen: false }] })
    const result = await getPackageWallet(BigInt(42))
    expect(result?.balance).toBe('250.00')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/packages/packages-repository.test.ts`
Expected: FAIL — `Cannot find module '@/modules/packages/packages.repository'`

- [ ] **Step 4: Implement the repository**

```ts
// api/src/modules/packages/packages.repository.ts
import { pool } from '@/db/client'
import type { PackageTier, DriverPackageWallet, DriverPackageLedgerEntry } from './packages.types'

export async function getPackageWallet(driverId: bigint): Promise<DriverPackageWallet | null> {
  const res = await pool.query<DriverPackageWallet>(
    `SELECT id, driver_id, balance, is_frozen, frozen_reason, lifetime_topup, lifetime_consumed
     FROM driver_package_wallets
     WHERE driver_id = $1`,
    [driverId]
  )
  return res.rows[0] ?? null
}

export async function listActiveTiers(): Promise<PackageTier[]> {
  const res = await pool.query<PackageTier>(
    `SELECT id, label, price, threshold_value, is_active, created_at, updated_at
     FROM package_tiers
     WHERE is_active = true
     ORDER BY price ASC`
  )
  return res.rows
}

export async function getTierById(tierId: bigint): Promise<PackageTier | null> {
  const res = await pool.query<PackageTier>(
    `SELECT id, label, price, threshold_value, is_active, created_at, updated_at
     FROM package_tiers WHERE id = $1`,
    [tierId]
  )
  return res.rows[0] ?? null
}

export async function listLedgerForDriver(driverId: bigint, limit = 50): Promise<DriverPackageLedgerEntry[]> {
  const res = await pool.query<DriverPackageLedgerEntry>(
    `SELECT id, entry_type, amount, direction, balance_after, ride_id, reference_id, note, created_at
     FROM driver_package_ledger
     WHERE driver_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [driverId, limit]
  )
  return res.rows
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/packages/packages-repository.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/packages/packages.types.ts api/src/modules/packages/packages.repository.ts api/tests/unit/packages/packages-repository.test.ts
git commit -m "feat(packages): add package wallet/tier repository reads"
```

---

### Task 3: Package wallet service — consume, credit, admin-adjust (ledger transaction)

**Files:**
- Modify: `api/src/modules/packages/packages.repository.ts` (add mutating functions)
- Create: `api/src/modules/packages/packages.service.ts`
- Test: `api/tests/unit/packages/consume-package-balance.test.ts`

This mirrors `deductCommission`'s `BEGIN`/`SELECT...FOR UPDATE`/`COMMIT` shape exactly (see `api/src/modules/payments/payments.service.ts:74-162`), swapping table names and dropping the `balance >= 0` assumption.

- [ ] **Step 1: Write the failing test — negative balance on overrun**

```ts
// api/tests/unit/packages/consume-package-balance.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args), connect: vi.fn(() => Promise.resolve(client)) },
}))

import { consumePackageBalance } from '@/modules/packages/packages.service'

function scriptConsume(currentBalance: string) {
  client.query.mockReset()
  client.query.mockImplementation((sql: string) => {
    if (sql.includes('SELECT id, balance, is_frozen')) {
      return Promise.resolve({ rows: [{ id: 9, balance: currentBalance, is_frozen: false }], rowCount: 1 })
    }
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}

describe('consumePackageBalance', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows balance to go negative when the final fare exceeds remaining balance', async () => {
    scriptConsume('50.00')
    await consumePackageBalance(BigInt(1), BigInt(42), 80)

    const updateCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE driver_package_wallets'))
    expect(updateCall).toBeDefined()
    expect(updateCall?.[1]).toEqual([9, -30, 80])
  })

  it('writes a ride_consumption ledger row with direction debit', async () => {
    scriptConsume('200.00')
    await consumePackageBalance(BigInt(2), BigInt(42), 80)

    const ledgerCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO driver_package_ledger'))
    expect(ledgerCall).toBeDefined()
    expect(ledgerCall?.[0]).toContain("'ride_consumption'")
    expect(ledgerCall?.[0]).toContain("'debit'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/packages/consume-package-balance.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the service**

```ts
// api/src/modules/packages/packages.service.ts
import { pool } from '@/db/client'

async function writeLedgerEntry(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
  args: {
    walletId: number
    driverId: bigint
    entryType: 'topup' | 'ride_consumption' | 'admin_adjustment'
    amount: number
    direction: 'credit' | 'debit'
    balanceAfter: number
    rideId?: bigint
    referenceId?: string
    note?: string
    createdBy?: bigint
  }
): Promise<void> {
  await client.query(
    `INSERT INTO driver_package_ledger (
       wallet_id, driver_id, entry_type, amount, direction, balance_after,
       ride_id, reference_id, note, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      args.walletId, args.driverId, args.entryType, args.amount, args.direction,
      args.balanceAfter, args.rideId ?? null, args.referenceId ?? null,
      args.note ?? null, args.createdBy ?? null,
    ]
  )
}

// Debits the ride's full final fare from the driver's package balance.
// Balance CAN go negative (see migration 078) — that's what blocks the next
// ride offer (see Task 4's broadcast-query branch), it doesn't retroactively
// block the ride that was already assigned.
export async function consumePackageBalance(
  rideId: bigint,
  driverId: bigint,
  fareAmount: number
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_package_wallets (driver_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (driver_id) DO NOTHING`,
      [driverId]
    )

    const walletRes = await client.query(
      `SELECT id, balance, is_frozen FROM driver_package_wallets WHERE driver_id = $1 FOR UPDATE`,
      [driverId]
    )
    const wallet = walletRes.rows[0] as { id: number; balance: string; is_frozen: boolean } | undefined
    if (!wallet) {
      await client.query('ROLLBACK')
      return
    }

    const currentBalance = parseFloat(wallet.balance)
    const newBalance = Math.round((currentBalance - fareAmount) * 100) / 100

    await client.query(
      `UPDATE driver_package_wallets
       SET balance = $2, lifetime_consumed = lifetime_consumed + $3, updated_at = now()
       WHERE id = $1`,
      [wallet.id, newBalance, fareAmount]
    )

    await writeLedgerEntry(client, {
      walletId: wallet.id, driverId, entryType: 'ride_consumption',
      amount: fareAmount, direction: 'debit', balanceAfter: newBalance,
      rideId, note: `Ride #${rideId} fare ₹${fareAmount}`,
    })

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Credits a package purchase onto the driver's balance (additive top-up).
export async function creditPackageBalance(
  driverId: bigint,
  thresholdValue: number,
  referenceId: string
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_package_wallets (driver_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (driver_id) DO NOTHING`,
      [driverId]
    )

    const walletRes = await client.query(
      `SELECT id, balance FROM driver_package_wallets WHERE driver_id = $1 FOR UPDATE`,
      [driverId]
    )
    const wallet = walletRes.rows[0] as { id: number; balance: string }
    const newBalance = Math.round((parseFloat(wallet.balance) + thresholdValue) * 100) / 100

    await client.query(
      `UPDATE driver_package_wallets
       SET balance = $2, lifetime_topup = lifetime_topup + $3, updated_at = now()
       WHERE id = $1`,
      [wallet.id, newBalance, thresholdValue]
    )

    await writeLedgerEntry(client, {
      walletId: wallet.id, driverId, entryType: 'topup',
      amount: thresholdValue, direction: 'credit', balanceAfter: newBalance,
      referenceId, note: `Package recharge ₹${thresholdValue} threshold`,
    })

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// Admin support tool: signed amount (+credit / -debit), reason required.
export async function adjustPackageBalance(
  driverId: bigint,
  signedAmount: number,
  reason: string,
  adminId: bigint
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO driver_package_wallets (driver_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (driver_id) DO NOTHING`,
      [driverId]
    )

    const walletRes = await client.query(
      `SELECT id, balance FROM driver_package_wallets WHERE driver_id = $1 FOR UPDATE`,
      [driverId]
    )
    const wallet = walletRes.rows[0] as { id: number; balance: string }
    const newBalance = Math.round((parseFloat(wallet.balance) + signedAmount) * 100) / 100

    await client.query(
      `UPDATE driver_package_wallets SET balance = $2, updated_at = now() WHERE id = $1`,
      [wallet.id, newBalance]
    )

    await writeLedgerEntry(client, {
      walletId: wallet.id, driverId, entryType: 'admin_adjustment',
      amount: Math.abs(signedAmount), direction: signedAmount >= 0 ? 'credit' : 'debit',
      balanceAfter: newBalance, note: reason, createdBy: adminId,
    })

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

Run: `cd api && npx vitest run tests/unit/packages/consume-package-balance.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/packages/packages.service.ts api/tests/unit/packages/consume-package-balance.test.ts
git commit -m "feat(packages): add consume/credit/adjust package balance service functions"
```

---

### Task 4: Broadcast query — package-mode branch in `findNearbyDrivers`

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts:99-139`
- Test: `api/tests/unit/rides/find-nearby-drivers-package-gate.test.ts`

This adds a `LEFT JOIN LATERAL` for nearest-city lookup (mirroring the `ST_Distance(centroid, ...)` idiom already used in `geo.repository.ts`'s `findNearestCity`) and a `LEFT JOIN driver_package_wallets`, then branches eligibility per-row.

- [ ] **Step 1: Write the failing test**

```ts
// api/tests/unit/rides/find-nearby-drivers-package-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))

import { findNearbyDrivers } from '@/modules/rides/rides.repository'

describe('findNearbyDrivers — package-mode city gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('branches eligibility on the nearest city billing_mode via SQL, not a JS filter', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] })
    await findNearbyDrivers({ lat: 20.29, lng: 85.82, categoryId: BigInt(1), minWalletBalance: 500 })

    const sql = poolQuery.mock.calls[0]?.[0] as string
    expect(sql).toContain('LEFT JOIN LATERAL')
    expect(sql).toContain('driver_package_wallets')
    expect(sql).toContain("nc.billing_mode = 'package'")
    expect(sql).toContain("nc.billing_mode = 'commission'")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/find-nearby-drivers-package-gate.test.ts`
Expected: FAIL — SQL doesn't contain `LEFT JOIN LATERAL` yet

- [ ] **Step 3: Modify `findNearbyDrivers`**

Replace the query in `api/src/modules/rides/rides.repository.ts:99-139` with:

```ts
export async function findNearbyDrivers(params: {
  lat: number
  lng: number
  categoryId: bigint
  radiusMetres?: number
  maxDrivers?: number
  minWalletBalance: number
}): Promise<NearbyDriver[]> {
  const radius = params.radiusMetres ?? 5000
  const max    = params.maxDrivers ?? 5
  const res = await pool.query<NearbyDriver>(
    `SELECT
       dls.driver_id,
       ds.id AS session_id,
       ds.mode,
       ST_Y(dls.location::geometry) AS lat,
       ST_X(dls.location::geometry) AS lng,
       ST_Distance(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography
       ) AS distance_metres
     FROM driver_location_snapshots dls
     JOIN driver_sessions ds ON ds.id = dls.session_id
     LEFT JOIN driver_wallets dw ON dw.driver_id = ds.driver_id
     LEFT JOIN driver_package_wallets dpw ON dpw.driver_id = ds.driver_id
     LEFT JOIN LATERAL (
       SELECT c.billing_mode
       FROM cities c
       WHERE c.status = 'active'
       ORDER BY c.centroid <-> dls.location::geometry
       LIMIT 1
     ) nc ON true
     WHERE dls.is_available = true
       AND ds.status = 'online'
       AND ds.mode = 'standard'
       AND ds.category_id = $3
       AND (
         (nc.billing_mode = 'commission' AND COALESCE(dw.balance, 0) >= $6 AND NOT COALESCE(dw.is_frozen, false))
         OR
         (nc.billing_mode = 'package' AND COALESCE(dpw.balance, 0) > 0 AND NOT COALESCE(dpw.is_frozen, false))
         OR
         nc.billing_mode IS NULL
       )
       AND ST_DWithin(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         $4
       )
     ORDER BY distance_metres ASC
     LIMIT $5`,
    [params.lat, params.lng, params.categoryId, radius, max, params.minWalletBalance]
  )
  return res.rows
}
```

The `nc.billing_mode IS NULL` clause covers the case where no `active` city is within reach (e.g. a driver testing far outside any configured city radius) — falls back to allowing the existing commission-style wallet check to have already gated them via `minWalletBalance` in the first OR-branch; in practice this only matters in dev/staging with sparse city data, since production cities cover all real operating areas.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/find-nearby-drivers-package-gate.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full existing rides test suite to check for regressions**

Run: `cd api && npx vitest run tests/unit/rides/`
Expected: all pre-existing tests still PASS (in particular `find-nearby-drivers-wallet-gate.test.ts` — the commission-mode path must be byte-for-byte unaffected when `nc.billing_mode = 'commission'`)

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/tests/unit/rides/find-nearby-drivers-package-gate.test.ts
git commit -m "feat(rides): branch broadcast eligibility on nearest city's billing mode"
```

---

### Task 5: Broadcast query — same branch in `findReturnCabDrivers`

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts:168-211`

- [ ] **Step 1: Modify `findReturnCabDrivers`**

Apply the identical `LEFT JOIN LATERAL` + `driver_package_wallets` + OR-branch pattern from Task 4, keyed off `dls.location` (already joined in this query):

```ts
export async function findReturnCabDrivers(params: {
  pickupLat: number
  pickupLng: number
  dropLat: number
  dropLng: number
  categoryId: bigint
  minWalletBalance: number
}): Promise<NearbyDriver[]> {
  const res = await pool.query<NearbyDriver>(
    `SELECT
       rcr.driver_id,
       rcr.session_id,
       ds.mode,
       ST_Y(dls.location::geometry) AS lat,
       ST_X(dls.location::geometry) AS lng,
       ST_Distance(
         dls.location,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography
       ) AS distance_metres
     FROM return_cab_routes rcr
     JOIN driver_sessions ds ON ds.id = rcr.session_id
     JOIN driver_location_snapshots dls ON dls.driver_id = rcr.driver_id
     LEFT JOIN driver_wallets dw ON dw.driver_id = rcr.driver_id
     LEFT JOIN driver_package_wallets dpw ON dpw.driver_id = rcr.driver_id
     LEFT JOIN LATERAL (
       SELECT c.billing_mode
       FROM cities c
       WHERE c.status = 'active'
       ORDER BY c.centroid <-> dls.location::geometry
       LIMIT 1
     ) nc ON true
     WHERE rcr.is_active = true
       AND ds.status = 'online'
       AND ds.category_id = $5
       AND (
         (nc.billing_mode = 'commission' AND COALESCE(dw.balance, 0) >= $6 AND NOT COALESCE(dw.is_frozen, false))
         OR
         (nc.billing_mode = 'package' AND COALESCE(dpw.balance, 0) > 0 AND NOT COALESCE(dpw.is_frozen, false))
         OR
         nc.billing_mode IS NULL
       )
       AND ST_DWithin(
         rcr.corridor,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         rcr.match_radius_metres
       )
       AND ST_DWithin(
         rcr.corridor,
         ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography,
         rcr.match_radius_metres
       )
     ORDER BY distance_metres ASC
     LIMIT 3`,
    [params.pickupLat, params.pickupLng, params.dropLat, params.dropLng, params.categoryId, params.minWalletBalance]
  )
  return res.rows
}
```

- [ ] **Step 2: Run the existing return-cab test suite**

Run: `cd api && npx vitest run tests/unit/rides/ -t "return"`
Expected: all pre-existing return-cab-related tests PASS

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts
git commit -m "feat(rides): apply billing-mode branch to return-cab driver matching"
```

---

### Task 6: `goOnline()` — skip wallet-balance gate for package-mode drivers

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts:122-161` (the `goOnline` function)
- Test: `api/tests/unit/rides/go-online-package-mode.test.ts`

Per the spec, a package-mode driver can go online at zero balance — they just won't be offered rides (enforced in Tasks 4/5). This resolves the driver's nearest city the same LATERAL way, at go-online time, using their supplied `lat`/`lng`.

- [ ] **Step 1: Write the failing test**

```ts
// api/tests/unit/rides/go-online-package-mode.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}))
vi.mock('@/modules/drivers/driver-verification.repository', () => ({
  getTodayStatus: vi.fn(() => Promise.resolve({ selfieDone: true, plateDone: true })),
}))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendAdminDriverUpdate: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository', () => ({
  getActiveSession: vi.fn(() => Promise.resolve(null)),
  createSession: vi.fn(() => Promise.resolve({ id: '1' })),
  upsertDriverLocation: vi.fn(() => Promise.resolve()),
}))
const getMinWalletBalance = vi.fn(() => Promise.resolve(500))
const getDriverWallet = vi.fn(() => Promise.resolve({ balance: '0', is_frozen: false }))
vi.mock('@/modules/payments/payments.service', () => ({
  getMinWalletBalance: (...a: unknown[]) => getMinWalletBalance(...a),
  getDriverWallet: (...a: unknown[]) => getDriverWallet(...a),
}))

import { goOnline } from '@/modules/rides/rides.service'

describe('goOnline — package-mode city skips wallet-balance gate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows a zero-balance driver online when nearest city is package-mode', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ billing_mode: 'package' }] }) // nearest-city lookup

    await expect(goOnline(BigInt(1), {
      mode: 'standard', vehicleId: BigInt(1), categoryId: BigInt(1), lat: 20.29, lng: 85.82,
    })).resolves.toBeDefined()
  })

  it('still blocks a zero-balance driver in a commission-mode city', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ billing_mode: 'commission' }] })

    await expect(goOnline(BigInt(1), {
      mode: 'standard', vehicleId: BigInt(1), categoryId: BigInt(1), lat: 20.29, lng: 85.82,
    })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/go-online-package-mode.test.ts`
Expected: FAIL — second test currently passes/fails differently since the gate isn't city-aware yet (first test fails: wallet gate throws regardless of city)

- [ ] **Step 3: Modify `goOnline`**

In `api/src/modules/rides/rides.service.ts`, replace:

```ts
  const [minBalance, wallet] = await Promise.all([getMinWalletBalance(), getDriverWallet(driverId)])
  if (wallet?.is_frozen) {
    throw createHttpError(AppErrors.WALLET_FROZEN)
  }
  const balance = wallet ? parseFloat(wallet.balance) : 0
  if (balance < minBalance) {
    throw createHttpError(AppErrors.LOW_WALLET_BALANCE)
  }
```

with:

```ts
  const cityRes = await pool.query<{ billing_mode: 'commission' | 'package' }>(
    `SELECT billing_mode FROM cities
     WHERE status = 'active'
     ORDER BY centroid <-> ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geometry
     LIMIT 1`,
    [data.lat, data.lng]
  )
  const billingMode = cityRes.rows[0]?.billing_mode ?? 'commission'

  if (billingMode === 'commission') {
    const [minBalance, wallet] = await Promise.all([getMinWalletBalance(), getDriverWallet(driverId)])
    if (wallet?.is_frozen) {
      throw createHttpError(AppErrors.WALLET_FROZEN)
    }
    const balance = wallet ? parseFloat(wallet.balance) : 0
    if (balance < minBalance) {
      throw createHttpError(AppErrors.LOW_WALLET_BALANCE)
    }
  }
  // package-mode: no gate here — a zero/negative package balance only blocks
  // new ride offers (see findNearbyDrivers/findReturnCabDrivers), not going online.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/go-online-package-mode.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the existing goOnline test suite for regressions**

Run: `cd api && npx vitest run tests/unit/rides/go-online-low-balance.test.ts`
Expected: PASS unchanged (that test presumably doesn't mock the new city query — update its mock to return `{ rows: [{ billing_mode: 'commission' }] }` for the nearest-city `pool.query` call if it breaks, since it's asserting commission-mode behavior)

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/go-online-package-mode.test.ts
git commit -m "feat(rides): skip wallet-balance gate in goOnline for package-mode cities"
```

---

### Task 7: Snapshot billing mode onto the ride at assignment time

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts` (`acceptAssignment`, currently ~L770-839)
- Test: `api/tests/unit/rides/accept-assignment-billing-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// api/tests/unit/rides/accept-assignment-billing-snapshot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({
  pool: { connect: vi.fn(() => Promise.resolve(client)) },
}))

import { acceptAssignment } from '@/modules/rides/rides.repository'

describe('acceptAssignment — billing_mode_snapshot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes billing_mode_snapshot atomically with the ride acceptance UPDATE', async () => {
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('UPDATE rides')) return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 })
      if (sql.includes('SELECT id FROM driver_sessions')) return Promise.resolve({ rows: [{ id: 5 }] })
      if (sql.includes('UPDATE ride_assignments SET status = \'cancelled\'')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [], rowCount: 0 })
    })

    await acceptAssignment(BigInt(1), BigInt(42), 'package')

    const rideUpdateCall = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('UPDATE rides'))
    expect(rideUpdateCall?.[0]).toContain('billing_mode_snapshot')
    expect(rideUpdateCall?.[1]).toEqual([BigInt(1), BigInt(42), 'package'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/accept-assignment-billing-snapshot.test.ts`
Expected: FAIL — `acceptAssignment` doesn't take a third argument yet

- [ ] **Step 3: Modify `acceptAssignment`**

Change the signature and the first `UPDATE rides` query:

```ts
export async function acceptAssignment(
  rideId: bigint,
  driverId: bigint,
  billingMode: 'commission' | 'package'
): Promise<string[] | false> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const rideRes = await client.query(
      `UPDATE rides
       SET status = 'accepted',
           driver_id = $2,
           accepted_at = now(),
           billing_mode_snapshot = $3
       WHERE id = $1 AND status = 'requested'
       RETURNING id`,
      [rideId, driverId, billingMode]
    )

    // ... rest of the function body is unchanged from the existing implementation ...
```

Leave every line after the `rideRes` query exactly as it already is (the `ride_assignments` cancel/accept updates, `driver_sessions`/`driver_location_snapshots` updates, commit/rollback boilerplate).

- [ ] **Step 4: Find and update the caller**

Run: `cd api && grep -rn "acceptAssignment(" src/`
This will show the route/service caller (the ride-accept endpoint). At that call site, resolve `billingMode` the same nearest-city way used in Task 6 (query `cities.billing_mode` ordered by distance to the ride's pickup point — reuse `ride.origin_lat`/`origin_lng` already on the `rides` row) and pass it as the third argument. Update that call site's TypeScript to pass the resolved mode; there is exactly one production caller to update.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/accept-assignment-billing-snapshot.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full rides suite for regressions on the caller change**

Run: `cd api && npx vitest run tests/unit/rides/`
Expected: all PASS; fix any test that constructs a call to `acceptAssignment` with only two arguments by adding the third.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/tests/unit/rides/accept-assignment-billing-snapshot.test.ts
git commit -m "feat(rides): snapshot billing_mode onto ride at assignment time"
```

---

### Task 8: Settlement — branch `confirmRidePayment` and `collectCash` on the snapshot

**Files:**
- Modify: `api/src/modules/payments/payments.service.ts` (`confirmRidePayment`, ~L232-258)
- Modify: `api/src/modules/rides/rides.service.ts` (`collectCash`, ~L1702-1763)
- Test: `api/tests/unit/payments/settle-package-mode-ride.test.ts`

Both are the two settlement chokepoints that currently call `deductCommission` unconditionally. Each needs to read `rides.billing_mode_snapshot` and call `consumePackageBalance` instead when it's `'package'`.

- [ ] **Step 1: Write the failing test for `confirmRidePayment`**

```ts
// api/tests/unit/payments/settle-package-mode-ride.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }))

const deductCommission = vi.fn(() => Promise.resolve())
vi.mock('@/modules/payments/payments.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/payments/payments.service')>()
  return { ...actual, deductCommission: (...a: unknown[]) => deductCommission(...a) }
})
const consumePackageBalance = vi.fn(() => Promise.resolve())
vi.mock('@/modules/packages/packages.service', () => ({
  consumePackageBalance: (...a: unknown[]) => consumePackageBalance(...a),
}))
vi.mock('@/modules/payments/submodules/settlements/settlements.service', () => ({
  accrueDriverEarning: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/modules/payments/payments.service', () => ({}))

import { confirmRidePayment } from '@/modules/payments/payments.service'

describe('confirmRidePayment — package-mode branch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls consumePackageBalance instead of deductCommission when billing_mode_snapshot is package', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [{ driver_id: '42', user_id: '7', amount: '80.00' }], rowCount: 1 }) // UPDATE payments
      .mockResolvedValueOnce({ rows: [{ billing_mode_snapshot: 'package' }] }) // SELECT rides billing mode

    await confirmRidePayment(BigInt(1))

    expect(consumePackageBalance).toHaveBeenCalledWith(BigInt(1), BigInt(42), 80)
    expect(deductCommission).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/payments/settle-package-mode-ride.test.ts`
Expected: FAIL — `confirmRidePayment` always calls `deductCommission`

- [ ] **Step 3: Modify `confirmRidePayment`**

```ts
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
  const rideRes = await pool.query<{ billing_mode_snapshot: 'commission' | 'package' | null }>(
    `SELECT billing_mode_snapshot FROM rides WHERE id = $1`,
    [rideId]
  )
  const billingMode = rideRes.rows[0]?.billing_mode_snapshot ?? 'commission'

  if (billingMode === 'package') {
    await consumePackageBalance(rideId, BigInt(row.driver_id), parseFloat(row.amount))
  } else {
    await deductCommission(rideId, BigInt(row.driver_id))
  }
  await accrueDriverEarning(rideId, BigInt(row.driver_id))
  await creditCashback(rideId, BigInt(row.user_id), parseFloat(row.amount))
  return true
}
```

Add the import at the top of `payments.service.ts`: `import { consumePackageBalance } from '@/modules/packages/packages.service'`.

- [ ] **Step 4: Modify `collectCash`**

In `api/src/modules/rides/rides.service.ts`, the `collectCash` function currently does:

```ts
  // ponytail: settlement helpers aren't in one txn; a mid-settlement crash won't auto-retry
  await createPaymentRecord(rideId, 'cash_direct')
  await deductCommission(rideId, driverId)
```

Replace the `deductCommission` line with:

```ts
  // ponytail: settlement helpers aren't in one txn; a mid-settlement crash won't auto-retry
  await createPaymentRecord(rideId, 'cash_direct')
  if (ride.billing_mode_snapshot === 'package') {
    await consumePackageBalance(rideId, driverId, fare)
  } else {
    await deductCommission(rideId, driverId)
  }
```

`ride` (from `repo.getRideById(rideId)` earlier in the function) and `fare` (already computed a few lines above from `fare_snapshots`) are both already in scope — no new query needed. Add the import: `import { consumePackageBalance } from '@/modules/packages/packages.service'` near the existing `deductCommission` import at the top of the file.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/payments/settle-package-mode-ride.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full payments + rides suites for regressions**

Run: `cd api && npx vitest run tests/unit/payments/ tests/unit/rides/`
Expected: all PASS — commission-mode settlement (the `billing_mode_snapshot` is `null` or `'commission'` case) must be untouched.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/payments/payments.service.ts api/src/modules/rides/rides.service.ts api/tests/unit/payments/settle-package-mode-ride.test.ts
git commit -m "feat(payments): branch ride settlement on billing_mode_snapshot"
```

---

### Task 9: Package purchase — Razorpay order + webhook credit

**Files:**
- Modify: `api/src/modules/packages/packages.repository.ts` (add `createPurchaseOrder`, `markPurchaseCompleted`, `findPurchaseByOrderId`)
- Modify: `api/src/modules/packages/packages.service.ts` (add `createPackagePurchaseOrder`)
- Modify: `api/src/modules/payments/payments.service.ts` (`handleWebhookEvent`'s `payment.captured` branch)
- Test: `api/tests/unit/packages/package-purchase-webhook.test.ts`

- [ ] **Step 1: Add repository functions**

```ts
// append to api/src/modules/packages/packages.repository.ts
export async function createPurchaseOrder(args: {
  driverId: bigint
  tierId: bigint
  amount: number
  thresholdValue: number
  razorpayOrderId: string
}): Promise<{ id: string }> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO package_purchase_orders
       (driver_id, package_tier_id, amount, threshold_value, razorpay_order_id, status)
     VALUES ($1,$2,$3,$4,$5,'pending')
     RETURNING id`,
    [args.driverId, args.tierId, args.amount, args.thresholdValue, args.razorpayOrderId]
  )
  return res.rows[0]!
}

export async function findPendingPurchaseByOrderId(
  razorpayOrderId: string
): Promise<{ id: string; driver_id: string; threshold_value: string } | null> {
  const res = await pool.query(
    `SELECT id, driver_id, threshold_value FROM package_purchase_orders
     WHERE razorpay_order_id = $1 AND status = 'pending'`,
    [razorpayOrderId]
  )
  return res.rows[0] ?? null
}

export async function markPurchaseCompleted(id: string, razorpayPaymentId: string): Promise<void> {
  await pool.query(
    `UPDATE package_purchase_orders
     SET status = 'completed', razorpay_payment_id = $2, completed_at = now()
     WHERE id = $1`,
    [id, razorpayPaymentId]
  )
}
```

- [ ] **Step 2: Write the failing test for the webhook credit path**

```ts
// api/tests/unit/packages/package-purchase-webhook.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }))

const findPendingPurchaseByOrderId = vi.fn()
const markPurchaseCompleted = vi.fn(() => Promise.resolve())
vi.mock('@/modules/packages/packages.repository', () => ({
  findPendingPurchaseByOrderId: (...a: unknown[]) => findPendingPurchaseByOrderId(...a),
  markPurchaseCompleted: (...a: unknown[]) => markPurchaseCompleted(...a),
}))
const creditPackageBalance = vi.fn(() => Promise.resolve())
vi.mock('@/modules/packages/packages.service', () => ({
  creditPackageBalance: (...a: unknown[]) => creditPackageBalance(...a),
}))

import { handleWebhookEvent } from '@/modules/payments/payments.service'

describe('handleWebhookEvent — payment.captured for a package purchase order', () => {
  beforeEach(() => vi.clearAllMocks())

  it('credits the package wallet when the order matches a pending package purchase', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [] })      // payment_gateway_events dedup check
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT payment_gateway_events
      .mockResolvedValueOnce({ rows: [] })      // payments ride lookup (no matching ride order)
    findPendingPurchaseByOrderId.mockResolvedValueOnce({ id: '9', driver_id: '42', threshold_value: '10000.00' })

    await handleWebhookEvent({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_123', order_id: 'order_abc' } } },
    })

    expect(creditPackageBalance).toHaveBeenCalledWith(BigInt(42), 10000, 'pay_123')
    expect(markPurchaseCompleted).toHaveBeenCalledWith('9', 'pay_123')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/packages/package-purchase-webhook.test.ts`
Expected: FAIL — webhook handler doesn't check `package_purchase_orders` yet

- [ ] **Step 4: Modify `handleWebhookEvent`'s `payment.captured` branch**

In `api/src/modules/payments/payments.service.ts`, extend the existing block:

```ts
  if (event === 'payment.captured' && (entity as { order_id?: string })?.order_id) {
    const orderId = (entity as { order_id?: string; id?: string }).order_id!
    const paymentId = (entity as { id?: string }).id ?? ''

    const pendingRes = await pool.query(
      `SELECT ride_id FROM payments WHERE razorpay_order_id = $1 AND status = 'pending'`,
      [orderId]
    )
    const pending = pendingRes.rows[0]
    if (pending) {
      await confirmRidePayment(BigInt(pending.ride_id), eventId)
      return
    }

    const packagePurchase = await packagesRepo.findPendingPurchaseByOrderId(orderId)
    if (packagePurchase) {
      await packagesService.creditPackageBalance(
        BigInt(packagePurchase.driver_id),
        parseFloat(packagePurchase.threshold_value),
        paymentId
      )
      await packagesRepo.markPurchaseCompleted(packagePurchase.id, paymentId)
    }
  }
```

Add the imports at the top of `payments.service.ts`:
```ts
import * as packagesRepo from '@/modules/packages/packages.repository'
import * as packagesService from '@/modules/packages/packages.service'
```

- [ ] **Step 5: Add the order-creation service function**

```ts
// append to api/src/modules/packages/packages.service.ts
import { config } from '@/config'
import * as repo from './packages.repository'

export async function createPackagePurchaseOrder(
  driverId: bigint,
  tierId: bigint
): Promise<{ orderId: string; key: string; amount: number } | { dev: true; credited: number }> {
  const tier = await repo.getTierById(tierId)
  if (!tier || !tier.is_active) {
    throw Object.assign(new Error('Package tier not found or inactive'), { httpStatus: 404 })
  }
  const price = parseFloat(tier.price)
  const threshold = parseFloat(tier.threshold_value)

  if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
    await creditPackageBalance(driverId, threshold, `dev_${Date.now()}`)
    return { dev: true, credited: threshold }
  }

  const Razorpay = (await import('razorpay')).default
  const rzp = new Razorpay({ key_id: config.RAZORPAY_KEY_ID, key_secret: config.RAZORPAY_KEY_SECRET })
  const order = await (rzp.orders.create as Function)({
    amount: Math.round(price * 100),
    currency: 'INR',
    receipt: `pkg_${driverId}_${Date.now()}`,
  })
  const orderId = (order as { id: string }).id

  await repo.createPurchaseOrder({
    driverId, tierId, amount: price, thresholdValue: threshold, razorpayOrderId: orderId,
  })

  return { orderId, key: config.RAZORPAY_KEY_ID, amount: price }
}
```

This mirrors `createRidePaymentOrder`'s dev-mode bypass (`payments.service.ts:334-364`) exactly, so local/staging environments without Razorpay keys configured still work end-to-end.

- [ ] **Step 6: Add the route**

Find the driver payments routes file (`grep -n "router.post" api/src/modules/payments/payments.routes.ts`) and add, following the existing `authenticate()`-gated driver route pattern used for wallet topup:

```ts
router.post('/packages/purchase/order', authenticate('driver'), async (req, res, next) => {
  try {
    const result = await packagesService.createPackagePurchaseOrder(req.driver!.id, BigInt(req.body.tierId))
    res.json(result)
  } catch (err) { next(err) }
})

router.get('/packages/tiers', authenticate('driver'), async (_req, res, next) => {
  try { res.json(await packagesRepo.listActiveTiers()) } catch (err) { next(err) }
})

router.get('/packages/wallet', authenticate('driver'), async (req, res, next) => {
  try {
    const wallet = await packagesRepo.getPackageWallet(req.driver!.id)
    res.json(wallet ?? { balance: '0', is_frozen: false })
  } catch (err) { next(err) }
})
```

Check the exact `authenticate(...)` call signature used by neighboring driver routes in this file (e.g. the wallet topup route) and match it precisely — the exploration notes above show `authenticate()` used bare in some routers; confirm which variant this specific router file uses before adding these three lines.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/packages/package-purchase-webhook.test.ts`
Expected: PASS

- [ ] **Step 8: Run the full payments suite for regressions**

Run: `cd api && npx vitest run tests/unit/payments/`
Expected: all PASS — the existing ride-payment webhook path (`pending` row found in `payments` table) must still short-circuit before ever reaching the new package-purchase lookup.

- [ ] **Step 9: Commit**

```bash
git add api/src/modules/packages/packages.repository.ts api/src/modules/packages/packages.service.ts api/src/modules/payments/payments.service.ts api/src/modules/payments/payments.routes.ts api/tests/unit/packages/package-purchase-webhook.test.ts
git commit -m "feat(packages): add Razorpay purchase order flow and webhook credit"
```

---

### Task 10: Admin backend — city billing_mode, package tier CRUD, driver balance + adjust

**Files:**
- Modify: `api/src/modules/admin/admin.repository.ts` (extend city update, add tier CRUD, add package wallet/ledger reads)
- Modify: `api/src/modules/admin/admin.service.ts` (add validation for the new endpoints)
- Modify: `api/src/modules/admin/admin.controller.ts` (add handlers)
- Modify: `api/src/modules/admin/admin.routes.ts` (register routes)
- Test: `api/tests/unit/admin/package-tiers-crud.test.ts`

- [ ] **Step 1: Extend `updateAdminCity` for `billing_mode`**

In `admin.repository.ts`, add one branch to the existing dynamic-SET builder (shown in full at `admin.repository.ts:~900`):

```ts
  if (data.billing_mode !== undefined) { sets.push(`billing_mode = $${p++}`); values.push(data.billing_mode) }
```

Add `billing_mode?: 'commission' | 'package'` to the `data` parameter type of `updateAdminCity` in both `admin.repository.ts` and `admin.service.ts`'s `updateAdminCity`, and to the destructuring in `admin.controller.ts`'s `patchAdminCity`:
```ts
    if (req.body.billing_mode !== undefined) data.billing_mode = String(req.body.billing_mode) as 'commission' | 'package'
```

- [ ] **Step 2: Write the failing test for tier CRUD**

```ts
// api/tests/unit/admin/package-tiers-crud.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a) } }))

import { createPackageTier, updatePackageTier } from '@/modules/admin/admin.repository'

describe('admin package tier CRUD', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a tier with the given price/threshold', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: '1', label: 'Small', price: '39.00', threshold_value: '1000.00' }] })
    const tier = await createPackageTier({ label: 'Small', price: 39, thresholdValue: 1000, createdBy: BigInt(1) })
    expect(tier.threshold_value).toBe('1000.00')
  })

  it('toggles is_active on update', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: '1', is_active: false }] })
    const tier = await updatePackageTier(BigInt(1), { isActive: false })
    expect(tier?.is_active).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/admin/package-tiers-crud.test.ts`
Expected: FAIL — functions don't exist yet

- [ ] **Step 4: Add tier CRUD + package wallet reads to `admin.repository.ts`**

```ts
// append to api/src/modules/admin/admin.repository.ts
import type { PackageTier, DriverPackageWallet, DriverPackageLedgerEntry } from '@/modules/packages/packages.types'

export async function listPackageTiers(): Promise<PackageTier[]> {
  const res = await pool.query<PackageTier>(
    `SELECT id, label, price, threshold_value, is_active, created_at, updated_at
     FROM package_tiers ORDER BY price ASC`
  )
  return res.rows
}

export async function createPackageTier(data: {
  label: string; price: number; thresholdValue: number; createdBy: bigint
}): Promise<PackageTier> {
  const res = await pool.query<PackageTier>(
    `INSERT INTO package_tiers (label, price, threshold_value, created_by)
     VALUES ($1,$2,$3,$4)
     RETURNING id, label, price, threshold_value, is_active, created_at, updated_at`,
    [data.label, data.price, data.thresholdValue, data.createdBy]
  )
  return res.rows[0]!
}

export async function updatePackageTier(
  id: bigint,
  data: { label?: string; price?: number; thresholdValue?: number; isActive?: boolean }
): Promise<PackageTier | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let p = 1
  if (data.label !== undefined)          { sets.push(`label = $${p++}`);           values.push(data.label) }
  if (data.price !== undefined)          { sets.push(`price = $${p++}`);           values.push(data.price) }
  if (data.thresholdValue !== undefined) { sets.push(`threshold_value = $${p++}`); values.push(data.thresholdValue) }
  if (data.isActive !== undefined)       { sets.push(`is_active = $${p++}`);       values.push(data.isActive) }
  sets.push(`updated_at = now()`)
  if (!sets.length) return null
  values.push(id)
  const res = await pool.query<PackageTier>(
    `UPDATE package_tiers SET ${sets.join(', ')} WHERE id = $${p}
     RETURNING id, label, price, threshold_value, is_active, created_at, updated_at`,
    values
  )
  return res.rows[0] ?? null
}

export async function getDriverPackageWallet(driverId: bigint): Promise<DriverPackageWallet | null> {
  const res = await pool.query<DriverPackageWallet>(
    `SELECT id, driver_id, balance, is_frozen, frozen_reason, lifetime_topup, lifetime_consumed
     FROM driver_package_wallets WHERE driver_id = $1`,
    [driverId]
  )
  return res.rows[0] ?? null
}

export async function getDriverPackageLedger(driverId: bigint, limit = 50): Promise<DriverPackageLedgerEntry[]> {
  const res = await pool.query<DriverPackageLedgerEntry>(
    `SELECT id, entry_type, amount, direction, balance_after, ride_id, reference_id, note, created_at
     FROM driver_package_ledger WHERE driver_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [driverId, limit]
  )
  return res.rows
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/admin/package-tiers-crud.test.ts`
Expected: PASS

- [ ] **Step 6: Add service validation**

```ts
// append to api/src/modules/admin/admin.service.ts
export async function listPackageTiers() {
  return repo.listPackageTiers()
}

export async function createPackageTier(data: { label: string; price: number; thresholdValue: number; createdBy: bigint }) {
  if (!data.label) throw createHttpError(AppErrors.VALIDATION_ERROR)
  if (isNaN(data.price) || data.price <= 0) throw createHttpError(AppErrors.VALIDATION_ERROR)
  if (isNaN(data.thresholdValue) || data.thresholdValue <= 0) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.createPackageTier(data)
}

export async function updatePackageTier(id: bigint, data: { label?: string; price?: number; thresholdValue?: number; isActive?: boolean }) {
  const updated = await repo.updatePackageTier(id, data)
  if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
  return updated
}

export async function getDriverPackageDetail(driverId: bigint) {
  const [wallet, ledger] = await Promise.all([
    repo.getDriverPackageWallet(driverId),
    repo.getDriverPackageLedger(driverId),
  ])
  return { wallet: wallet ?? { balance: '0', is_frozen: false }, ledger }
}

export async function adjustDriverPackageBalance(driverId: bigint, amount: number, reason: string, adminId: bigint) {
  if (!reason || !reason.trim()) throw createHttpError(AppErrors.VALIDATION_ERROR)
  if (isNaN(amount) || amount === 0) throw createHttpError(AppErrors.VALIDATION_ERROR)
  const { adjustPackageBalance } = await import('@/modules/packages/packages.service')
  await adjustPackageBalance(driverId, amount, reason, adminId)
  return repo.getDriverPackageWallet(driverId)
}
```

- [ ] **Step 7: Add controller handlers**

```ts
// append to api/src/modules/admin/admin.controller.ts
export async function getPackageTiers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.listPackageTiers()) } catch (err) { next(err) }
}

export async function postPackageTier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tier = await service.createPackageTier({
      label: String(req.body.label ?? ''),
      price: Number(req.body.price),
      thresholdValue: Number(req.body.thresholdValue),
      createdBy: req.admin!.id,
    })
    res.status(201).json(tier)
  } catch (err) { next(err) }
}

export async function patchPackageTier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data: { label?: string; price?: number; thresholdValue?: number; isActive?: boolean } = {}
    if (req.body.label !== undefined) data.label = String(req.body.label)
    if (req.body.price !== undefined) data.price = Number(req.body.price)
    if (req.body.thresholdValue !== undefined) data.thresholdValue = Number(req.body.thresholdValue)
    if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive)
    res.json(await service.updatePackageTier(BigInt(req.params['id']!), data))
  } catch (err) { next(err) }
}

export async function getDriverPackageDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.getDriverPackageDetail(BigInt(req.params['id']!))) } catch (err) { next(err) }
}

export async function patchDriverPackageBalance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const wallet = await service.adjustDriverPackageBalance(
      BigInt(req.params['id']!), Number(req.body.amount), String(req.body.reason ?? ''), req.admin!.id
    )
    res.json(wallet)
  } catch (err) { next(err) }
}
```

- [ ] **Step 8: Register routes**

In `admin.routes.ts`, near the existing cities routes:

```ts
router.get('/package-tiers',       requireAdmin('super_admin', 'ops_admin'), controller.getPackageTiers)
router.post('/package-tiers',      requireAdmin('super_admin', 'ops_admin'), controller.postPackageTier)
router.patch('/package-tiers/:id', requireAdmin('super_admin', 'ops_admin'), controller.patchPackageTier)
router.get('/drivers/:id/package',       requireAdmin('super_admin', 'ops_admin'), controller.getDriverPackageDetail)
router.patch('/drivers/:id/package/balance', requireAdmin('super_admin'), controller.patchDriverPackageBalance)
```

The balance-adjustment route is `super_admin`-only (not `ops_admin`) since it moves money — match whatever stricter role gate the codebase already uses elsewhere for `driver_wallets` admin adjustments, if one exists (`grep -n "is_frozen" api/src/modules/admin/admin.routes.ts` to find it and mirror its role list exactly).

- [ ] **Step 9: Run the full admin test suite for regressions**

Run: `cd api && npx vitest run tests/unit/admin/`
Expected: all PASS

- [ ] **Step 10: Commit**

```bash
git add api/src/modules/admin/
git commit -m "feat(admin): add package tier CRUD, city billing_mode, driver package balance endpoints"
```

---

### Task 11: Admin frontend — city billing_mode dropdown, package tiers tab

**Files:**
- Modify: `apps/admin/lib/city-api.ts`
- Create: `apps/admin/lib/package-api.ts`
- Modify: `apps/admin/app/(dashboard)/cities/page.tsx` (add dropdown to edit dialog, ~L241-246 area)
- Create: `apps/admin/app/(dashboard)/config/package-tiers/page.tsx`

- [ ] **Step 1: Extend `city-api.ts`**

```ts
// apps/admin/lib/city-api.ts — add to AdminCity interface and update() signature
export interface AdminCity {
  // ...existing fields...
  billing_mode: 'commission' | 'package'
}

export const cityApi = {
  // ...existing list/create...
  update: (id: number, data: {
    name?: string; state?: string; default_speed_limit_kmph?: number
    status?: string; is_rental_enabled?: boolean; is_return_cab_enabled?: boolean
    billing_mode?: 'commission' | 'package'
  }) =>
    api.patch(`/api/v1/admin/geo/cities/${id}`, data).then(r => r.data as AdminCity),
}
```

- [ ] **Step 2: Add the dropdown to the cities edit dialog**

In `apps/admin/app/(dashboard)/cities/page.tsx`, next to the existing `status` `<select>` (around L241-246), add:

```tsx
<div>
  <label className="text-sm font-medium text-text-secondary">Billing Mode</label>
  <select
    value={form.billing_mode}
    onChange={e => set('billing_mode', e.target.value)}
    className="mt-1 w-full rounded-md border border-border-light px-3 py-2 text-sm"
  >
    <option value="commission">Commission (flat % per ride)</option>
    <option value="package">Package (prepaid ride-value threshold)</option>
  </select>
</div>
```

Also add `billing_mode: city.billing_mode` to wherever the edit dialog's `form` state is initialized from the selected `city` row (same place `is_rental_enabled`/`status` are seeded).

- [ ] **Step 3: Create `package-api.ts`**

```ts
// apps/admin/lib/package-api.ts
import api from './api'

export interface PackageTier {
  id: number
  label: string
  price: string
  threshold_value: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DriverPackageDetail {
  wallet: { balance: string; is_frozen: boolean }
  ledger: Array<{
    id: number; entry_type: string; amount: string; direction: string
    balance_after: string; ride_id: number | null; note: string | null; created_at: string
  }>
}

export const packageApi = {
  listTiers: () => api.get('/api/v1/admin/package-tiers').then(r => r.data as PackageTier[]),
  createTier: (data: { label: string; price: number; thresholdValue: number }) =>
    api.post('/api/v1/admin/package-tiers', data).then(r => r.data as PackageTier),
  updateTier: (id: number, data: Partial<{ label: string; price: number; thresholdValue: number; isActive: boolean }>) =>
    api.patch(`/api/v1/admin/package-tiers/${id}`, data).then(r => r.data as PackageTier),
  getDriverDetail: (driverId: number) =>
    api.get(`/api/v1/admin/drivers/${driverId}/package`).then(r => r.data as DriverPackageDetail),
  adjustDriverBalance: (driverId: number, amount: number, reason: string) =>
    api.patch(`/api/v1/admin/drivers/${driverId}/package/balance`, { amount, reason }).then(r => r.data),
}
```

- [ ] **Step 4: Build the package tiers admin page**

```tsx
// apps/admin/app/(dashboard)/config/package-tiers/page.tsx
'use client'
import { useEffect, useState } from 'react'
import { packageApi, type PackageTier } from '@/lib/package-api'

export default function PackageTiersPage() {
  const [tiers, setTiers] = useState<PackageTier[]>([])
  const [form, setForm] = useState({ label: '', price: '', thresholdValue: '' })

  const load = () => packageApi.listTiers().then(setTiers)
  useEffect(() => { void load() }, [])

  const handleCreate = async () => {
    await packageApi.createTier({
      label: form.label, price: Number(form.price), thresholdValue: Number(form.thresholdValue),
    })
    setForm({ label: '', price: '', thresholdValue: '' })
    void load()
  }

  const handleToggle = async (tier: PackageTier) => {
    await packageApi.updateTier(tier.id, { isActive: !tier.is_active })
    void load()
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Package Tiers</h1>
      <table className="w-full text-sm mb-6">
        <thead>
          <tr className="text-left text-text-muted">
            <th className="py-2">Label</th><th>Price</th><th>Threshold</th><th>Active</th><th></th>
          </tr>
        </thead>
        <tbody>
          {tiers.map(t => (
            <tr key={t.id} className="border-t border-border-light">
              <td className="py-2">{t.label}</td>
              <td>₹{t.price}</td>
              <td>₹{t.threshold_value}</td>
              <td>{t.is_active ? 'Yes' : 'No'}</td>
              <td><button onClick={() => handleToggle(t)} className="text-xs underline">{t.is_active ? 'Deactivate' : 'Activate'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <input placeholder="Label" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} className="border rounded px-2 py-1 text-sm" />
        <input placeholder="Price (₹)" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="border rounded px-2 py-1 text-sm w-28" />
        <input placeholder="Threshold (₹)" value={form.thresholdValue} onChange={e => setForm({ ...form, thresholdValue: e.target.value })} className="border rounded px-2 py-1 text-sm w-32" />
        <button onClick={handleCreate} className="bg-brand-600 text-white rounded px-3 py-1 text-sm">Add Tier</button>
      </div>
    </div>
  )
}
```

Check `apps/admin/app/(dashboard)/` for the existing sidebar nav config file (`grep -rn "Rate Cards\|pricing" apps/admin/app/(dashboard)/layout.tsx apps/admin/components/`) and add a "Package Tiers" link next to the existing Pricing nav item, matching its exact `<Link>`/icon pattern.

- [ ] **Step 5: Manual verification**

Run: `cd apps/admin && pnpm dev`, log in as an admin, open Cities → edit a city → confirm the Billing Mode dropdown saves and persists on reload. Open `/config/package-tiers` → create a tier → confirm it appears and toggling Active/Deactivate persists.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/lib/city-api.ts apps/admin/lib/package-api.ts apps/admin/app/
git commit -m "feat(admin-ui): add billing_mode city dropdown and package tiers page"
```

---

### Task 12: Admin frontend — driver detail package balance + adjust modal

**Files:**
- Modify: driver detail slide-over component (locate via `grep -rn "adminDriverApi" apps/admin/app/ apps/admin/components/` — CLAUDE.md confirms `apps/admin/lib/admin-api.ts` exports `adminDriverApi`, used by the drivers list page's detail slide-over)

- [ ] **Step 1: Locate the exact driver-detail component**

Run: `grep -rln "adminDriverApi" apps/admin/app/`
This finds the driver detail slide-over file. Read it to find where existing driver financial info (e.g. wallet balance, if shown) is rendered, to match styling.

- [ ] **Step 2: Add a Package Balance section**

Add, following whatever layout pattern the existing driver-detail sections use (likely a bordered card/section):

```tsx
import { packageApi, type DriverPackageDetail } from '@/lib/package-api'
import { useEffect, useState } from 'react'

// inside the driver detail component, given `driverId: number`:
const [pkg, setPkg] = useState<DriverPackageDetail | null>(null)
const [adjustAmount, setAdjustAmount] = useState('')
const [adjustReason, setAdjustReason] = useState('')

useEffect(() => { packageApi.getDriverDetail(driverId).then(setPkg) }, [driverId])

const handleAdjust = async () => {
  if (!adjustAmount || !adjustReason.trim()) return
  await packageApi.adjustDriverBalance(driverId, Number(adjustAmount), adjustReason)
  setAdjustAmount(''); setAdjustReason('')
  packageApi.getDriverDetail(driverId).then(setPkg)
}

// JSX:
{pkg && (
  <div className="border-t border-border-light pt-4 mt-4">
    <h3 className="text-sm font-semibold mb-2">Package Balance</h3>
    <p className="text-lg">₹{pkg.wallet.balance}{pkg.wallet.is_frozen ? ' (frozen)' : ''}</p>
    <div className="flex gap-2 mt-2">
      <input placeholder="+/- amount" value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} className="border rounded px-2 py-1 text-sm w-28" />
      <input placeholder="Reason (required)" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} className="border rounded px-2 py-1 text-sm flex-1" />
      <button onClick={handleAdjust} className="bg-brand-600 text-white rounded px-3 py-1 text-sm">Adjust</button>
    </div>
    <ul className="mt-3 text-xs text-text-muted space-y-1 max-h-40 overflow-y-auto">
      {pkg.ledger.map(e => (
        <li key={e.id}>{e.created_at.slice(0,10)} — {e.entry_type} {e.direction === 'credit' ? '+' : '-'}₹{e.amount} (bal ₹{e.balance_after}){e.note ? ` — ${e.note}` : ''}</li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 3: Manual verification**

Run: `cd apps/admin && pnpm dev`, open a driver's detail view, confirm the Package Balance section renders (₹0 for a driver with no wallet row yet), submit an adjustment with a reason, confirm balance and ledger update.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/
git commit -m "feat(admin-ui): add driver package balance view and manual adjustment tool"
```

---

### Task 13: Driver app — Recharge package screen

**Files:**
- Create: `apps/driver/src/pages/RechargePackage.tsx`
- Modify: driver app router config (locate via `grep -rn "Wallet" apps/driver/src/` for where `/wallet` route is registered, add a sibling `/recharge-package` route)

This mirrors `apps/driver/src/pages/Wallet.tsx`'s inline Razorpay checkout pattern exactly (script-injection, `window.Razorpay`, dev-mode short circuit).

- [ ] **Step 1: Write the page**

```tsx
// apps/driver/src/pages/RechargePackage.tsx
import { useEffect, useState } from 'react'
import api from '../lib/api'

interface PackageTier {
  id: number
  label: string
  price: string
  threshold_value: string
}

interface PackageWallet {
  balance: string
  is_frozen: boolean
}

export default function RechargePackage() {
  const [tiers, setTiers] = useState<PackageTier[]>([])
  const [wallet, setWallet] = useState<PackageWallet | null>(null)
  const [loading, setLoading] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = () => {
    void api.get<PackageTier[]>('/api/v1/payments/packages/tiers').then(r => setTiers(r.data))
    void api.get<PackageWallet>('/api/v1/payments/packages/wallet').then(r => setWallet(r.data))
  }
  useEffect(() => { load() }, [])

  const handleBuy = async (tier: PackageTier) => {
    setLoading(tier.id)
    setMsg(null)
    try {
      const res = await api.post<{ dev?: boolean; credited?: number; orderId?: string; amount?: number; key?: string }>(
        '/api/v1/payments/packages/purchase/order',
        { tierId: tier.id }
      )
      if (res.data.dev) {
        setMsg(`₹${tier.threshold_value} threshold added!`)
        load()
        return
      }
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
        key: res.data.key,
        order_id: res.data.orderId,
        amount: (res.data.amount ?? 0) * 100,
        currency: 'INR',
        name: 'Ocar',
        description: `Package: ${tier.label}`,
        handler: async () => {
          setMsg(`₹${tier.threshold_value} threshold added!`)
          load()
        },
      })
      rzp.open()
    } catch {
      setMsg('Payment failed. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-lg font-semibold mb-1">Recharge Package</h1>
      {wallet && (
        <p className="text-sm text-gray-500 mb-4">
          Current balance: ₹{wallet.balance}{wallet.is_frozen ? ' (frozen)' : ''}
        </p>
      )}
      <div className="space-y-2">
        {tiers.map(t => (
          <button
            key={t.id}
            onClick={() => handleBuy(t)}
            disabled={loading === t.id}
            className="w-full flex justify-between items-center border rounded-lg px-4 py-3 text-left"
          >
            <span>{t.label}</span>
            <span className="text-sm text-gray-600">₹{t.price} → ₹{t.threshold_value} rides</span>
          </button>
        ))}
      </div>
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

Run: `grep -n "wallet" apps/driver/src/App.tsx apps/driver/src/router*.tsx 2>/dev/null` (adjust filename once found) to locate the router config, then add a route entry identical in shape to the existing `/wallet` route but pointing at `RechargePackage` and path `/recharge-package`.

- [ ] **Step 3: Manual verification**

Run: `cd apps/driver && pnpm dev`, log in as a driver whose nearest city is set to `billing_mode='package'` (set via the admin Cities page from Task 11), navigate to `/recharge-package`, confirm tiers load and a dev-mode purchase (no Razorpay keys configured locally) credits the balance and updates the display.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/pages/RechargePackage.tsx apps/driver/src/App.tsx
git commit -m "feat(driver-app): add package recharge screen"
```

---

### Task 14: End-to-end manual verification and rollout check

**Files:** none (verification only)

- [ ] **Step 1: Verify commission-mode cities are fully unaffected**

With a city left at the default `billing_mode='commission'`: go online as a driver near that city, confirm the existing wallet-balance gate still applies exactly as before, complete a cash ride, confirm `driver_wallets.balance` debits by the commission % as before and `driver_package_wallets`/`driver_package_ledger` have no new rows for that driver.

- [ ] **Step 2: Verify package-mode city end-to-end**

Flip a test city to `billing_mode='package'` via the admin Cities page. As a driver near that city: go online with zero package balance (should succeed — Task 6), confirm no ride offers arrive (Task 4/5's broadcast filter), recharge via `/recharge-package` (Task 13, dev-mode credit), confirm a ride offer now arrives, accept it (confirm `rides.billing_mode_snapshot = 'package'` in the DB), complete it via cash collection, confirm `driver_package_wallets.balance` decreased by the ride's final fare and `driver_wallets` (commission wallet) was untouched.

- [ ] **Step 3: Verify the admin adjustment tool**

From the driver detail page (Task 12), submit a manual balance adjustment with a reason, confirm the balance updates and a `admin_adjustment` ledger row appears with `created_by` set to the acting admin.

- [ ] **Step 4: Run full test suites**

Run: `cd api && pnpm test`
Expected: all unit tests pass, including every test added across Tasks 1-10.

Run: `cd api && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore: fixups from end-to-end billing-mode verification"
```
