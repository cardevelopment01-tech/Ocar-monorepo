
# Remaining Zero-Coverage Modules — admin-invites, geo, admin-audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Path:** `docs/superpowers/plans/2026-08-19-remaining-module-test-coverage.md`
- **Goal:** Close the highest-blast-radius part of the zero-coverage module list left over from `docs/superpowers/plans/2026-08-19-backend-test-coverage.md`'s Task 3 (`admin-invites`, `geo`, `admin-audit`), with `saved-places`/`users`/`vehicles`/`analytics` scoped as a lower-priority Task 4 for a further follow-up.
- **Architecture:** Same service-layer mocking convention proven across the whole test suite: `vi.mock()` the module's own repository (and any sibling module it calls) at the `@/...` alias path, import the real service function, assert on mock-call args and thrown-error shape. Errors thrown via `createHttpError` expose `.appCode` (not `.code`) — confirmed in `api/src/lib/errors.ts` during the prior auth-coverage effort; errors thrown via plain `Object.assign(new Error(...), {httpStatus, code})` (the pattern `geo.service.ts` and `safety/sos.service.ts` use) expose `.code` directly. Do not conflate the two — check which pattern a given service function uses before writing the assertion.
- **Tech Stack:** vitest 1.x, TypeScript with `exactOptionalPropertyTypes: true`.

> **Priority rationale:** `admin-invites` controls who can become an admin at all (the actual keys to the kingdom) — highest blast radius of the three. `geo`'s `classifyTrip()` in/outstation branching feeds pricing (per-km vs. flat-fee billing depends on it) — a silent regression there is a billing bug, not just a data bug. `admin-audit` is the incident-record system itself — if it silently no-ops, there's no way to know an incident happened. `saved-places`/`users`/`vehicles`/`analytics` are lower-risk CRUD/read paths, deferred to Task 4.

---

## Task 1 — `admin-invites.service.ts` coverage (controls admin account creation)

**Files:**
- Create: `api/tests/unit/admin-invites/create-invite.test.ts`
- Create: `api/tests/unit/admin-invites/verify-and-redeem-invite.test.ts`
- Create: `api/tests/unit/admin-invites/revoke-invite.test.ts`

Source under test: `api/src/modules/admin-invites/admin-invites.service.ts`. It imports `* as repo from './admin-invites.repository'` (alias `@/modules/admin-invites/admin-invites.repository`), `notificationsQueue` from `@/jobs/queues`, `sha256`/`hashPassword` from `@/lib/hash`, and error helpers from `@/constants/errors`/`@/lib/errors`. Every thrown error here uses `createHttpError`, so assert on `.appCode`.

### Step 1.1 — Write `create-invite.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin-invites/admin-invites.repository', () => ({
  findPendingInviteByEmail: vi.fn(),
  createInvite: vi.fn(),
}))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn(() => Promise.resolve()) } }))
vi.mock('@/lib/hash', () => ({
  sha256: vi.fn(() => 'hashed-token'),
  hashPassword: vi.fn(),
}))

import * as repo from '@/modules/admin-invites/admin-invites.repository'
import { notificationsQueue } from '@/jobs/queues'
import { createInvite } from '@/modules/admin-invites/admin-invites.service'

