# Driver Document Verification Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make driver document eligibility a continuously-enforced invariant, split driver-claimed document expiry from platform-verified expiry, and close the re-upload-vs-approve TOCTOU race — implementing §02.1, §02.2, §02.3 of the 2026-08-24 security-hardening design.

**Architecture:** Three independent-but-ordered tasks. Task A adds a shared SQL eligibility clause reused by both `hasApprovedRequiredDocs` and the ride-broadcast candidate queries, plus force-offline on revocation inside the existing `syncDriverStatusAfterDocChange` transaction. Task B renames `valid_until` → `claimed_valid_until` (untrusted driver input) and adds `verified_valid_until` (admin-set at approval) on both document tables, then re-points every gating read at the verified column. Task C adds optimistic concurrency (`WHERE updated_at = $seenUpdatedAt`) to the two document-approval writes. Tasks are ordered A → B → C because B edits the shared clause A introduces, and C edits the approval functions B changes.

**Tech Stack:** Express + TypeScript, PostgreSQL (`pg` pool, raw SQL migrations run by `tsx src/db/migrate.ts`), Vitest (`vitest run`) with `vi.mock` module mocking. Error primitives: `httpError(status, message, code)` / `createHttpError(AppErrors.X)` from `api/src/lib/errors.ts` — both attach `.httpStatus` and `.appCode` to a plain `Error` (tests assert via `.rejects.toMatchObject({ httpStatus, appCode })`).

**Scope boundary:** Only the drivers and admin modules, the ride-broadcast candidate queries in `rides.repository.ts`, and their migrations. Do not touch ride OTP, safety, payments, or fare code — those are separate plans against the same design doc.

**Conventions confirmed from the codebase (do not deviate):**
- Migrations live in `api/src/db/migrations/`, numbered sequentially; latest existing is `090_document_expiry_notification_templates.sql`, so the new one is `091_`.
- Migrations are plain SQL files, applied by `cd api && pnpm migrate` (dev). There is **no** migration unit-test harness; migration correctness is verified by running `pnpm migrate` against the dev DB and inspecting `\d driver_documents`. Unit tests never hit a real DB — they mock `@/db/client`.
- `driver_documents` columns (from `003_m1_auth.sql` + `021_schema_align_driver_documents.sql`): `id, driver_id, doc_type, file_url, status (doc_status enum), rejection_note, reviewed_by, reviewed_at, created_at, updated_at, valid_from DATE, valid_until DATE`. `UNIQUE (driver_id, doc_type)`.
- `driver_vehicle_documents` columns (from `004_m2_vehicles.sql`): `id, vehicle_id, doc_type, file_url, doc_number, status (doc_status), rejection_note, valid_from DATE, valid_until DATE, reviewed_by, reviewed_at, created_at, updated_at`. `UNIQUE (vehicle_id, doc_type)`.
- `driver_sessions` uses `status`, `went_offline_at`, `offline_reason` (NOT `ended_at` — the design doc's `ended_at` snippet is wrong; use the real columns).
- `syncDriverStatusAfterDocChange(driverId, adminId)` in `admin.repository.ts` already runs inside `withTransaction` with a `SELECT ... FOR UPDATE` on `drivers` and calls `hasApprovedRequiredDocs(driverId, client)` for the recheck — confirmed as claimed in the audit.
- The existing session-end DB helper is `endSession(sessionId, reason)` in `rides.repository.ts` — it uses the pool (not a transaction client) and takes a `sessionId`. Because the force-offline in Task A must be **atomic inside** `syncDriverStatusAfterDocChange`'s existing transaction (same lock that decides the status flip), it issues the `UPDATE driver_sessions` on that transaction's `client` directly rather than calling `endSession`. The driver is already notified of the revocation by the existing `notifyOwner({ type: 'document_rejected' })` call in `admin.service.ts`'s `rejectDriverDoc`/`rejectVehicleDoc` and by the expiry-sweep's `notifyDocumentExpired` — so **no new socket event is added** (there is no session-end socket event in `socketEvents` to reuse, and inventing one is out of scope).

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `api/src/modules/drivers/drivers.repository.ts` | New exported `docIssueExistsSql()` shared clause; `hasApprovedRequiredDocs` refactored to use it; expiry reads re-pointed to `verified_valid_until`; upsert writes to `claimed_valid_until` | A, B |
| `api/src/modules/rides/rides.repository.ts` | `findNearbyDrivers` + `findReturnCabDrivers` candidate queries gain `AND NOT <docIssueExistsSql>` | A |
| `api/src/modules/admin/admin.repository.ts` | `syncDriverStatusAfterDocChange` force-offline; `approveDriverDoc`/`approveVehicleDoc` set `verified_valid_until` + optimistic `updated_at` guard; `listExpiringDocs` reads verified column; `listPendingVehicleDocs` returns `updated_at` | A, B, C |
| `api/src/modules/admin/admin.service.ts` | `approveDriverDoc`/`approveVehicleDoc` require `verifiedValidUntil` + `seenUpdatedAt`, throw `DOC_CHANGED` on conflict | B, C |
| `api/src/modules/admin/admin.controller.ts` | approve handlers read `verified_valid_until` + `seen_updated_at` from body | B, C |
| `api/src/modules/drivers/drivers.types.ts` | `DriverVehicleDocument` type: `valid_until` → `claimed_valid_until` + `verified_valid_until` | B |
| `api/src/db/migrations/091_verified_doc_expiry.sql` | Rename + add columns on both doc tables, backfill verified from claimed for already-approved rows | B |
| `api/tests/unit/drivers/doc-eligibility.test.ts` | Shared clause + `hasApprovedRequiredDocs` behavior | A, B |
| `api/tests/unit/rides/candidate-doc-eligibility.test.ts` | Candidate queries embed the exclusion clause | A |
| `api/tests/unit/admin/doc-force-offline.test.ts` | `syncDriverStatusAfterDocChange` ends the session on revocation | A |
| `api/tests/unit/admin/doc-approval.test.ts` | Verified-expiry requirement + optimistic-concurrency conflict | B, C |

---

## Task A: Continuous doc-eligibility enforcement

**Files:**
- Modify: `api/src/modules/drivers/drivers.repository.ts` (add `docIssueExistsSql`, refactor `hasApprovedRequiredDocs` ~L346-362)
- Modify: `api/src/modules/rides/rides.repository.ts` (`findNearbyDrivers` ~L150-167, `findReturnCabDrivers` ~L248-255)
- Modify: `api/src/modules/admin/admin.repository.ts` (`syncDriverStatusAfterDocChange` ~L358-364)
- Test: `api/tests/unit/drivers/doc-eligibility.test.ts` (new)
- Test: `api/tests/unit/rides/candidate-doc-eligibility.test.ts` (new)
- Test: `api/tests/unit/admin/doc-force-offline.test.ts` (new)

### A.1 — Extract the shared eligibility clause

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/drivers/doc-eligibility.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({
  query: vi.fn(),
  pool: { query: vi.fn() },
}))

