
# Backend Test Coverage — Auth, SOS, and the Real Zero-Coverage Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Path:** `docs/superpowers/plans/2026-08-19-backend-test-coverage.md`
- **Goal:** Land the already-fixed accept-race hijack cleanup, then add real unit test coverage for the modules that are **genuinely** untested — `auth` (OTP request/verify, admin login + TOTP branch, refresh-token rotation/reuse) and `safety`'s `sos.service.ts` — plus a scoped follow-up list for the remaining zero-coverage modules.
- **Architecture:** Service-layer tests, following the house convention proven in `api/tests/unit/payments/confirm-ride-payment.test.ts`: `vi.mock('@/db/client')` with a shared mock `pool.query`/`pool.connect`, import the *service* module directly (not the repository), assert on the SQL text/params passed to the mock and on the service's return value/thrown errors. Where a service imports a sibling module by `* as` namespace (e.g. `auth.service.ts` imports `* as repo from './auth.repository'` and `* as otpLib from '@/lib/otp'`), mock that module directly via its `@/...` alias path — do not mock `@/db/client` underneath it once the direct module is mocked, to avoid asserting on SQL two layers removed from the function under test.
- **Tech Stack:** vitest 1.x (already configured, `api/vitest.config.ts` + `api/tests/setup.ts` exist), TypeScript with `exactOptionalPropertyTypes: true`.

> **Correction note:** an earlier version of this plan assumed near-zero backend test coverage across the board. That was wrong — it came from a search that only looked in `api/src/**/*.test.ts` and missed the repo's actual test tree at `api/tests/unit/` and `api/tests/integration/` (99 files, 504 tests, 409 passing as of this writing). Payments, settlements, pricing, fare, admin-TOTP, notifications, ride-chat, and rides are already deeply covered there — do not re-test them here. Verified via direct `find` against `api/tests/`: **zero test files exist** for `auth`, `safety`, `geo`, `users`, `vehicles`, `admin-audit`, `admin-invites`, `saved-places`, and `analytics`. This plan targets the two highest-blast-radius modules in that real gap list with complete code (auth = every login path in the system; safety = SOS is a physical-safety feature). The rest are scoped as Task 3, not detailed here, per writing-plans' own scope-check guidance for large multi-subsystem gaps.

> Also verified: running `cd api && npx vitest run` today shows 3 failing integration files (`driver-verification.test.ts`, `m02.test.ts`, `m03.test.ts`) — all fail with `ECONNREFUSED` against `127.0.0.1:6379` (Redis) and `::1:5433` (a local test Postgres on port 5433), not real bugs. That matches this repo's own CLAUDE.md note that integration tests need `TEST_DATABASE_URL` + a running Redis. Not in scope here — flagged so nobody mistakes it for a regression this plan caused.

---

## Task 0 — Land the accept-race fix and correct the load-test docs

The `acceptAssignment()` concurrency fix (`api/src/modules/rides/rides.repository.ts`, adds an `EXISTS (SELECT 1 FROM ride_assignments WHERE ride_id=$1 AND driver_id=$2 AND status='offered')` guard) is already made and unit-tested — currently sitting as an **uncommitted** diff. Its two tests already exist in `rides.repository.assign.test.ts`. `load-tests/k6/accept-race.js` and `load-tests/README.md` §9 still describe the bug as *currently unfixed / expected to fail* — that needs a one-line correction so the threshold reads as a regression guard, not a known failure.

**Files:**
- Modify (commit only, no code change needed): `api/src/modules/rides/rides.repository.ts`, `api/src/modules/rides/rides.repository.assign.test.ts`
- Modify: `load-tests/k6/accept-race.js`
- Modify: `load-tests/README.md`

- [ ] **Step 0.1: Confirm the existing accept-race tests are green**

Run: `cd api && npx vitest run src/modules/rides/rides.repository.assign.test.ts`
Expected: all tests pass, including `acceptAssignment > rejects a driver with no offered ride_assignments row` and `acceptAssignment > accepts a driver who does have an outstanding offer`.