describe('createInvite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws ADMIN_INVITE_DUPLICATE when a pending invite already exists for the email, and never creates a second one', async () => {
    vi.mocked(repo.findPendingInviteByEmail).mockResolvedValue({ id: '1' } as never)

    await expect(
      createInvite({ email: 'ops@ocar.example', role: 'ops_admin' as never, invitedBy: 1n })
    ).rejects.toMatchObject({ appCode: expect.stringContaining('DUPLICATE') })
    expect(repo.createInvite).not.toHaveBeenCalled()
    expect(notificationsQueue.add).not.toHaveBeenCalled()
  })

  it('on success: persists the invite with a HASHED token (never the raw token) and enqueues exactly one invite email with the RAW token', async () => {
    vi.mocked(repo.findPendingInviteByEmail).mockResolvedValue(null)
    vi.mocked(repo.createInvite).mockResolvedValue({ id: '2', email: 'ops@ocar.example', role: 'ops_admin' } as never)

    const result = await createInvite({ email: 'ops@ocar.example', role: 'ops_admin' as never, invitedBy: 1n })

    expect(result).toEqual({ id: '2', email: 'ops@ocar.example', role: 'ops_admin' })
    const createArgs = vi.mocked(repo.createInvite).mock.calls[0]![0] as { tokenHash: string }
    expect(createArgs.tokenHash).toBe('hashed-token') // the sha256 mock's output, never the raw token
    expect(notificationsQueue.add).toHaveBeenCalledTimes(1)
    const [, jobPayload] = vi.mocked(notificationsQueue.add).mock.calls[0]!
    expect((jobPayload as { rawToken: string }).rawToken).not.toBe('hashed-token') // raw token goes to email, not the hash
  })
})
```

- [ ] **Step 1.1a: Run it**

Run: `cd api && npx vitest run tests/unit/admin-invites/create-invite.test.ts`
Expected: 2 tests pass. If `AppErrors.ADMIN_INVITE_DUPLICATE`'s `.code` value doesn't contain the substring `DUPLICATE`, open `api/src/constants/errors.ts` and match the real value.

### Step 1.2 — Write `verify-and-redeem-invite.test.ts`

`verifyInviteToken()` is the pre-flight check the accept-invite page calls before a user sets a password — it must reject not just a missing invite, but a non-`pending` one (already redeemed) and an expired one, and it must never mutate anything (no `repo.revoke*`/`repo.redeem*` call). `redeemInvite()` is the actual admin-account-creation step.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin-invites/admin-invites.repository', () => ({
  findByTokenHash: vi.fn(),
  redeemInvite: vi.fn(),
}))
vi.mock('@/lib/hash', () => ({
  sha256: vi.fn(() => 'hashed-token'),
  hashPassword: vi.fn(() => Promise.resolve('hashed-password')),
}))

import * as repo from '@/modules/admin-invites/admin-invites.repository'
import { verifyInviteToken, redeemInvite } from '@/modules/admin-invites/admin-invites.service'

describe('verifyInviteToken', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws ADMIN_INVITE_INVALID when no invite matches the token', async () => {
    vi.mocked(repo.findByTokenHash).mockResolvedValue(null)

    await expect(verifyInviteToken('bad-token')).rejects.toMatchObject({
      appCode: expect.stringContaining('INVALID'),
    })
  })

  it('throws ADMIN_INVITE_INVALID for an already-redeemed (non-pending) invite', async () => {
    vi.mocked(repo.findByTokenHash).mockResolvedValue({
      email: 'ops@ocar.example', role: 'ops_admin', status: 'redeemed',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    } as never)

    await expect(verifyInviteToken('used-token')).rejects.toMatchObject({
      appCode: expect.stringContaining('INVALID'),
    })
  })

  it('throws ADMIN_INVITE_INVALID for an expired invite, even if status is still "pending"', async () => {
    vi.mocked(repo.findByTokenHash).mockResolvedValue({
      email: 'ops@ocar.example', role: 'ops_admin', status: 'pending',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    } as never)

    await expect(verifyInviteToken('expired-token')).rejects.toMatchObject({
      appCode: expect.stringContaining('INVALID'),
    })
  })

  it('returns email + role for a valid pending, unexpired invite, without mutating anything', async () => {
    vi.mocked(repo.findByTokenHash).mockResolvedValue({
      email: 'ops@ocar.example', role: 'ops_admin', status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    } as never)

    const result = await verifyInviteToken('good-token')

    expect(result).toEqual({ email: 'ops@ocar.example', role: 'ops_admin' })
  })
})

describe('redeemInvite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws ADMIN_INVITE_INVALID when the repository reports no matching redeemable invite (bad/reused/expired token)', async () => {
    vi.mocked(repo.redeemInvite).mockResolvedValue(null)

    await expect(redeemInvite('bad-token', 'NewPassw0rd!')).rejects.toMatchObject({
      appCode: expect.stringContaining('INVALID'),
    })
  })

  it('hashes the password before it ever reaches the repository (never passes the plaintext password through)', async () => {
    vi.mocked(repo.redeemInvite).mockResolvedValue({ id: '9', email: 'ops@ocar.example' } as never)

    await redeemInvite('good-token', 'NewPassw0rd!')

    const callArgs = vi.mocked(repo.redeemInvite).mock.calls[0]![0] as { passwordHash: string; tokenHash: string }
    expect(callArgs.passwordHash).toBe('hashed-password')
    expect(callArgs.tokenHash).toBe('hashed-token')
  })
})
```