import { query } from '@/db/client'
import { docIssueExistsSql, hasApprovedRequiredDocs } from '@/modules/drivers/drivers.repository'

describe('docIssueExistsSql', () => {
  it('builds an EXISTS check over both doc tables using the given driver-id expression', () => {
    const sql = docIssueExistsSql('ds.driver_id')
    expect(sql).toContain('EXISTS')
    expect(sql).toContain('driver_documents')
    expect(sql).toContain('driver_vehicle_documents')
    expect(sql).toContain('ds.driver_id')
    // pre-Task-B: gating still reads valid_until (Task B re-points this to verified_valid_until)
    expect(sql).toMatch(/valid_until < CURRENT_DATE/)
  })

  it('accepts a bound-parameter expression for the single-driver rollup', () => {
    expect(docIssueExistsSql('$1')).toContain('dd.driver_id = $1')
  })
})

describe('hasApprovedRequiredDocs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when no issue row exists', async () => {
    vi.mocked(query).mockResolvedValue([{ has_issue: false }] as never)
    await expect(hasApprovedRequiredDocs(BigInt(7))).resolves.toBe(true)
    const sql = vi.mocked(query).mock.calls[0]![0] as string
    expect(sql).toContain('EXISTS')
  })

  it('returns false when a rejected/expired doc issue exists', async () => {
    vi.mocked(query).mockResolvedValue([{ has_issue: true }] as never)
    await expect(hasApprovedRequiredDocs(BigInt(7))).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/drivers/doc-eligibility.test.ts`
Expected: FAIL — `docIssueExistsSql` is not exported (`No "docIssueExistsSql" export is defined`).

- [ ] **Step 3: Add `docIssueExistsSql` and refactor `hasApprovedRequiredDocs`**

In `api/src/modules/drivers/drivers.repository.ts`, replace the existing `hasApprovedRequiredDocs` function (currently ~L346-362, the block that builds `const sql = ...` with the inline `SELECT EXISTS (...)`) with:

```typescript
// Shared SQL fragment: does this driver have any required-doc issue — a rejected
// row, or an approved row whose verified expiry has passed — across identity docs
// and the primary vehicle's docs? `driverIdExpr` is ALWAYS a hardcoded SQL token
// ('$1' for the single-driver rollup, or a column like 'ds.driver_id' for the
// broadcast candidate queries) — never user input, so interpolating it is safe
// under the "only hardcoded identifiers in dynamic SQL" rule. Both hasApprovedRequiredDocs
// and the ride-broadcast candidate queries build on this so the eligibility rule
// lives in exactly one place.
export function docIssueExistsSql(driverIdExpr: string): string {
  return `EXISTS (
       SELECT 1 FROM driver_documents dd
       WHERE dd.driver_id = ${driverIdExpr}
         AND (dd.status = 'rejected' OR (dd.status = 'approved' AND dd.valid_until < CURRENT_DATE))
       UNION ALL
       SELECT 1 FROM driver_vehicle_documents dvd
       JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
       WHERE dv.driver_id = ${driverIdExpr} AND dv.is_primary = true
         AND (dvd.status = 'rejected' OR (dvd.status = 'approved' AND dvd.valid_until < CURRENT_DATE))
     )`
}

// True if none of the driver's identity/vehicle documents are rejected or an
// expired-but-still-approved row — the live rollup goOnline() gates on. Pass a
// transaction client when this must participate in a caller's lock (see
// admin.repository.ts's syncDriverStatusAfterDocChange) — otherwise runs through
// the shared pool.
export async function hasApprovedRequiredDocs(driverId: bigint, client?: PoolClient): Promise<boolean> {
  const sql = `SELECT ${docIssueExistsSql('$1')} AS has_issue`
  const params = [driverId.toString()]
  const rows = client
    ? (await client.query<{ has_issue: boolean }>(sql, params)).rows
    : await query<{ has_issue: boolean }>(sql, params)
  return !rows[0]!.has_issue
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test tests/unit/drivers/doc-eligibility.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/drivers/drivers.repository.ts api/tests/unit/drivers/doc-eligibility.test.ts
git commit -m "refactor(drivers): extract shared doc-eligibility SQL clause"
```

### A.2 — Make the broadcast candidate queries doc-aware

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/rides/candidate-doc-eligibility.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { findNearbyDrivers, findReturnCabDrivers } from '@/modules/rides/rides.repository'

function lastSql(): string {
  return vi.mocked(pool.query).mock.calls[0]![0] as unknown as string
}

describe('candidate-matching queries exclude ineligible drivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never)
  })

  it('findNearbyDrivers filters out drivers with a doc issue', async () => {
    await findNearbyDrivers({ lat: 20.29, lng: 85.82, categoryIds: [BigInt(2)], minWalletBalance: 0 })
    const sql = lastSql()
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('driver_vehicle_documents')
    expect(sql).toContain('ds.driver_id')
  })

  it('findReturnCabDrivers filters out drivers with a doc issue', async () => {
    await findReturnCabDrivers({
      pickupLat: 20.29, pickupLng: 85.82, dropLat: 19.8, dropLng: 85.83,
      categoryIds: [BigInt(2)], minWalletBalance: 0,
    })
    const sql = lastSql()
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain('rcr.driver_id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/rides/candidate-doc-eligibility.test.ts`
Expected: FAIL — `expect(sql).toContain('NOT EXISTS')` fails (clause not yet present).

- [ ] **Step 3: Add the exclusion clause to both queries**

In `api/src/modules/rides/rides.repository.ts`, add the import at the top alongside the other module imports (find the existing import block; add this line):

```typescript
import { docIssueExistsSql } from '@/modules/drivers/drivers.repository'
```

In `findNearbyDrivers`, locate the line `       AND ds.status = 'online'` (currently ~L160) and insert immediately **before** it:

```typescript
       AND NOT ${docIssueExistsSql('ds.driver_id')}
```

In `findReturnCabDrivers`, locate the line `       AND ds.status = 'online'` (currently ~L249) and insert immediately **before** it:

```typescript
       AND NOT ${docIssueExistsSql('rcr.driver_id')}
```

Both queries are template literals, so `${docIssueExistsSql(...)}` interpolates the hardcoded clause into the SQL string — no new bound parameter is added, so the existing positional `$1..$N` parameter lists are unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test tests/unit/rides/candidate-doc-eligibility.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck (cross-module import)**

Run: `cd api && npx tsc --noEmit`
Expected: no errors (confirms the new `rides → drivers` repository import resolves and is not circular at type level).

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/tests/unit/rides/candidate-doc-eligibility.test.ts
git commit -m "feat(rides): exclude doc-ineligible drivers from broadcast candidate pool"
```

### A.3 — Force the driver offline on document revocation

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/admin/doc-force-offline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fakeClient } = vi.hoisted(() => ({ fakeClient: { query: vi.fn() } }))

vi.mock('@/db/client', () => ({
  pool: { query: vi.fn() },
  withTransaction: async (fn: (c: typeof fakeClient) => unknown) => fn(fakeClient),
}))
vi.mock('@/modules/drivers/drivers.repository', () => ({
  hasApprovedRequiredDocs: vi.fn(),
}))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))

import { hasApprovedRequiredDocs } from '@/modules/drivers/drivers.repository'
import { syncDriverStatusAfterDocChange } from '@/modules/admin/admin.repository'

const DRIVER_ID = BigInt(42)
const ADMIN_ID = BigInt(1)

describe('syncDriverStatusAfterDocChange — force offline on revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeClient.query.mockImplementation((sql: string) => {
      if (String(sql).includes('SELECT status FROM drivers')) {
        return Promise.resolve({ rows: [{ status: 'active' }] })
      }
      return Promise.resolve({ rows: [] })
    })
  })

  it('ends any online session when an active driver becomes ineligible', async () => {
    vi.mocked(hasApprovedRequiredDocs).mockResolvedValue(false)

    await syncDriverStatusAfterDocChange(DRIVER_ID, ADMIN_ID)

    const sessionCall = fakeClient.query.mock.calls.find(c =>
      String(c[0]).includes('UPDATE driver_sessions'))
    expect(sessionCall).toBeTruthy()
    expect(String(sessionCall![0])).toContain("status = 'offline'")
    expect(String(sessionCall![0])).toContain("status = 'online'")
    expect(sessionCall![1]).toEqual([DRIVER_ID])
  })

  it('does NOT end sessions when the driver remains eligible', async () => {
    vi.mocked(hasApprovedRequiredDocs).mockResolvedValue(true)

    await syncDriverStatusAfterDocChange(DRIVER_ID, ADMIN_ID)

    const sessionCall = fakeClient.query.mock.calls.find(c =>
      String(c[0]).includes('UPDATE driver_sessions'))
    expect(sessionCall).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/admin/doc-force-offline.test.ts`
Expected: FAIL — first test fails at `expect(sessionCall).toBeTruthy()` (no `UPDATE driver_sessions` is issued yet).

- [ ] **Step 3: Add the force-offline write**

In `api/src/modules/admin/admin.repository.ts`, inside `syncDriverStatusAfterDocChange`, find the `!eligible && currentStatus === 'active'` branch. After its existing `INSERT INTO driver_status_history ...` call (currently ~L369, immediately before the `} else if (eligible ...` line), add:

```typescript
      // Revocation must also revoke presence: ending the session inside this same
      // FOR UPDATE transaction closes the window where a now-ineligible driver keeps
      // a live 'online' session (misleading ops dashboards + a re-check race). The
      // broadcast candidate query already excludes them from matching (see
      // docIssueExistsSql), so this is the second half of "eligibility is an
      // invariant of being online", not just a gate at go-online.
      await client.query(
        `UPDATE driver_sessions
         SET status = 'offline', went_offline_at = now(), offline_reason = 'docs_revoked'
         WHERE driver_id = $1 AND status = 'online'`,
        [driverId]
      )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test tests/unit/admin/doc-force-offline.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `cd api && pnpm test && npx tsc --noEmit`
Expected: PASS — all unit tests green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/admin/admin.repository.ts api/tests/unit/admin/doc-force-offline.test.ts
git commit -m "feat(admin): end active driver session when documents are revoked"
```

---

## Task B: Claimed vs. verified document expiry

**Files:**
- Create: `api/src/db/migrations/091_verified_doc_expiry.sql`
- Modify: `api/src/modules/drivers/drivers.repository.ts` (`docIssueExistsSql`, `upsertDriverDocument`, `upsertVehicleDocument`, `findDocsNeedingExpiryNotice`)
- Modify: `api/src/modules/admin/admin.repository.ts` (`listExpiringDocs`, `approveDriverDoc`, `approveVehicleDoc`)
- Modify: `api/src/modules/admin/admin.service.ts` (`approveDriverDoc`, `approveVehicleDoc`)
- Modify: `api/src/modules/admin/admin.controller.ts` (`approveDriverDoc`, `approveVehicleDoc`)
- Modify: `api/src/modules/drivers/drivers.types.ts` (`DriverVehicleDocument`)
- Test: `api/tests/unit/drivers/doc-eligibility.test.ts` (update expiry assertion)
- Test: `api/tests/unit/admin/doc-approval.test.ts` (new)

### B.1 — Migration: split claimed vs verified expiry

- [ ] **Step 1: Write the migration file**

Create `api/src/db/migrations/091_verified_doc_expiry.sql`:

```sql
-- Separate the driver's *claimed* document expiry (taken verbatim from the upload
-- request body, untrusted) from the platform-*verified* expiry an admin sets at
-- approval time. All gating (hasApprovedRequiredDocs, the broadcast candidate
-- queries, expiry reminders) reads verified_valid_until ONLY — claimed_valid_until
-- becomes informational, shown to the admin reviewer as a cross-check, never trusted.

ALTER TABLE driver_documents RENAME COLUMN valid_until TO claimed_valid_until;
ALTER TABLE driver_documents ADD COLUMN verified_valid_until DATE;

ALTER TABLE driver_vehicle_documents RENAME COLUMN valid_until TO claimed_valid_until;
ALTER TABLE driver_vehicle_documents ADD COLUMN verified_valid_until DATE;

-- Backfill: existing approved rows were implicitly accepted at their claimed expiry
-- under the old schema. Without this, every already-approved doc would have a NULL
-- verified_valid_until and so read as "never expires" (NULL < CURRENT_DATE is NULL),
-- silently un-expiring currently-active drivers. Copy claimed -> verified for approved
-- rows only; pending/rejected rows stay NULL and must be set at (re-)approval.
UPDATE driver_documents
  SET verified_valid_until = claimed_valid_until
  WHERE status = 'approved' AND claimed_valid_until IS NOT NULL;
UPDATE driver_vehicle_documents
  SET verified_valid_until = claimed_valid_until
  WHERE status = 'approved' AND claimed_valid_until IS NOT NULL;
```

- [ ] **Step 2: Apply and verify the migration against the dev DB**

Run: `cd api && pnpm migrate`
Expected: output includes `091_verified_doc_expiry.sql` applied with no error.

Then confirm the columns exist:

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "\d driver_documents" -c "\d driver_vehicle_documents"`
Expected: both tables list `claimed_valid_until | date` and `verified_valid_until | date`, and neither lists `valid_until`.

- [ ] **Step 3: Commit**

```bash
git add api/src/db/migrations/091_verified_doc_expiry.sql
git commit -m "feat(db): split claimed vs verified document expiry (091)"
```

### B.2 — Re-point gating reads at `verified_valid_until`, writes at `claimed_valid_until`

- [ ] **Step 1: Update the failing test expectation**

In `api/tests/unit/drivers/doc-eligibility.test.ts`, change the assertion in the first `docIssueExistsSql` test from:

```typescript
    // pre-Task-B: gating still reads valid_until (Task B re-points this to verified_valid_until)
    expect(sql).toMatch(/valid_until < CURRENT_DATE/)
```

to:

```typescript
    // gating reads the admin-verified expiry only, never the driver's claim
    expect(sql).toContain('verified_valid_until < CURRENT_DATE')
    expect(sql).not.toContain('claimed_valid_until')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/drivers/doc-eligibility.test.ts`
Expected: FAIL — `expect(sql).toContain('verified_valid_until < CURRENT_DATE')` fails (clause still says `dd.valid_until`).

- [ ] **Step 3: Update `docIssueExistsSql`**

In `api/src/modules/drivers/drivers.repository.ts`, in `docIssueExistsSql`, change both expiry predicates from `dd.valid_until < CURRENT_DATE` / `dvd.valid_until < CURRENT_DATE` to the verified column:

```typescript
export function docIssueExistsSql(driverIdExpr: string): string {
  return `EXISTS (
       SELECT 1 FROM driver_documents dd
       WHERE dd.driver_id = ${driverIdExpr}
         AND (dd.status = 'rejected' OR (dd.status = 'approved' AND dd.verified_valid_until < CURRENT_DATE))
       UNION ALL
       SELECT 1 FROM driver_vehicle_documents dvd
       JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
       WHERE dv.driver_id = ${driverIdExpr} AND dv.is_primary = true
         AND (dvd.status = 'rejected' OR (dvd.status = 'approved' AND dvd.verified_valid_until < CURRENT_DATE))
     )`
}
```

- [ ] **Step 4: Update the upsert writes to the claimed column**

In `api/src/modules/drivers/drivers.repository.ts`, in `upsertDriverDocument`, change the INSERT/ON CONFLICT (currently ~L286-295) so `valid_until` becomes `claimed_valid_until`:

```typescript
    `INSERT INTO driver_documents (driver_id, doc_type, file_url, valid_from, claimed_valid_until)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (driver_id, doc_type)
     DO UPDATE SET
       file_url            = EXCLUDED.file_url,
       valid_from          = COALESCE(EXCLUDED.valid_from,          driver_documents.valid_from),
       claimed_valid_until = COALESCE(EXCLUDED.claimed_valid_until, driver_documents.claimed_valid_until),
       status              = 'pending',
       updated_at          = now()
     RETURNING *`,
```

In `upsertVehicleDocument`, change the INSERT/ON CONFLICT (currently ~L318-327) likewise:

```typescript
    `INSERT INTO driver_vehicle_documents (vehicle_id, doc_type, file_url, doc_number, claimed_valid_until)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (vehicle_id, doc_type)
     DO UPDATE SET
       file_url            = EXCLUDED.file_url,
       doc_number          = COALESCE(EXCLUDED.doc_number,          driver_vehicle_documents.doc_number),
       claimed_valid_until = COALESCE(EXCLUDED.claimed_valid_until, driver_vehicle_documents.claimed_valid_until),
       status              = 'pending',
       updated_at          = now()
     RETURNING *`,
```

- [ ] **Step 5: Update expiry-reminder reads to the verified column**

In `api/src/modules/drivers/drivers.repository.ts`, in `findDocsNeedingExpiryNotice` (currently ~L377-396), change every `valid_until` reference to `verified_valid_until` (four occurrences: two `(... - CURRENT_DATE)` selects and two `... IS NOT NULL` predicates):

```typescript
    `SELECT driver_id, doc_type, days_remaining, 'documents'::text AS route FROM (
       SELECT driver_id::text, doc_type,
              (verified_valid_until - CURRENT_DATE) AS days_remaining
       FROM driver_documents
       WHERE status = 'approved' AND verified_valid_until IS NOT NULL
     ) d
     WHERE days_remaining = ANY($1::int[])
     UNION ALL
     SELECT driver_id, doc_type, days_remaining, 'vehicle-docs'::text AS route FROM (
       SELECT dv.driver_id::text AS driver_id, dvd.doc_type,
              (dvd.verified_valid_until - CURRENT_DATE) AS days_remaining
       FROM driver_vehicle_documents dvd
       JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
       WHERE dvd.status = 'approved' AND dvd.verified_valid_until IS NOT NULL
     ) v
     WHERE days_remaining = ANY($1::int[])`,
```

In `api/src/modules/admin/admin.repository.ts`, in `listExpiringDocs` (currently ~L922-940), change the SELECT and WHERE to read `verified_valid_until` but keep the response field name `valid_until` (frontend contract unchanged):

```typescript
    `SELECT dvd.id, dvd.vehicle_id, dvd.doc_type, dvd.file_url, dvd.verified_valid_until AS valid_until,
            dv.number_plate, dv.vehicle_name,
            d.full_name AS driver_name, d.phone AS driver_phone, d.code AS driver_code
     FROM driver_vehicle_documents dvd
     JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
     JOIN drivers d ON d.id = dv.driver_id
     WHERE dvd.status = 'approved'
       AND dvd.verified_valid_until IS NOT NULL
       AND dvd.verified_valid_until <= now() + ($1 || ' days')::interval
       AND dvd.verified_valid_until >= now()
     ORDER BY dvd.verified_valid_until ASC`,
```

- [ ] **Step 6: Update the `DriverVehicleDocument` type**

In `api/src/modules/drivers/drivers.types.ts`, in the `DriverVehicleDocument` interface (currently ~L62-73), replace the `valid_until: string | null` line with:

```typescript
  claimed_valid_until: string | null
  verified_valid_until: string | null
```

- [ ] **Step 7: Run tests + typecheck**

Run: `cd api && pnpm test tests/unit/drivers/doc-eligibility.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests) and no type errors. If `tsc` flags a stale `valid_until` reference, grep for it (`grep -rn "\.valid_until\|'valid_until'" api/src/modules/drivers api/src/modules/admin`) and re-point any remaining gating/expiry read to `verified_valid_until` (or `claimed_valid_until` if it is a write/echo of the driver's claim).

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/drivers/drivers.repository.ts api/src/modules/admin/admin.repository.ts api/src/modules/drivers/drivers.types.ts api/tests/unit/drivers/doc-eligibility.test.ts
git commit -m "feat(drivers): gate on verified_valid_until, store driver claim separately"
```

### B.3 — Require `verified_valid_until` at approval

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/admin/doc-approval.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({
  approveDriverDoc: vi.fn(),
  approveVehicleDoc: vi.fn(),
  syncDriverStatusAfterDocChange: vi.fn(),
}))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))

import * as repo from '@/modules/admin/admin.repository'
import { approveDriverDoc } from '@/modules/admin/admin.service'

const DOC_ID = BigInt(10)
const ADMIN_ID = BigInt(1)
const SEEN = '2026-08-24T10:00:00.000Z'
const VERIFIED = '2030-01-01'

describe('approveDriverDoc — verified expiry requirement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects approval with no verified expiry date', async () => {
    await expect(approveDriverDoc(DOC_ID, ADMIN_ID, '', SEEN, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.approveDriverDoc).not.toHaveBeenCalled()
  })

  it('passes the verified expiry through to the repository on a valid approval', async () => {
    vi.mocked(repo.approveDriverDoc).mockResolvedValue({ driver_id: '42' })
    await approveDriverDoc(DOC_ID, ADMIN_ID, VERIFIED, SEEN, '1.2.3.4')
    expect(repo.approveDriverDoc).toHaveBeenCalledWith(DOC_ID, ADMIN_ID, VERIFIED, SEEN)
    expect(repo.syncDriverStatusAfterDocChange).toHaveBeenCalledWith(BigInt(42), ADMIN_ID)
  })
})
```

Note: this test already uses the final Task-C signature `approveDriverDoc(docId, adminId, verifiedValidUntil, seenUpdatedAt, ip)` and expects the repo called with `(docId, adminId, verifiedValidUntil, seenUpdatedAt)`. B.3 implements the verified-expiry half; the `seenUpdatedAt` guard/conflict is implemented in Task C. Both tests here pass a `SEEN` value so they are stable across B and C.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/admin/doc-approval.test.ts`
Expected: FAIL — `approveDriverDoc` current signature is `(docId, adminId, ipAddress)`, so the call shape and the 422 assertion both fail.

- [ ] **Step 3: Update the service `approveDriverDoc` / `approveVehicleDoc`**

In `api/src/modules/admin/admin.service.ts`, replace `approveDriverDoc` (currently ~L264-271) with:

```typescript
export async function approveDriverDoc(
  docId: bigint,
  adminId: bigint,
  verifiedValidUntil: string,
  seenUpdatedAt: string,
  ipAddress: string | null
) {
  if (!verifiedValidUntil) {
    throw httpError(422, 'Verified expiry date is required to approve a document.', 'VALIDATION_ERROR')
  }
  const approved = await repo.approveDriverDoc(docId, adminId, verifiedValidUntil, seenUpdatedAt)
  await recordAuditLog({
    adminId, action: 'driver_documents.approve', targetTable: 'driver_documents', targetId: docId,
    afterState: { status: 'approved', verified_valid_until: verifiedValidUntil }, ipAddress,
  })
  if (approved) await repo.syncDriverStatusAfterDocChange(BigInt(approved.driver_id), adminId)
}
```

Replace `approveVehicleDoc` (currently ~L294-301) with:

```typescript
export async function approveVehicleDoc(
  docId: bigint,
  adminId: bigint,
  verifiedValidUntil: string,
  seenUpdatedAt: string,
  ipAddress: string | null
) {
  if (!verifiedValidUntil) {
    throw httpError(422, 'Verified expiry date is required to approve a document.', 'VALIDATION_ERROR')
  }
  const approved = await repo.approveVehicleDoc(docId, adminId, verifiedValidUntil, seenUpdatedAt)
  await recordAuditLog({
    adminId, action: 'vehicle_documents.approve', targetTable: 'driver_vehicle_documents', targetId: docId,
    afterState: { status: 'approved', verified_valid_until: verifiedValidUntil }, ipAddress,
  })
  if (approved) await repo.syncDriverStatusAfterDocChange(BigInt(approved.driver_id), adminId)
}
```

Confirm `httpError` is imported at the top of `admin.service.ts`. If only `createHttpError` is imported, extend the import to `import { createHttpError, httpError } from '@/lib/errors'`.

- [ ] **Step 4: Update the repository `approveDriverDoc` / `approveVehicleDoc` to set the verified column**

In `api/src/modules/admin/admin.repository.ts`, replace `approveDriverDoc` (currently ~L868-878) with:

```typescript
export async function approveDriverDoc(
  docId: bigint, adminId: bigint, verifiedValidUntil: string, seenUpdatedAt: string
): Promise<{ driver_id: string } | null> {
  const res = await pool.query(
    `UPDATE driver_documents
     SET status = 'approved', verified_valid_until = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
     WHERE id = $3 AND updated_at = $4
     RETURNING driver_id`,
    [verifiedValidUntil, adminId, docId, seenUpdatedAt]
  )
  const row = res.rows[0]
  return row ? { driver_id: String(row.driver_id) } : null
}
```

Replace `approveVehicleDoc` (currently ~L894-905) with:

```typescript
export async function approveVehicleDoc(
  docId: bigint, adminId: bigint, verifiedValidUntil: string, seenUpdatedAt: string
): Promise<{ driver_id: string } | null> {
  const res = await pool.query(
    `UPDATE driver_vehicle_documents dvd
     SET status = 'approved', verified_valid_until = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
     FROM driver_vehicles dv
     WHERE dvd.id = $3 AND dvd.updated_at = $4 AND dv.id = dvd.vehicle_id
     RETURNING dv.driver_id`,
    [verifiedValidUntil, adminId, docId, seenUpdatedAt]
  )
  const row = res.rows[0]
  return row ? { driver_id: String(row.driver_id) } : null
}
```

(The `updated_at = $4` guard is the Task-C optimistic-concurrency condition; it is included here so the repository signature is final and B's test passes with a matching `updated_at`. Task C adds the conflict-handling that turns a mismatch into a 409.)

- [ ] **Step 5: Update the controller to pass the new params**

In `api/src/modules/admin/admin.controller.ts`, replace `approveDriverDoc` (currently ~L273-278) with:

```typescript
export async function approveDriverDoc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.approveDriverDoc(
      BigInt(req.params['docId']!),
      req.admin!.id,
      String(req.body.verified_valid_until ?? ''),
      String(req.body.seen_updated_at ?? ''),
      req.ip ?? null
    )
    res.json({ success: true })
  } catch (err) { next(err) }
}
```

Replace `approveVehicleDoc` (currently ~L289-294) with:

```typescript
export async function approveVehicleDoc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.approveVehicleDoc(
      BigInt(req.params['docId']!),
      req.admin!.id,
      String(req.body.verified_valid_until ?? ''),
      String(req.body.seen_updated_at ?? ''),
      req.ip ?? null
    )
    res.json({ success: true })
  } catch (err) { next(err) }
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd api && pnpm test tests/unit/admin/doc-approval.test.ts && npx tsc --noEmit`
Expected: PASS (2 tests) and no type errors.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/admin/admin.service.ts api/src/modules/admin/admin.repository.ts api/src/modules/admin/admin.controller.ts api/tests/unit/admin/doc-approval.test.ts
git commit -m "feat(admin): require admin-verified expiry to approve a document"
```