- [ ] **Step 0.2: Commit the fix**

```bash
git add api/src/modules/rides/rides.repository.ts api/src/modules/rides/rides.repository.assign.test.ts
git commit -m "fix(rides): close ride-accept hijack — require an offered ride_assignments row"
```

- [ ] **Step 0.3: Update `load-tests/k6/accept-race.js`'s stale comments**

In the file header (the paragraph starting "It also includes one 'outsider' driver..." and the block around the `accept_race_unauthorized_accept_succeeded` threshold), change language describing the bug as currently present/expected-to-fail to describe it as a fixed regression the test now guards. Example diff shape for the threshold block:

```javascript
// Before:
    // This one is EXPECTED to fail until the ride_assignments check is added
    // server-side — see the file header. Left as a real threshold (not just
    // a metric) so it shows up as a clear red FAIL in the k6 summary rather
    // than something you'd only notice by reading logs.
    accept_race_unauthorized_accept_succeeded: ['count<1'],

// After:
    // Regression guard: acceptAssignment() now requires an offered
    // ride_assignments row (fixed — see rides.repository.ts's
    // acceptAssignment). This threshold catches if that guard ever
    // regresses, not an open bug.
    accept_race_unauthorized_accept_succeeded: ['count<1'],
```

Update the file-header paragraph similarly — replace "This surfaced a real bug while building it" framing with "This test guards against the following bug, fixed in <commit sha from Step 0.2>" and keep the technical explanation of why the outsider driver is unauthorized.

- [ ] **Step 0.4: Update `load-tests/README.md` §9's "currently fail" language**

Find the paragraph in §9 (`k6/accept-race.js — the ride-accept race condition`) describing `accept_race_unauthorized_accept_succeeded` as something that "will currently **fail**". Change it to state the check now passes and explain what it guards against, referencing Task 0's commit.

- [ ] **Step 0.5: Commit the doc updates**

```bash
git add load-tests/k6/accept-race.js load-tests/README.md
git commit -m "docs(load-tests): accept-race hijack check is now a regression guard, not an open bug"
```

---

## Task 1 — `auth.service.ts` coverage (every login path in the system)

**Files:**
- Create: `api/tests/unit/auth/request-otp.test.ts`
- Create: `api/tests/unit/auth/verify-otp.test.ts`
- Create: `api/tests/unit/auth/admin-login.test.ts`
- Create: `api/tests/unit/auth/refresh-tokens.test.ts`

Source under test: `api/src/modules/auth/auth.service.ts`. It imports `* as otpLib from '@/lib/otp'`, `* as repo from './auth.repository'` (alias: `@/modules/auth/auth.repository`), `notificationsQueue` from `@/jobs/queues`, `verifyLoginCode` from `@/modules/admin-totp/admin-totp.service`, and JWT helpers from `@/lib/jwt`. Mock all of these at the module boundary — do not reach through to `@/db/client` or `@/db/redis`, since `auth.service.ts` never touches those directly.

### Step 1.1 — Write `request-otp.test.ts` (rate limit + lock + happy path)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/otp', () => ({
  checkRateLimit: vi.fn(),
  isVerifyLocked: vi.fn(),
  generateOtp: vi.fn(() => '1234'),
  hashOtp: vi.fn(() => 'hashed-1234'),
  storeOtp: vi.fn(),
}))
vi.mock('@/modules/auth/auth.repository', () => ({
  createOtpRequest: vi.fn(),
}))
vi.mock('@/jobs/queues', () => ({
  notificationsQueue: { add: vi.fn() },
}))

import * as otpLib from '@/lib/otp'
import * as repo from '@/modules/auth/auth.repository'
import { notificationsQueue } from '@/jobs/queues'
import { requestOtp } from '@/modules/auth/auth.service'