- [ ] **Step 1.2a: Run it**

Run: `cd api && npx vitest run tests/unit/admin-invites/verify-and-redeem-invite.test.ts`
Expected: 6 tests pass.

### Step 1.3 — Write `revoke-invite.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin-invites/admin-invites.repository', () => ({
  revokePendingInvite: vi.fn(),
}))

import * as repo from '@/modules/admin-invites/admin-invites.repository'
import { revokeInvite } from '@/modules/admin-invites/admin-invites.service'

describe('revokeInvite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws NOT_FOUND when there is nothing to revoke (already revoked/redeemed/nonexistent)', async () => {
    vi.mocked(repo.revokePendingInvite).mockResolvedValue(null)

    await expect(revokeInvite(999n)).rejects.toMatchObject({
      appCode: expect.stringContaining('NOT_FOUND'),
    })
  })

  it('returns the revoked invite on success', async () => {
    vi.mocked(repo.revokePendingInvite).mockResolvedValue({ id: '1', status: 'revoked' } as never)

    const result = await revokeInvite(1n)

    expect(result).toEqual({ id: '1', status: 'revoked' })
  })
})
```

- [ ] **Step 1.3a: Run it, then run the whole admin-invites suite and typecheck**

```bash
cd api && npx vitest run tests/unit/admin-invites/revoke-invite.test.ts
cd api && npx vitest run tests/unit/admin-invites
cd api && npx tsc --noEmit
```
Expected: all green. Watch for `exactOptionalPropertyTypes` issues in mock object literals.

- [ ] **Step 1.4: Commit**

```bash
git add api/tests/unit/admin-invites
git commit -m "test(admin-invites): cover invite creation, verification/redemption, and revocation"
```

---

## Task 2 — `geo.service.ts` coverage (`classifyTrip`, city CRUD error paths)

**Files:**
- Create: `api/tests/unit/geo/classify-trip.test.ts`
- Create: `api/tests/unit/geo/city-crud.test.ts`

Source under test: `api/src/modules/geo/geo.service.ts`. It imports `* as repo from './geo.repository'` (alias `@/modules/geo/geo.repository`), `* as google from './providers/google.provider'` (alias `@/modules/geo/providers/google.provider`), and `getJSON`/`setWithTTL` from `@/db/redis`. Errors here use the plain `Object.assign(new Error(...), { httpStatus })` pattern (no `AppErrors`/`createHttpError`), so assert on `.httpStatus`, not `.appCode` or `.code`.

`classifyTrip()` decides whether a booked trip is billed as in-city (per-km) or outstation (flat/rental pricing) — this is the PostGIS-backed containment check CLAUDE.md flags as an invariant worth protecting, and it feeds real money, not just data correctness.

### Step 2.1 — Write `classify-trip.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/geo/geo.repository', () => ({
  findContainingCity: vi.fn(),
}))

import * as repo from '@/modules/geo/geo.repository'
import { classifyTrip } from '@/modules/geo/geo.service'

describe('classifyTrip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('classifies as in_city with the containing city id/name when both origin and destination fall inside one city boundary', async () => {
    vi.mocked(repo.findContainingCity).mockResolvedValue({ id: 1n, name: 'Bhubaneswar' } as never)

    const result = await classifyTrip(20.2961, 85.8245, 20.30, 85.83)

    expect(result).toEqual({ scope: 'in_city', cityId: 1n, cityName: 'Bhubaneswar' })
    expect(repo.findContainingCity).toHaveBeenCalledWith(20.2961, 85.8245, 20.30, 85.83)
  })

  it('classifies as outstation with null city fields when no single city boundary contains both points', async () => {
    vi.mocked(repo.findContainingCity).mockResolvedValue(null)

    const result = await classifyTrip(20.2961, 85.8245, 19.8135, 85.8312) // Bhubaneswar -> Puri, crosses city lines

    expect(result).toEqual({ scope: 'outstation', cityId: null, cityName: null })
  })
})
```

- [ ] **Step 2.1a: Run it**

Run: `cd api && npx vitest run tests/unit/geo/classify-trip.test.ts`
Expected: 2 tests pass.

### Step 2.2 — Write `city-crud.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/geo/geo.repository', () => ({
  createCity: vi.fn(),
  updateCity: vi.fn(),
}))