---

## Task C: Optimistic concurrency on document approval

The repository `updated_at = $4` guard was added in Task B.4 (so the signature is final). Task C adds the **conflict handling**: a mismatched/absent `updated_at` returns no row → the service raises a 409 `DOC_CHANGED` instead of silently no-opping, and the pending-doc list returns `updated_at` so the admin frontend can echo it back.

**Files:**
- Modify: `api/src/modules/admin/admin.service.ts` (`approveDriverDoc`, `approveVehicleDoc` — add 409 on conflict)
- Modify: `api/src/modules/admin/admin.repository.ts` (`listPendingVehicleDocs` — return `updated_at`)
- Modify: `api/src/modules/admin/admin.types.ts` (`PendingVehicleDoc` — add `updated_at`)
- Test: `api/tests/unit/admin/doc-approval.test.ts` (add conflict cases)

### C.1 — Raise a 409 when the document changed under the reviewer

- [ ] **Step 1: Write the failing test**

Append to the `describe('approveDriverDoc — verified expiry requirement', ...)` block in `api/tests/unit/admin/doc-approval.test.ts`:

```typescript
  it('raises a 409 DOC_CHANGED when the row was modified since the reviewer loaded it', async () => {
    // repo returns null when the WHERE updated_at = $4 guard matches no row
    vi.mocked(repo.approveDriverDoc).mockResolvedValue(null)
    await expect(approveDriverDoc(DOC_ID, ADMIN_ID, VERIFIED, SEEN, null))
      .rejects.toMatchObject({ httpStatus: 409, appCode: 'DOC_CHANGED' })
    expect(repo.syncDriverStatusAfterDocChange).not.toHaveBeenCalled()
  })

  it('rejects approval with no seen document version', async () => {
    await expect(approveDriverDoc(DOC_ID, ADMIN_ID, VERIFIED, '', null))
      .rejects.toMatchObject({ httpStatus: 400 })
    expect(repo.approveDriverDoc).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/admin/doc-approval.test.ts`