describe('requestOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(otpLib.checkRateLimit).mockResolvedValue({ allowed: true, remaining: 4 })
    vi.mocked(otpLib.isVerifyLocked).mockResolvedValue(false)
  })

  it('throws AUTH_OTP_RATE_LIMITED and never stores/sends an OTP when rate limit is exceeded', async () => {
    vi.mocked(otpLib.checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0 })

    await expect(requestOtp('9876543210', 'user', 'login')).rejects.toMatchObject({
      code: expect.stringContaining('RATE_LIMITED'),
    })
    expect(otpLib.storeOtp).not.toHaveBeenCalled()
    expect(notificationsQueue.add).not.toHaveBeenCalled()
  })

  it('throws AUTH_OTP_LOCKED and never stores/sends an OTP when the phone is verify-locked', async () => {
    vi.mocked(otpLib.isVerifyLocked).mockResolvedValue(true)

    await expect(requestOtp('9876543210', 'user', 'login')).rejects.toMatchObject({
      code: expect.stringContaining('LOCKED'),
    })
    expect(otpLib.storeOtp).not.toHaveBeenCalled()
    expect(notificationsQueue.add).not.toHaveBeenCalled()
  })

  it('on the happy path: stores the OTP, persists the request row, and enqueues exactly one SMS job', async () => {
    const result = await requestOtp('9876543210', 'driver', 'login')

    expect(result.otp).toBe('1234')
    expect(otpLib.storeOtp).toHaveBeenCalledWith('9876543210', 'login', 'driver', '1234')
    expect(repo.createOtpRequest).toHaveBeenCalledTimes(1)
    expect(notificationsQueue.add).toHaveBeenCalledTimes(1)
    expect(notificationsQueue.add).toHaveBeenCalledWith(
      'otp_sms',
      { phone: '9876543210', otp: '1234', type: 'auth' },
      expect.objectContaining({ attempts: 3 })
    )
  })
})
```

- [ ] **Step 1.1a: Run it to verify the shape**

Run: `cd api && npx vitest run tests/unit/auth/request-otp.test.ts`
Expected: 3 tests pass. If `PrincipalRole`/`OtpPurpose` enum values don't match string literals (`'user'`/`'driver'`, `'login'`), inspect `api/src/constants/enums.ts` and adjust the mock's `toHaveBeenCalledWith` args to the actual enum values, not string literals, if they differ from their string form.

### Step 1.2 — Write `verify-otp.test.ts` (wrong code / expired / locked / suspended driver / success)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/otp', () => ({ consumeOtp: vi.fn() }))
vi.mock('@/modules/auth/auth.repository', () => ({
  findUserByPhone: vi.fn(),
  upsertUser: vi.fn(),
  findDriverByPhone: vi.fn(),
  upsertDriver: vi.fn(),
  storeRefreshToken: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  signAccessToken: vi.fn(() => 'access-token'),
  generateRefreshToken: vi.fn(() => 'refresh-token'),
  hashRefreshToken: vi.fn(() => 'hashed-refresh-token'),
}))

import * as otpLib from '@/lib/otp'
import * as repo from '@/modules/auth/auth.repository'
import { verifyOtp } from '@/modules/auth/auth.service'

describe('verifyOtp', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws AUTH_OTP_INVALID for a wrong code (not expired, not locked)', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: false, attemptsLeft: 2 })

    await expect(verifyOtp('9876543210', '0000', 'user', 'login')).rejects.toMatchObject({
      code: expect.stringContaining('INVALID'),
    })
    expect(repo.upsertUser).not.toHaveBeenCalled()
  })

  it('throws AUTH_OTP_EXPIRED when the OTP has expired', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: false, expired: true })

    await expect(verifyOtp('9876543210', '1234', 'user', 'login')).rejects.toMatchObject({
      code: expect.stringContaining('EXPIRED'),
    })
  })

  it('throws AUTH_OTP_LOCKED when the phone is locked out from repeated wrong attempts', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: false, locked: true })

    await expect(verifyOtp('9876543210', '1234', 'user', 'login')).rejects.toMatchObject({
      code: expect.stringContaining('LOCKED'),
    })
  })

  it('throws DRIVER_SUSPENDED for a suspended driver, even with a correct OTP', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: true })
    vi.mocked(repo.findDriverByPhone).mockResolvedValue({ id: '5' } as never)
    vi.mocked(repo.upsertDriver).mockResolvedValue({
      id: '5', code: 'DRV5', status: 'suspended',
    } as never)

    await expect(verifyOtp('9876543210', '1234', 'driver', 'login')).rejects.toMatchObject({
      code: expect.stringContaining('SUSPENDED'),
    })
    expect(repo.storeRefreshToken).not.toHaveBeenCalled()
  })

  it('on success: issues a token pair and reports isNew correctly for a first-time user', async () => {
    vi.mocked(otpLib.consumeOtp).mockResolvedValue({ success: true })
    vi.mocked(repo.findUserByPhone).mockResolvedValue(null) // no existing row → isNew
    vi.mocked(repo.upsertUser).mockResolvedValue({
      id: '7', code: 'USR7', status: 'active',
    } as never)

    const result = await verifyOtp('9876543210', '1234', 'user', 'login')

    expect(result.isNew).toBe(true)
    expect(result.tokens.accessToken).toBe('access-token')
    expect(result.tokens.refreshToken).toBe('refresh-token')
    expect(repo.storeRefreshToken).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 1.2a: Run it**

Run: `cd api && npx vitest run tests/unit/auth/verify-otp.test.ts`
Expected: 5 tests pass. If `AppErrors.AUTH_OTP_INVALID`/`.AUTH_OTP_EXPIRED`/etc. codes don't literally contain the substrings used in `toMatchObject`, open `api/src/constants/errors.ts` and match the real `.code` values exactly instead of guessing via `stringContaining`.

### Step 1.3 — Write `admin-login.test.ts` (password check + TOTP branch)

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/auth/auth.repository', () => ({
  findAdminByEmail: vi.fn(),
  touchAdminLogin: vi.fn(),
  storeRefreshToken: vi.fn(),
}))
vi.mock('@/lib/hash', () => ({ comparePassword: vi.fn() }))
vi.mock('@/lib/jwt', () => ({
  signAccessToken: vi.fn(() => 'access-token'),
  generateRefreshToken: vi.fn(() => 'refresh-token'),
  hashRefreshToken: vi.fn(() => 'hashed-refresh-token'),
  signPendingTotpToken: vi.fn(() => 'pending-totp-token'),
}))

import * as repo from '@/modules/auth/auth.repository'
import { comparePassword } from '@/lib/hash'
import { adminLogin } from '@/modules/auth/auth.service'

describe('adminLogin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws AUTH_OTP_INVALID for an unknown email (does not leak "email not found" vs "wrong password")', async () => {
    vi.mocked(repo.findAdminByEmail).mockResolvedValue(null)

    await expect(adminLogin('nobody@ocar.example', 'whatever', null)).rejects.toMatchObject({
      code: expect.stringContaining('INVALID'),
    })
    expect(comparePassword).not.toHaveBeenCalled()
  })

  it('throws AUTH_OTP_INVALID for a wrong password, using the same error as unknown email', async () => {
    vi.mocked(repo.findAdminByEmail).mockResolvedValue({
      id: '1', password_hash: 'hashed', totp_enabled: false,
    } as never)
    vi.mocked(comparePassword).mockResolvedValue(false)

    await expect(adminLogin('admin@ocar.example', 'wrong', null)).rejects.toMatchObject({
      code: expect.stringContaining('INVALID'),
    })
    expect(repo.touchAdminLogin).not.toHaveBeenCalled()
  })

  it('when TOTP is enabled: correct password returns a pending token, issues NO session tokens, does not touch last_login_at', async () => {
    vi.mocked(repo.findAdminByEmail).mockResolvedValue({
      id: '1', password_hash: 'hashed', totp_enabled: true,
    } as never)
    vi.mocked(comparePassword).mockResolvedValue(true)

    const result = await adminLogin('admin@ocar.example', 'correct', '203.0.113.1')

    expect(result).toEqual({ pending: true, pendingToken: 'pending-totp-token' })
    expect(repo.touchAdminLogin).not.toHaveBeenCalled()
    expect(repo.storeRefreshToken).not.toHaveBeenCalled()
  })

  it('when TOTP is disabled: correct password issues a full session immediately', async () => {
    vi.mocked(repo.findAdminByEmail).mockResolvedValue({
      id: '1', code: 'ADM1', role: 'super_admin', totp_enabled: false, password_hash: 'hashed',
    } as never)
    vi.mocked(comparePassword).mockResolvedValue(true)

    const result = await adminLogin('admin@ocar.example', 'correct', '203.0.113.1')

    expect('pending' in result).toBe(false)
    expect(repo.touchAdminLogin).toHaveBeenCalledWith(BigInt(1), '203.0.113.1')
    expect(repo.storeRefreshToken).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 1.3a: Run it**

Run: `cd api && npx vitest run tests/unit/auth/admin-login.test.ts`
Expected: 4 tests pass.

### Step 1.4 — Write `refresh-tokens.test.ts` (rotation + reuse detection)

`refreshTokens()`'s reuse-detection branch (`stored.used_at || stored.revoked_at` → revoke the whole family and reject) is the single highest-value auth test in this plan: it's the exact mechanism that limits blast radius if a refresh token is ever stolen.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/auth/auth.repository', () => ({
  findRefreshToken: vi.fn(),
  revokeRefreshTokenFamily: vi.fn(),
  findUserById: vi.fn(),
  findDriverById: vi.fn(),
  findAdminById: vi.fn(),
  rotateRefreshToken: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  signAccessToken: vi.fn(() => 'new-access-token'),
  generateRefreshToken: vi.fn(() => 'new-refresh-token'),
  hashRefreshToken: vi.fn(() => 'hashed-refresh-token'),
}))

import * as repo from '@/modules/auth/auth.repository'
import { refreshTokens } from '@/modules/auth/auth.service'

describe('refreshTokens', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws AUTH_TOKEN_INVALID for a token that does not exist', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue(null)

    await expect(refreshTokens('unknown-token')).rejects.toMatchObject({
      code: expect.stringContaining('INVALID'),
    })
  })

  it('REUSE DETECTION: a token already marked used_at revokes the entire token family and rejects', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue({
      id: '1', principal_role: 'user', principal_id: '7',
      used_at: new Date('2026-01-01'), revoked_at: null,
      expires_at: new Date('2099-01-01'),
    } as never)

    await expect(refreshTokens('stolen-and-replayed-token')).rejects.toMatchObject({
      code: expect.stringContaining('INVALID'),
    })
    expect(repo.revokeRefreshTokenFamily).toHaveBeenCalledTimes(1)
  })

  it('an expired-but-unused token also revokes the family and rejects', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue({
      id: '1', principal_role: 'user', principal_id: '7',
      used_at: null, revoked_at: null,
      expires_at: new Date('2020-01-01'),
    } as never)

    await expect(refreshTokens('expired-token')).rejects.toMatchObject({
      code: expect.stringContaining('INVALID'),
    })
    expect(repo.revokeRefreshTokenFamily).toHaveBeenCalledTimes(1)
  })

  it('a valid, unused, unexpired token rotates cleanly and issues a new pair', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue({
      id: '1', principal_role: 'user', principal_id: '7',
      used_at: null, revoked_at: null,
      expires_at: new Date('2099-01-01'),
    } as never)
    vi.mocked(repo.findUserById).mockResolvedValue({ id: '7', code: 'USR7', status: 'active' } as never)
    vi.mocked(repo.rotateRefreshToken).mockResolvedValue(true as never)

    const result = await refreshTokens('valid-token')

    expect(result.tokens.accessToken).toBe('new-access-token')
    expect(result.tokens.refreshToken).toBe('new-refresh-token')
    expect(repo.revokeRefreshTokenFamily).not.toHaveBeenCalled()
  })

  it('when rotateRefreshToken reports a lost race (false), rejects rather than issuing tokens anyway', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue({
      id: '1', principal_role: 'user', principal_id: '7',
      used_at: null, revoked_at: null,
      expires_at: new Date('2099-01-01'),
    } as never)
    vi.mocked(repo.findUserById).mockResolvedValue({ id: '7', code: 'USR7', status: 'active' } as never)
    vi.mocked(repo.rotateRefreshToken).mockResolvedValue(false as never)

    await expect(refreshTokens('valid-token-racing-another-refresh')).rejects.toMatchObject({
      code: expect.stringContaining('INVALID'),
    })
  })
})
```