import * as repo from '@/modules/geo/geo.repository'
import { createCity, updateCity } from '@/modules/geo/geo.service'

const NEW_CITY = {
  name: 'Rourkela', slug: 'rourkela', state: 'Odisha',
  centroid_lat: 22.2604, centroid_lng: 84.8536,
  default_speed_limit_kmph: 40, is_rental_enabled: false, is_return_cab_enabled: false,
  created_by: 1n,
}

describe('createCity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the data straight through to the repository and returns its result', async () => {
    vi.mocked(repo.createCity).mockResolvedValue({ id: 9n, ...NEW_CITY } as never)

    const result = await createCity(NEW_CITY)

    expect(repo.createCity).toHaveBeenCalledWith(NEW_CITY)
    expect(result).toEqual({ id: 9n, ...NEW_CITY })
  })
})

describe('updateCity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws httpStatus 404 when the city does not exist', async () => {
    vi.mocked(repo.updateCity).mockResolvedValue(null)

    await expect(updateCity(999n, { name: 'New Name' })).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('returns the updated city on success', async () => {
    vi.mocked(repo.updateCity).mockResolvedValue({ id: 1n, name: 'Bhubaneswar Updated' } as never)

    const result = await updateCity(1n, { name: 'Bhubaneswar Updated' })

    expect(result).toEqual({ id: 1n, name: 'Bhubaneswar Updated' })
  })
})
```

- [ ] **Step 2.2a: Run it, then run the whole geo suite and typecheck**

```bash
cd api && npx vitest run tests/unit/geo/city-crud.test.ts
cd api && npx vitest run tests/unit/geo
cd api && npx tsc --noEmit
```
Expected: all green.

- [ ] **Step 2.3: Commit**

```bash
git add api/tests/unit/geo
git commit -m "test(geo): cover classifyTrip in/outstation branching and city CRUD error paths"
```

---

## Task 3 — `admin-audit.service.ts` coverage (pagination correctness for the incident record)

**Files:**
- Create: `api/tests/unit/admin-audit/list-audit-log.test.ts`

Source under test: `api/src/modules/admin-audit/admin-audit.service.ts`. Small and pure-ish (pagination math wraps a repository call), but worth pinning down because a future refactor of the clamping logic (`limit`/`page` bounds) silently corrupting the audit trail's pagination would be easy to miss without a test, and this module has zero coverage today.

### Step 3.1 — Write the test

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin-audit/admin-audit.repository', () => ({
  listAuditLog: vi.fn(),
  listAuditLogForTarget: vi.fn(),
}))

import * as repo from '@/modules/admin-audit/admin-audit.repository'
import { listAuditLog, listAuditLogForTarget } from '@/modules/admin-audit/admin-audit.service'

describe('listAuditLog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to page 1, limit 50 when neither is provided', async () => {
    vi.mocked(repo.listAuditLog).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLog({})

    expect(repo.listAuditLog).toHaveBeenCalledWith({ limit: 50, offset: 0 })
  })

  it('clamps limit to a maximum of 100 even if a larger value is requested', async () => {
    vi.mocked(repo.listAuditLog).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLog({ limit: 5000 })

    expect(repo.listAuditLog).toHaveBeenCalledWith({ limit: 100, offset: 0 })
  })

  it('clamps page to a minimum of 1 even if 0 or a negative value is requested', async () => {
    vi.mocked(repo.listAuditLog).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLog({ page: -5 })

    expect(repo.listAuditLog).toHaveBeenCalledWith({ limit: 50, offset: 0 })
  })

  it('computes offset correctly for page > 1, and returns the pagination metadata shape', async () => {
    vi.mocked(repo.listAuditLog).mockResolvedValue({ rows: [{ id: '1' }], total: 205 } as never)

    const result = await listAuditLog({ page: 3, limit: 50 })

    expect(repo.listAuditLog).toHaveBeenCalledWith({ limit: 50, offset: 100 }) // (3-1)*50
    expect(result).toEqual({
      entries: [{ id: '1' }],
      pagination: { total: 205, page: 3, limit: 50, pages: 5 }, // ceil(205/50)
    })
  })
})

describe('listAuditLogForTarget', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to a tighter limit of 20 (not 50) when scoped to a single target', async () => {
    vi.mocked(repo.listAuditLogForTarget).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLogForTarget('drivers', 42n, {})

    expect(repo.listAuditLogForTarget).toHaveBeenCalledWith({
      targetTable: 'drivers', targetId: 42n, limit: 20, offset: 0,
    })
  })

  it('still clamps limit to 100 for a target-scoped query', async () => {
    vi.mocked(repo.listAuditLogForTarget).mockResolvedValue({ rows: [], total: 0 } as never)

    await listAuditLogForTarget('drivers', 42n, { limit: 500 })

    expect(repo.listAuditLogForTarget).toHaveBeenCalledWith({
      targetTable: 'drivers', targetId: 42n, limit: 100, offset: 0,
    })
  })
})
```