Expected: FAIL — the 409 case currently resolves (service treats `null` as a silent no-op), and the missing-`seen_updated_at` case does not throw 400 yet.

- [ ] **Step 3: Add the guard + conflict throw in the service**

In `api/src/modules/admin/admin.service.ts`, update `approveDriverDoc` — add the `seenUpdatedAt` guard after the `verifiedValidUntil` guard, and turn a `null` repo result into a 409:

```typescript
export async function approveDriverDoc(
  docId: bigint,
  adminId: bigint,
  verifiedValidUntil: string,
  seenUpdatedAt: string,
  ipAddress: string | null
) {
  if (!verifiedValidUntil) {
    throw httpError(422, 'Verified expiry date is required to approve a document.', 'VALIDATION_ERROR')
  }
  if (!seenUpdatedAt) {
    throw httpError(400, 'Missing document version. Refresh and try again.', 'VALIDATION_ERROR')
  }
  const approved = await repo.approveDriverDoc(docId, adminId, verifiedValidUntil, seenUpdatedAt)
  if (!approved) {
    throw httpError(409, 'This document was modified since you last viewed it. Refresh and try again.', 'DOC_CHANGED')
  }
  await recordAuditLog({
    adminId, action: 'driver_documents.approve', targetTable: 'driver_documents', targetId: docId,
    afterState: { status: 'approved', verified_valid_until: verifiedValidUntil }, ipAddress,
  })
  await repo.syncDriverStatusAfterDocChange(BigInt(approved.driver_id), adminId)
}
```