- [ ] **Step 1.4a: Run it**

Run: `cd api && npx vitest run tests/unit/auth/refresh-tokens.test.ts`
Expected: 5 tests pass.

- [ ] **Step 1.5: Run the whole auth suite together, then typecheck**

```bash
cd api && npx vitest run tests/unit/auth
cd api && npx tsc --noEmit
```
Expected: all auth tests green, no type errors. Watch specifically for `exactOptionalPropertyTypes` issues in any mock object literal that sets an optional field — omit the key entirely rather than setting it to `undefined`.

- [ ] **Step 1.6: Commit**

```bash
git add api/tests/unit/auth
git commit -m "test(auth): cover OTP request/verify, admin login+TOTP branch, and refresh-token reuse detection"
```

---

## Task 2 — `safety/sos.service.ts` coverage (`triggerSos`)

**Files:**
- Create: `api/tests/unit/safety/trigger-sos.test.ts`

Source under test: `api/src/modules/safety/sos.service.ts`. `triggerSos()` imports `* as repo from './safety.repository'` (alias `@/modules/safety/safety.repository`), `getIO` from `@/websocket/socket.server`, `pool` from `@/db/client` (used directly for one inline phone lookup, not through the repository — mock this too), and `notificationsQueue` from `@/jobs/queues`. The two behaviors worth locking down: (1) SOS can only be triggered on a ride whose status is `in_progress`/`driver_arrived`/`returning` — every other status must reject with `RIDE_NOT_ACTIVE`; (2) a socket-emit failure to `admin:ops` must never block the SOS response, since the alert being recorded matters more than the live-map ping (see the `try { getIO()... } catch {}` in the source — this is a life-safety feature, silently swallowing a genuine emit failure is intentional per the source comment, and the test should prove the alert still returns successfully).