- [ ] **Step 3.2: Run it, then typecheck**

```bash
cd api && npx vitest run tests/unit/admin-audit/list-audit-log.test.ts
cd api && npx tsc --noEmit
```
Expected: 6 tests pass, no type errors.

- [ ] **Step 3.3: Commit**

```bash
git add api/tests/unit/admin-audit
git commit -m "test(admin-audit): pin down pagination/clamping correctness for the audit trail"
```

---

## Task 4 — Remaining lower-priority modules (scoped list, follow-up plan)

Per writing-plans' scope-check guidance, these are lower blast-radius than Tasks 1–3 and are deliberately left as a scoped list rather than full task detail — read each module's real `.service.ts` before writing tests, do not invent signatures:

| Module | Why lower priority than Tasks 1–3 | First thing to test |
|---|---|---|
| `saved-places` | User convenience feature (Home/Work/Other), no money/safety/security surface | CRUD happy path + the "max N saved places" limit if one exists in the service layer |
| `users` | Mostly profile GET/PATCH; `/me` route already exercised indirectly via other modules' integration tests | Any status-transition guard in the service layer (e.g. suspended-user edge cases) |
| `vehicles` | Public lookup data (categories/brands/models), low mutation risk | Admin-only mutation paths, if any exist beyond simple CRUD |
| `analytics` | Read-only aggregation; wrong numbers are embarrassing, not unsafe | One test per aggregate query confirming the SQL groups/filters correctly, following the pattern already used for `admin-audit`'s pagination |

---

## Self-review (per writing-plans)

- **Spec coverage:** Task 1 covers every exported function in `admin-invites.service.ts` (createInvite, listInvites is a trivial passthrough not worth a dedicated test, verifyInviteToken, redeemInvite, revokeInvite). Task 2 covers `classifyTrip`'s two branches and the two city-mutation error/success paths (read-only lookups like `getCities`/`getCityBySlug`/`autocomplete`/`getRoute` are thin wrappers around `repo`/Google provider calls with no branching logic worth a dedicated unit test — they're integration-test territory, not unit-test territory). Task 3 covers both exported functions' full pagination behavior. Task 4 scopes the rest.
- **Placeholder scan:** no "TBD"/"add appropriate tests" — every test has real, complete code against real function signatures read directly from source during this plan's drafting.
- **Type consistency:** `admin-invites` tests use `.appCode` (createHttpError pattern, confirmed against `api/src/lib/errors.ts` during the prior auth-coverage effort); `geo` tests use `.httpStatus` directly (Object.assign pattern, matching `geo.service.ts`'s actual error-construction style, same as `safety/sos.service.ts`'s pattern already proven in the prior safety-coverage effort). BigInt literals (`1n`, `999n`) used consistently with the rest of the test suite.