Apply the identical change to `approveVehicleDoc` (same two guards, same `if (!approved) throw httpError(409, ...)`, `recordAuditLog` for `vehicle_documents.approve`, then `syncDriverStatusAfterDocChange`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test tests/unit/admin/doc-approval.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/admin.service.ts api/tests/unit/admin/doc-approval.test.ts
git commit -m "feat(admin): 409 on document re-upload race during approval (TOCTOU)"
```

### C.2 — Return `updated_at` on the pending vehicle-doc list

Driver identity docs already surface `updated_at` (the admin driver-detail payload selects `*` from `driver_documents`). The pending **vehicle**-doc list does not, so the admin frontend has no version token to echo on approve. Add it.

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/admin/pending-vehicle-docs.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { listPendingVehicleDocs } from '@/modules/admin/admin.repository'

describe('listPendingVehicleDocs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects and returns updated_at as a version token for the approve guard', async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{
        id: 1, vehicle_id: 2, doc_type: 'rc', file_url: 'u', doc_number: null,
        status: 'pending', created_at: 't0', updated_at: 't1',
        number_plate: 'OD01', vehicle_name: 'Swift', driver_name: 'A', driver_code: 'D1',
      }],
    } as never)

    const rows = await listPendingVehicleDocs()
    const sql = vi.mocked(pool.query).mock.calls[0]![0] as unknown as string
    expect(sql).toContain('updated_at')
    expect(rows[0]!.updated_at).toBe('t1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test tests/unit/admin/pending-vehicle-docs.test.ts`
Expected: FAIL — `rows[0].updated_at` is `undefined` (not selected, and not on the `PendingVehicleDoc` type).

- [ ] **Step 3: Add `updated_at` to the type and query**

In `api/src/modules/admin/admin.types.ts`, add `updated_at: string` to the `PendingVehicleDoc` interface (find `export interface PendingVehicleDoc` and add the field alongside `created_at`).

In `api/src/modules/admin/admin.repository.ts`, in `listPendingVehicleDocs` (currently ~L847-865): add `dvd.updated_at` to the SELECT list (after `dvd.created_at`), and add `updated_at: r.updated_at as string,` to the `.map(...)` object literal (after `created_at: r.created_at as string,`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && pnpm test tests/unit/admin/pending-vehicle-docs.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Full suite + typecheck**

Run: `cd api && pnpm test && npx tsc --noEmit`
Expected: PASS — entire unit suite green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/admin/admin.repository.ts api/src/modules/admin/admin.types.ts api/tests/unit/admin/pending-vehicle-docs.test.ts
git commit -m "feat(admin): expose updated_at on pending vehicle docs for approval versioning"
```

---

## Post-implementation

- [ ] **Update the knowledge graph**

Run: `graphify update .`

- [ ] **Frontend follow-up (out of scope for this backend plan — flag to the admin-app owner):** the admin document-review UI must (1) send `verified_valid_until` and `seen_updated_at` (the doc's `updated_at`) in the approve request body, (2) surface the driver's `claimed_valid_until` to the reviewer as an editable-but-informational cross-check, and (3) handle a 409 `DOC_CHANGED` by refetching the document and re-prompting. Without (1) the approve call now 422s (missing verified expiry) / 400s (missing version).

---

## Self-Review

**1. Spec coverage:**
- §02.1 (doc rejection/expiry doesn't end an active session): Task A.2 (read-path exclusion in both broadcast queries) + A.3 (force-offline inside `syncDriverStatusAfterDocChange`). Both layers present, as the design requires. Continuous expiry enforcement is covered by the read-path clause reading `verified_valid_until < CURRENT_DATE` (B.2) — an expired-doc driver is excluded from matching every tick and blocked at go-online, so a dedicated expiry-sweep→sync wiring is not needed for the invariant to hold. ✓
- §02.2 (self-reported expiry, never admin-verified): B.1 migration (rename `valid_until`→`claimed_valid_until`, add `verified_valid_until` on both tables, backfill approved rows), B.2 (gating reads verified only; upload writes claimed only), B.3 (approval requires `verified_valid_until`). ✓
- §02.3 (TOCTOU re-upload vs approve): B.4 repository `WHERE updated_at = $seenUpdatedAt` guard + C.1 service 409 `DOC_CHANGED` + C.2 exposing `updated_at` so the token exists to echo. ✓
- §07 cross-cutting: pattern #2 (fetch/gate scoped by construction) — the shared `docIssueExistsSql` makes eligibility one clause reused in three call sites; pattern #3 (claimed vs verified at a trust boundary) — the exact `claimed_valid_until`/`verified_valid_until` split. Both honored. ✓

**2. Placeholder scan:** No TBD/TODO/"handle appropriately"; every code step has full code; every migration is complete SQL; every test-run step has an exact command + expected result. ✓

**3. Type consistency:**
- `docIssueExistsSql(driverIdExpr: string): string` — defined A.1, edited B.2, called with `'$1'`, `'ds.driver_id'`, `'rcr.driver_id'`. Consistent everywhere. ✓
- `approveDriverDoc`/`approveVehicleDoc` final signatures — service `(docId, adminId, verifiedValidUntil, seenUpdatedAt, ipAddress)`, repo `(docId, adminId, verifiedValidUntil, seenUpdatedAt)`. B.3 test uses the final shape and passes a `SEEN` value so it survives C unchanged; the repo `updated_at=$4` guard is introduced in B.4 (same commit as the signature) — no signature is changed twice. ✓
- Column names: `claimed_valid_until` (writes/reminders-source), `verified_valid_until` (all gating + reminders), `updated_at` (concurrency token). Used identically in migration, SQL, and types. ✓
- Error shapes: `httpError(422/400/409, msg, code)` attaches `.httpStatus`/`.appCode`, matching the `toMatchObject` assertions. `DOC_CHANGED` is used inline via `httpError` (no `AppErrors` entry needed). ✓

One correction folded in during review: the design doc's force-offline snippet used `ended_at`, which does not exist on `driver_sessions`; the plan uses the real `went_offline_at`/`offline_reason` columns.