### Step 2.1 — Write the test

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getRideBasic: vi.fn(),
  insertSosAlert: vi.fn(),
  markRideSosTriggered: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn(() => Promise.resolve()) } }))
vi.mock('@/websocket/socket.server', () => ({ getIO: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import { pool } from '@/db/client'
import { getIO } from '@/websocket/socket.server'
import { triggerSos } from '@/modules/safety/sos.service'

describe('triggerSos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ phone: '9876543210' }] } as never)
    vi.mocked(repo.insertSosAlert).mockResolvedValue({
      id: 1n, severity: 'medium', created_at: new Date('2026-01-01'),
    } as never)
  })

  it('throws 404 when the ride does not exist', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue(null)

    await expect(triggerSos({ rideId: 999n, triggeredByUserId: 1n })).rejects.toMatchObject({
      httpStatus: 404,
    })
    expect(repo.insertSosAlert).not.toHaveBeenCalled()
  })

  it.each(['requested', 'accepted', 'completed', 'cancelled', 'no_drivers'])(
    'throws 400 RIDE_NOT_ACTIVE for ride status "%s" and inserts no alert',
    async (status) => {
      vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status, user_id: 1n } as never)

      await expect(triggerSos({ rideId: 5n, triggeredByUserId: 1n })).rejects.toMatchObject({
        httpStatus: 400, code: 'RIDE_NOT_ACTIVE',
      })
      expect(repo.insertSosAlert).not.toHaveBeenCalled()
    }
  )

  it.each(['in_progress', 'driver_arrived', 'returning'])(
    'accepts SOS for ride status "%s": inserts the alert and marks the ride sos-triggered',
    async (status) => {
      vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status, user_id: 1n } as never)
      vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)

      const alert = await triggerSos({ rideId: 5n, triggeredByUserId: 1n, severity: 'high' })

      expect(alert.id).toBe(1n)
      expect(repo.insertSosAlert).toHaveBeenCalledWith(expect.objectContaining({ ride_id: 5n, severity: 'high' }))
      expect(repo.markRideSosTriggered).toHaveBeenCalledWith(5n)
    }
  )

  it('still returns the alert successfully even if the admin:ops socket emit throws', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 1n } as never)
    vi.mocked(getIO).mockImplementation(() => { throw new Error('socket server not initialized') })

    const alert = await triggerSos({ rideId: 5n, triggeredByUserId: 1n })

    expect(alert.id).toBe(1n)
    expect(repo.markRideSosTriggered).toHaveBeenCalledWith(5n)
  })

  it('defaults severity to "medium" when not provided', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 1n } as never)
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)

    await triggerSos({ rideId: 5n, triggeredByUserId: 1n })

    expect(repo.insertSosAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'medium' }))
  })
})
```

- [ ] **Step 2.2: Run it**

Run: `cd api && npx vitest run tests/unit/safety/trigger-sos.test.ts`
Expected: 8 tests pass (1 + 5 parametrized "not active" + 3 parametrized "active" + 2 = actually 1+5+3+1+1 = 11; count what `it.each` produces and confirm all green, don't just eyeball the number).

- [ ] **Step 2.3: Typecheck and commit**

```bash
cd api && npx tsc --noEmit
git add api/tests/unit/safety
git commit -m "test(safety): cover triggerSos ride-status gate and socket-emit-failure resilience"
```

---

## Task 3 — Remaining zero-coverage modules (scoped list, follow-up plan)

Per writing-plans' scope-check guidance: this is a large, independent remainder that should get its own dedicated plan once Tasks 0–2 land, not full task detail crammed in here. Confirmed zero test files (via direct `find` against `api/tests/`) for:

| Module | Why it matters | First thing to test |
|---|---|---|
| `geo` | PostGIS correctness (nearest-city, boundary checks) — this repo has a standing invariant about parameterized `ST_MakePoint`, worth a regression test that a future edit can't silently break | `geo.service.ts`'s nearest-city/reverse-geocode logic |
| `admin-audit` | Every admin action's audit trail — if this silently no-ops, there's no record an incident happened | `admin-audit.service.ts`'s write path |
| `admin-invites` | Controls who can become an admin at all | invite creation + acceptance/expiry logic in `admin-invites.service.ts` |
| `saved-places` | Low blast radius (user convenience feature) | CRUD happy path only |
| `users` / `vehicles` | Profile CRUD, mostly low-risk reads/writes | status-transition guards, if any exist in the service layer |
| `analytics` | Read-only aggregation, wrong numbers are embarrassing but not unsafe | one test per aggregate query confirming the SQL groups/filters correctly |

Do not start this task without first reading each module's actual `.service.ts` (or `.repository.ts` if there's no service layer) — do not invent function signatures the way the original (incorrect) version of this plan almost did for the money modules.

---

## Self-review (per writing-plans)

- **Spec coverage:** Task 0 = land the fix + correct stale docs (user's blocker-cleanup ask). Task 1 = auth (every login path). Task 2 = safety SOS. Task 3 = scoped remainder. Covers the corrected, verified gap list.
- **Placeholder scan:** no "TBD"/"add appropriate tests" — every test in Tasks 1–2 has real, complete code against real function signatures read directly from source.
- **Type consistency:** mock return shapes match the real types in `auth.types.ts`/`safety.types.ts` (e.g. `UserRecord.status`, `DriverRecord.status`, `TriggerSosInput.rideId: bigint`) — bigint literals (`5n`) used consistently, matching the source's own `bigint` usage in `rides.repository.ts`/`safety.repository.ts`.
