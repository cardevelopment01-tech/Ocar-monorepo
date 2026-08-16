# Exotel Call Masking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw `tel:` "Call driver" / "Call rider" buttons with a masked, click-to-call flow via Exotel's Voice API, using a small self-owned pool of rented Exotel virtual numbers that gets reused across rides — so neither party ever sees the other's real number, and the per-minute/per-number spend stays bounded and visible.

**Architecture:** On ride `accepted`, allocate one virtual number from a pool we control (`exotel_number_pool`) to that ride for its active lifetime (`ride_call_masks`), released back to the pool on `completed`/`cancelled`/expiry. Tapping "Call" in either app now hits our backend (`POST /rides/:id/call`) instead of `tel:` directly — the backend calls Exotel's **Connect Two Numbers** API with `CallerId` set to the allocated virtual number, so Exotel dials the tapper's real phone first, then bridges to the other party once they pick up, showing the masked number as caller ID on both legs. A hard `TimeLimit` cap and a per-ride call-count cap bound worst-case spend per call; a daily spend tracker (summed from Exotel's async `StatusCallback`) plus a `system_config` kill switch bound worst-case spend per day. A short "Connecting you to your Ocar driver/rider" greeting plays via `WaitUrl` while the second leg dials.

**Why click-to-call (Connect API) and not LeadAssist/ExoBridge:** LeadAssist is Exotel's managed pooled-allocation product and would mean less code, but its API (`leadassist.exotel.in/.../greenpin`) requires separate account-manager enablement and its exact request/response schema isn't in the public docs — building against it now means guessing field names. The Connect Two Numbers API (`Voice v1`) is fully documented and lets us own the pool/allocation/budget logic ourselves, which is also what keeps this cheap and inspectable for a startup budget. Revisit LeadAssist once ride volume justifies asking Exotel to enable it — swapping the allocation source later doesn't touch the ride-lifecycle hooks or frontend, only `call-masking.repository.ts`.

**Tech Stack:** Express routes (`api/src/modules/call-masking`), `fetch` (no new HTTP client dependency — matches `sms.provider.ts`), BullMQ (spend-sweep job), Vitest, Next.js (`apps/user`), Vite/React (`apps/driver`).

---

## File Structure

- Create: `api/src/db/migrations/085_call_masking.sql` — `exotel_number_pool`, `ride_call_masks`, `exotel_call_events` tables + `system_config` seed rows.
- Create: `api/src/modules/call-masking/call-masking.types.ts`
- Create: `api/src/modules/call-masking/call-masking.repository.ts` — pool allocate/release, event recording, spend sum.
- Create: `api/src/modules/call-masking/call-masking.exotel-client.ts` — thin wrapper over the Connect Two Numbers REST call.
- Create: `api/src/modules/call-masking/call-masking.service.ts` — `allocateForRide`, `releaseForRide`, `triggerCall`, budget/kill-switch checks.
- Create: `api/src/modules/call-masking/call-masking.routes.ts` — `POST /api/v1/rides/:id/call`, `POST /api/v1/webhooks/exotel/status`.
- Modify: `api/src/modules/rides/rides.service.ts` — call `allocateForRide`/`releaseForRide` at the existing accept/cancel/complete/expire hook points.
- Modify: `api/src/config/index.ts` — Exotel env vars.
- Modify: `api/src/middleware/rateLimit.middleware.ts` — `maskedCallLimiter`.
- Modify: `api/src/jobs/queues/index.ts` — `CALL_MASKING` queue.
- Create: `api/src/jobs/workers/call-masking.worker.ts` — daily spend sweep + low-balance/kill-switch alert.
- Modify: `api/src/app.ts` (or wherever routers are mounted — confirm alongside other `/api/v1/*` mounts) — mount `call-masking.routes.ts`.
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx:175-184` — call button → `POST /rides/:id/call`.
- Modify: `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx:570-578` — same.
- Modify: `apps/driver/src/pages/ActiveRide/TripInProgress.tsx:~695-705` — same.
- Test: `api/tests/unit/call-masking/call-masking.service.test.ts`

---

### Task 1: Migration — pool, mask, and event tables

**Files:**
- Create: `api/src/db/migrations/085_call_masking.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Exotel call masking: a small rented pool of virtual numbers (ExoPhones),
-- reused across rides via allocate-on-accept / release-on-end, plus a
-- self-tracked spend ledger so we never depend on an unconfirmed Exotel
-- balance API to know when to stop.

CREATE TABLE exotel_number_pool (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  virtual_number  VARCHAR(20) UNIQUE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'allocated', 'disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exotel_number_pool_status_idx ON exotel_number_pool (status);

CREATE TABLE ride_call_masks (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id           BIGINT NOT NULL REFERENCES rides(id),
  pool_number_id    BIGINT NOT NULL REFERENCES exotel_number_pool(id),
  virtual_number    VARCHAR(20) NOT NULL,
  driver_phone      VARCHAR(20) NOT NULL,
  rider_phone       VARCHAR(20) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'released')),
  call_count        SMALLINT NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ NOT NULL,
  released_at       TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One active mask per ride at a time.
CREATE UNIQUE INDEX ride_call_masks_active_ride_idx ON ride_call_masks (ride_id) WHERE status = 'active';
CREATE INDEX ride_call_masks_expires_idx ON ride_call_masks (expires_at) WHERE status = 'active';

CREATE TABLE exotel_call_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_call_mask_id BIGINT NOT NULL REFERENCES ride_call_masks(id),
  call_sid      VARCHAR(64) UNIQUE NOT NULL,
  call_status   VARCHAR(20) NULL,
  duration_sec  INTEGER NULL,
  price_inr     NUMERIC(8,2) NULL,
  raw_payload   JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exotel_call_events_created_idx ON exotel_call_events (created_at);

INSERT INTO system_config (key, value, value_type, description, is_public) VALUES
  ('exotel_masking_enabled', 'false', 'boolean', 'Kill switch for masked calling — off until Exotel credits are loaded and verified end-to-end', false),
  ('exotel_call_time_limit_seconds', '600', 'number', 'Hard cap on a single masked call''s duration (Connect API TimeLimit)', false),
  ('exotel_max_calls_per_ride', '5', 'number', 'Max masked-call attempts allowed per ride, to blunt repeat-dial abuse', false),
  ('exotel_daily_budget_inr', '500', 'number', 'Daily masked-call spend ceiling in INR — crossing it disables masking until an admin re-enables it', false);
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: migration `085_call_masking.sql` applied, three new tables + four `system_config` rows exist.

- [ ] **Step 3: Manually seed the number pool (one-time, ops task)**

Procure a handful of ExoPhones from the Exotel dashboard/support (start with 5 — see "Pool sizing" note at the end of this plan) and insert them:

```sql
INSERT INTO exotel_number_pool (virtual_number) VALUES
  ('+91XXXXXXXXXX'), ('+91XXXXXXXXXX'), ('+91XXXXXXXXXX'), ('+91XXXXXXXXXX'), ('+91XXXXXXXXXX');
```

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/085_call_masking.sql
git commit -m "feat(call-masking): add exotel number pool, ride call masks, and call event tables"
```

---

### Task 2: Env config

**Files:**
- Modify: `api/src/config/index.ts`
- Modify: `api/.env.example`

- [ ] **Step 1: Add the Exotel block to the Zod schema**

In `api/src/config/index.ts`, add near the `// Razorpay` block:

```ts
// Exotel (call masking)
EXOTEL_SID: z.string().default(''),
EXOTEL_API_KEY: z.string().default(''),
EXOTEL_API_TOKEN: z.string().default(''),
EXOTEL_SUBDOMAIN: z.string().default('api.exotel.com'),
EXOTEL_STATUS_CALLBACK_URL: z.string().default(''),
EXOTEL_WAIT_AUDIO_URL: z.string().default(''),
```

- [ ] **Step 2: Add matching entries to `.env.example`**

```
# Exotel (call masking)
EXOTEL_SID=
EXOTEL_API_KEY=
EXOTEL_API_TOKEN=
EXOTEL_SUBDOMAIN=api.exotel.com
EXOTEL_STATUS_CALLBACK_URL=
EXOTEL_WAIT_AUDIO_URL=
```

- [ ] **Step 3: Verify**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/config/index.ts api/.env.example
git commit -m "feat(call-masking): add Exotel env config"
```

---

### Task 3: Exotel API client wrapper

**Files:**
- Create: `api/src/modules/call-masking/call-masking.exotel-client.ts`

- [ ] **Step 1: Write the client**

Exotel's Voice v1 "Connect Two Numbers" API takes HTTP Basic Auth (API Key as username, API Token as password) against `https://{subdomain}/v1/Accounts/{sid}/Calls/connect.json`.

```typescript
import { config } from '@/config'

export interface ConnectCallParams {
  from: string
  to: string
  callerId: string
  timeLimitSeconds: number
  waitAudioUrl?: string
  statusCallbackUrl?: string
  customField?: string
}

export interface ConnectCallResult {
  sid: string
  status: string
}

export async function connectTwoNumbers(params: ConnectCallParams): Promise<ConnectCallResult> {
  const url = `https://${config.EXOTEL_SUBDOMAIN}/v1/Accounts/${config.EXOTEL_SID}/Calls/connect.json`
  const auth = Buffer.from(`${config.EXOTEL_API_KEY}:${config.EXOTEL_API_TOKEN}`).toString('base64')

  const body = new URLSearchParams({
    From: params.from,
    To: params.to,
    CallerId: params.callerId,
    TimeLimit: String(params.timeLimitSeconds),
  })
  if (params.waitAudioUrl) body.set('WaitUrl', params.waitAudioUrl)
  if (params.statusCallbackUrl) body.set('StatusCallback', params.statusCallbackUrl)
  if (params.customField) body.set('CustomField', params.customField)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  const json = await res.json() as { Call?: { Sid: string; Status: string }; RestException?: { Message: string } }
  if (!res.ok || !json.Call) {
    throw new Error(json.RestException?.Message ?? 'Exotel call failed')
  }
  return { sid: json.Call.Sid, status: json.Call.Status }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/call-masking/call-masking.exotel-client.ts
git commit -m "feat(call-masking): add Exotel Connect Two Numbers API client"
```

---

### Task 4: Pool repository — allocate, release, record events, sum spend

**Files:**
- Create: `api/src/modules/call-masking/call-masking.repository.ts`
- Test: `api/tests/unit/call-masking/call-masking.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/call-masking/call-masking.repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { pool } from '@/db/client'
import * as repo from '@/modules/call-masking/call-masking.repository'

describe('call-masking repository', () => {
  beforeEach(async () => {
    await pool.query(`DELETE FROM ride_call_masks`)
    await pool.query(`DELETE FROM exotel_number_pool`)
    await pool.query(`INSERT INTO exotel_number_pool (virtual_number, status) VALUES ('+911111111111', 'available')`)
  })

  it('allocates an available number and marks it allocated', async () => {
    const mask = await repo.allocateNumber({
      rideId: 1n,
      driverPhone: '+919000000001',
      riderPhone: '+919000000002',
      ttlMinutes: 60,
    })
    expect(mask.virtualNumber).toBe('+911111111111')

    const { rows } = await pool.query(`SELECT status FROM exotel_number_pool WHERE virtual_number = '+911111111111'`)
    expect(rows[0].status).toBe('allocated')
  })

  it('returns null when the pool is exhausted', async () => {
    await pool.query(`UPDATE exotel_number_pool SET status = 'allocated'`)
    const mask = await repo.allocateNumber({
      rideId: 2n,
      driverPhone: '+919000000001',
      riderPhone: '+919000000002',
      ttlMinutes: 60,
    })
    expect(mask).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/call-masking/call-masking.repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the repository**

```typescript
// api/src/modules/call-masking/call-masking.repository.ts
import { pool } from '@/db/client'

export interface RideCallMask {
  id: bigint
  rideId: bigint
  virtualNumber: string
  driverPhone: string
  riderPhone: string
  callCount: number
  expiresAt: Date
}

export async function allocateNumber(params: {
  rideId: bigint
  driverPhone: string
  riderPhone: string
  ttlMinutes: number
}): Promise<RideCallMask | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // SKIP LOCKED so concurrent ride-accepts never fight over the same row —
    // same pattern as the broadcast fan-out's driver-candidate locking.
    const { rows: poolRows } = await client.query(
      `SELECT id, virtual_number FROM exotel_number_pool
       WHERE status = 'available'
       ORDER BY id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    )
    if (poolRows.length === 0) {
      await client.query('ROLLBACK')
      return null
    }
    const poolNumberId = poolRows[0].id as bigint
    const virtualNumber = poolRows[0].virtual_number as string

    await client.query(
      `UPDATE exotel_number_pool SET status = 'allocated', updated_at = now() WHERE id = $1`,
      [poolNumberId]
    )

    const { rows: maskRows } = await client.query(
      `INSERT INTO ride_call_masks
         (ride_id, pool_number_id, virtual_number, driver_phone, rider_phone, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval)
       RETURNING id, ride_id, virtual_number, driver_phone, rider_phone, call_count, expires_at`,
      [params.rideId, poolNumberId, virtualNumber, params.driverPhone, params.riderPhone, params.ttlMinutes]
    )

    await client.query('COMMIT')
    const row = maskRows[0]
    return {
      id: row.id,
      rideId: row.ride_id,
      virtualNumber: row.virtual_number,
      driverPhone: row.driver_phone,
      riderPhone: row.rider_phone,
      callCount: row.call_count,
      expiresAt: row.expires_at,
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getActiveMaskForRide(rideId: bigint): Promise<RideCallMask | null> {
  const { rows } = await pool.query(
    `SELECT id, ride_id, virtual_number, driver_phone, rider_phone, call_count, expires_at
     FROM ride_call_masks WHERE ride_id = $1 AND status = 'active'`,
    [rideId]
  )
  if (rows.length === 0) return null
  const row = rows[0]
  return {
    id: row.id,
    rideId: row.ride_id,
    virtualNumber: row.virtual_number,
    driverPhone: row.driver_phone,
    riderPhone: row.rider_phone,
    callCount: row.call_count,
    expiresAt: row.expires_at,
  }
}

export async function incrementCallCount(maskId: bigint): Promise<void> {
  await pool.query(`UPDATE ride_call_masks SET call_count = call_count + 1, updated_at = now() WHERE id = $1`, [maskId])
}

export async function releaseByRideId(rideId: bigint): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE ride_call_masks SET status = 'released', released_at = now(), updated_at = now()
       WHERE ride_id = $1 AND status = 'active'
       RETURNING pool_number_id`,
      [rideId]
    )
    if (rows.length > 0) {
      await client.query(
        `UPDATE exotel_number_pool SET status = 'available', updated_at = now() WHERE id = $1`,
        [rows[0].pool_number_id]
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

// Safety net for rides that never hit a terminal status cleanly (mirrors the
// scheduler worker's sweep pattern) — releases any mask past its TTL.
export async function releaseExpiredMasks(): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE ride_call_masks SET status = 'released', released_at = now(), updated_at = now()
       WHERE status = 'active' AND expires_at < now()
       RETURNING pool_number_id`
    )
    for (const row of rows) {
      await client.query(
        `UPDATE exotel_number_pool SET status = 'available', updated_at = now() WHERE id = $1`,
        [row.pool_number_id]
      )
    }
    await client.query('COMMIT')
    return rows.length
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function recordCallEvent(params: {
  rideCallMaskId: bigint
  callSid: string
  callStatus?: string
  durationSec?: number
  priceInr?: number
  rawPayload: unknown
}): Promise<boolean> {
  const { rows } = await pool.query(
    `INSERT INTO exotel_call_events (ride_call_mask_id, call_sid, call_status, duration_sec, price_inr, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (call_sid) DO NOTHING
     RETURNING id`,
    [params.rideCallMaskId, params.callSid, params.callStatus ?? null, params.durationSec ?? null, params.priceInr ?? null, JSON.stringify(params.rawPayload)]
  )
  return rows.length > 0
}

export async function getTodaySpendInr(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(price_inr), 0) AS total FROM exotel_call_events WHERE created_at >= date_trunc('day', now())`
  )
  return Number(rows[0].total)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/call-masking/call-masking.repository.test.ts`
Expected: PASS (2 tests). Requires `TEST_DATABASE_URL` pointed at a real Postgres per the repo's existing integration-test setup.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/call-masking/call-masking.repository.ts api/tests/unit/call-masking/call-masking.repository.test.ts
git commit -m "feat(call-masking): add number pool allocate/release repository"
```

---

### Task 5: Service layer — allocate/release for a ride, trigger a masked call

**Files:**
- Create: `api/src/modules/call-masking/call-masking.types.ts`
- Create: `api/src/modules/call-masking/call-masking.service.ts`
- Test: `api/tests/unit/call-masking/call-masking.service.test.ts`

- [ ] **Step 1: Write the types**

```typescript
// api/src/modules/call-masking/call-masking.types.ts
export type CallerRole = 'user' | 'driver'

export class CallMaskingError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// api/tests/unit/call-masking/call-masking.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/call-masking/call-masking.repository')
vi.mock('@/lib/system-config')
vi.mock('@/modules/call-masking/call-masking.exotel-client')

import * as repo from '@/modules/call-masking/call-masking.repository'
import * as sysConfig from '@/lib/system-config'
import * as exotel from '@/modules/call-masking/call-masking.exotel-client'
import * as service from '@/modules/call-masking/call-masking.service'
import { CallMaskingError } from '@/modules/call-masking/call-masking.types'

describe('call-masking service — triggerCall', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws MASKING_DISABLED when the kill switch is off', async () => {
    vi.mocked(sysConfig.getConfigValue).mockResolvedValue('false')
    await expect(service.triggerCall({ rideId: 1n, callerRole: 'user' }))
      .rejects.toMatchObject({ code: 'MASKING_DISABLED' })
  })

  it('throws CALL_LIMIT_REACHED when the ride has hit its per-ride call cap', async () => {
    vi.mocked(sysConfig.getConfigValue).mockImplementation(async (key: string) =>
      key === 'exotel_masking_enabled' ? 'true' : key === 'exotel_max_calls_per_ride' ? '5' : '600'
    )
    vi.mocked(repo.getActiveMaskForRide).mockResolvedValue({
      id: 1n, rideId: 1n, virtualNumber: '+911111111111',
      driverPhone: '+919000000001', riderPhone: '+919000000002',
      callCount: 5, expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(service.triggerCall({ rideId: 1n, callerRole: 'user' }))
      .rejects.toMatchObject({ code: 'CALL_LIMIT_REACHED' })
  })

  it('calls Exotel with the rider as From and the driver as To when the rider taps call', async () => {
    vi.mocked(sysConfig.getConfigValue).mockImplementation(async (key: string) =>
      key === 'exotel_masking_enabled' ? 'true' : key === 'exotel_max_calls_per_ride' ? '5' : '600'
    )
    vi.mocked(repo.getActiveMaskForRide).mockResolvedValue({
      id: 1n, rideId: 1n, virtualNumber: '+911111111111',
      driverPhone: '+919000000001', riderPhone: '+919000000002',
      callCount: 0, expiresAt: new Date(Date.now() + 60_000),
    })
    vi.mocked(exotel.connectTwoNumbers).mockResolvedValue({ sid: 'CAxxx', status: 'in-progress' })

    await service.triggerCall({ rideId: 1n, callerRole: 'user' })

    expect(exotel.connectTwoNumbers).toHaveBeenCalledWith(expect.objectContaining({
      from: '+919000000002',
      to: '+919000000001',
      callerId: '+911111111111',
    }))
    expect(repo.incrementCallCount).toHaveBeenCalledWith(1n)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/call-masking/call-masking.service.test.ts`
Expected: FAIL — `call-masking.service` module not found.

- [ ] **Step 4: Write the service**

```typescript
// api/src/modules/call-masking/call-masking.service.ts
import { config } from '@/config'
import { getConfigValue } from '@/lib/system-config'
import * as repo from '@/modules/call-masking/call-masking.repository'
import * as exotel from '@/modules/call-masking/call-masking.exotel-client'
import { CallMaskingError, type CallerRole } from '@/modules/call-masking/call-masking.types'

export async function allocateForRide(params: {
  rideId: bigint
  driverPhone: string
  riderPhone: string
}): Promise<void> {
  const enabled = await getConfigValue('exotel_masking_enabled', 'false')
  if (enabled !== 'true') return

  await repo.allocateNumber({
    rideId: params.rideId,
    driverPhone: params.driverPhone,
    riderPhone: params.riderPhone,
    ttlMinutes: 180, // covers longest realistic round-trip/rental ride; released early on completion/cancellation anyway
  })
  // A null return (pool exhausted) is intentionally swallowed here: the ride
  // proceeds without a masked-call option rather than failing the booking.
}

export async function releaseForRide(rideId: bigint): Promise<void> {
  await repo.releaseByRideId(rideId)
}

export async function triggerCall(params: {
  rideId: bigint
  callerRole: CallerRole
}): Promise<{ sid: string }> {
  const enabled = await getConfigValue('exotel_masking_enabled', 'false')
  if (enabled !== 'true') {
    throw new CallMaskingError('MASKING_DISABLED', 'Masked calling is currently disabled')
  }

  const mask = await repo.getActiveMaskForRide(params.rideId)
  if (!mask) {
    throw new CallMaskingError('NO_ACTIVE_MASK', 'No active call mask for this ride')
  }

  const maxCalls = Number(await getConfigValue('exotel_max_calls_per_ride', '5'))
  if (mask.callCount >= maxCalls) {
    throw new CallMaskingError('CALL_LIMIT_REACHED', 'Max call attempts reached for this ride')
  }

  const timeLimitSeconds = Number(await getConfigValue('exotel_call_time_limit_seconds', '600'))
  const from = params.callerRole === 'user' ? mask.riderPhone : mask.driverPhone
  const to = params.callerRole === 'user' ? mask.driverPhone : mask.riderPhone

  const call = await exotel.connectTwoNumbers({
    from,
    to,
    callerId: mask.virtualNumber,
    timeLimitSeconds,
    waitAudioUrl: config.EXOTEL_WAIT_AUDIO_URL || undefined,
    statusCallbackUrl: config.EXOTEL_STATUS_CALLBACK_URL || undefined,
    customField: mask.id.toString(),
  })

  await repo.incrementCallCount(mask.id)
  return { sid: call.sid }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/call-masking/call-masking.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/call-masking/call-masking.types.ts api/src/modules/call-masking/call-masking.service.ts api/tests/unit/call-masking/call-masking.service.test.ts
git commit -m "feat(call-masking): add triggerCall service with kill switch and per-ride cap"
```

---

### Task 6: Wire allocation/release into the ride lifecycle

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts`

- [ ] **Step 1: Allocate on accept**

In `acceptRide()` (`rides.service.ts`, starts L609), after the existing `socketEvents.sendDriverAssigned` call (L660-672) — the ride now has both `driver_phone` and `rider_phone`/`user_phone` resolved — add:

```typescript
  await callMasking.allocateForRide({
    rideId,
    driverPhone: ride!.driver_phone,
    riderPhone: ride!.rider_phone ?? ride!.user_phone,
  })
```

Add the import at the top of the file: `import * as callMasking from '@/modules/call-masking/call-masking.service'`

- [ ] **Step 2: Release on cancel (both paths) and expiry**

In `cancelRide()` (L977, UPDATE at L998), `cancelRideAsDriver()` (L1066, UPDATE at L1088), and `expireStaleAcceptedOrArrivedRide()` (L1330, UPDATE at L1340) — immediately after each status-update query succeeds, add:

```typescript
  await callMasking.releaseForRide(rideId)
```

- [ ] **Step 3: Release on completion (both paths)**

In `endRideEarlyAsDriver()` (completion payload at L1244) and `verifyEndOTP()` (completion payload at L1632) — immediately after the ride row is updated to `completed`, add the same:

```typescript
  await callMasking.releaseForRide(rideId)
```

- [ ] **Step 4: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors. If `ride!.driver_phone`/`rider_phone`/`user_phone` aren't in scope at the exact line in `acceptRide`, use whatever the already-fetched ride row's actual field names are at that point (check the `repo.getRideById`-style call earlier in the function) — don't re-fetch.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.service.ts
git commit -m "feat(call-masking): allocate a masked number on ride accept, release on end/cancel/expiry"
```

---

### Task 7: Routes — trigger call + Exotel status webhook

**Files:**
- Create: `api/src/modules/call-masking/call-masking.routes.ts`
- Modify: wherever routers are mounted (find the file that mounts `/api/v1/rides`, `/api/v1/payments`, etc. — likely `api/src/app.ts`)

- [ ] **Step 1: Write the routes**

```typescript
// api/src/modules/call-masking/call-masking.routes.ts
import { Router, type IRouter } from 'express'
import { authenticate } from '@/middleware/auth.middleware'
import { maskedCallLimiter } from '@/middleware/rateLimit.middleware'
import * as service from '@/modules/call-masking/call-masking.service'
import * as repo from '@/modules/call-masking/call-masking.repository'
import { CallMaskingError } from '@/modules/call-masking/call-masking.types'

const router: IRouter = Router()

router.post('/rides/:id/call', authenticate(), maskedCallLimiter, async (req, res, next) => {
  try {
    const rideId = BigInt(req.params['id']!)
    const callerRole = req.user ? 'user' as const : 'driver' as const
    const result = await service.triggerCall({ rideId, callerRole })
    res.json({ status: 'calling', sid: result.sid })
  } catch (err) {
    if (err instanceof CallMaskingError) {
      res.status(409).json({ error: err.message, code: err.code })
      return
    }
    next(err)
  }
})

// Exotel StatusCallback — async, arrives ~2 min after the call ends. Not
// signature-verified (Exotel's StatusCallback has no HMAC like Razorpay's
// webhook); CustomField carries our ride_call_mask id so we can validate the
// event maps to a mask we actually created, and CallSid dedupes retries.
router.post('/webhooks/exotel/status', async (req, res, next) => {
  try {
    const body = req.body as Record<string, string>
    const maskId = body['CustomField']
    const callSid = body['CallSid']
    if (!maskId || !callSid) { res.status(400).json({ error: 'Missing CallSid/CustomField' }); return }

    await repo.recordCallEvent({
      rideCallMaskId: BigInt(maskId),
      callSid,
      callStatus: body['Status'],
      durationSec: body['Duration'] ? Number(body['Duration']) : undefined,
      priceInr: body['Price'] ? Math.abs(Number(body['Price'])) : undefined,
      rawPayload: body,
    })
    res.json({ status: 'ok' })
  } catch (err) {
    next(err)
  }
})

export default router
```

- [ ] **Step 2: Mount the router**

Find the file that mounts other `/api/v1/*` routers (grep for `app.use('/api/v1/rides'` to locate it) and add, next to the other mounts:

```typescript
import callMaskingRoutes from '@/modules/call-masking/call-masking.routes'
// ...
app.use('/api/v1', callMaskingRoutes)
```

- [ ] **Step 3: Add the rate limiter**

In `api/src/middleware/rateLimit.middleware.ts`, add next to `chatMessageLimiter`:

```typescript
// Per (principal, ride) masked-call throttle — real phone calls cost real
// money per minute, so this is intentionally tighter than chat.
export const maskedCallLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req) => `call:${principalKey(req)}:${req.params['id'] ?? ''}`,
  message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
})
```

- [ ] **Step 4: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/call-masking/call-masking.routes.ts api/src/middleware/rateLimit.middleware.ts api/src/app.ts
git commit -m "feat(call-masking): add call-trigger endpoint and Exotel status webhook"
```

---

### Task 8: Daily spend sweep + kill-switch alert

**Files:**
- Modify: `api/src/jobs/queues/index.ts`
- Create: `api/src/jobs/workers/call-masking.worker.ts`
- Modify: wherever workers are registered at boot (grep for `schedulerWorker` usage to find it)

- [ ] **Step 1: Add the queue**

In `api/src/jobs/queues/index.ts`:

```typescript
  CALL_MASKING: 'call-masking',
```

(add to `QUEUE_NAMES`, alongside the others), and:

```typescript
export const callMaskingQueue = new Queue(QUEUE_NAMES.CALL_MASKING, { connection })
```

(add to the queue exports and the `queues` object, following the exact pattern of `schedulerQueue`).

- [ ] **Step 2: Write the worker**

```typescript
// api/src/jobs/workers/call-masking.worker.ts
import { Worker } from 'bullmq'
import { redisConnection, QUEUE_NAMES } from '@/jobs/queues'
import { createWorkerLogger } from '@/lib/worker-logger'
import { pool } from '@/db/client'
import * as repo from '@/modules/call-masking/call-masking.repository'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'

const log = createWorkerLogger('call-masking')

export const callMaskingWorker = new Worker(
  QUEUE_NAMES.CALL_MASKING,
  async (job) => {
    if (job.name === 'sweep_expired_masks') {
      const released = await repo.releaseExpiredMasks()
      if (released > 0) log.info({ released }, 'released expired call masks')
      return
    }

    if (job.name === 'check_daily_spend') {
      const spend = await repo.getTodaySpendInr()
      const { rows } = await pool.query(
        `SELECT value FROM system_config WHERE key = 'exotel_daily_budget_inr' AND status = 'active'`
      )
      const budget = Number(rows[0]?.value ?? '500')
      if (spend >= budget) {
        await pool.query(
          `UPDATE system_config SET value = 'false', updated_at = now() WHERE key = 'exotel_masking_enabled'`
        )
        await notifyAllAdmins({
          type: 'exotel_budget_exceeded',
          title: 'Masked calling auto-disabled',
          body: `Today's Exotel spend (₹${spend.toFixed(2)}) hit the ₹${budget} daily budget — masking has been switched off. Re-enable exotel_masking_enabled once reviewed.`,
        })
      }
      return
    }
  },
  { connection: redisConnection }
)

callMaskingWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'call-masking job failed')
})
```

- [ ] **Step 3: Schedule the repeatable jobs and register the worker**

Find where `schedulerWorker` is imported/started at boot (grep `schedulerWorker` outside its own file) and add `callMaskingWorker` the same way. Then, near wherever repeatable jobs are scheduled at boot (grep for `sweep_scheduled_rides` job scheduling to find the pattern), add:

```typescript
await callMaskingQueue.add('sweep_expired_masks', {}, { repeat: { every: 5 * 60 * 1000 } })
await callMaskingQueue.add('check_daily_spend', {}, { repeat: { every: 15 * 60 * 1000 } })
```

- [ ] **Step 4: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api/src/jobs/queues/index.ts api/src/jobs/workers/call-masking.worker.ts
git commit -m "feat(call-masking): sweep expired masks and auto-disable masking on daily budget breach"
```

---

### Task 9: Frontend — user app call button

**Files:**
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx:175-184`
- Modify: `apps/user/lib/ride-api.ts` — add `triggerMaskedCall`

- [ ] **Step 1: Add the API call**

In `apps/user/lib/ride-api.ts`, add alongside the other ride-tracking calls:

```typescript
export async function triggerMaskedCall(rideId: string): Promise<{ status: string; sid: string }> {
  const { data } = await api.post(`/rides/${rideId}/call`)
  return data
}
```

- [ ] **Step 2: Replace the `tel:` link with a call-trigger button**

Replace the block at `page.tsx:175-184`:

```tsx
      {ride?.driver_phone && (
        <a
          href={`tel:${ride.driver_phone}`}
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
          style={{ background: '#E4F8FA' }}
          aria-label="Call driver"
        >
          <Phone size={14} style={{ color: '#0A9FB0' }} />
        </a>
      )}
```

with (masked calling is available once the ride has a driver, independent of whether `driver_phone` is present — it's `null` post-masking, so gate on `hasDriver`/an existing driver-assigned flag instead):

```tsx
      {hasDriver && (
        <button
          onClick={async () => {
            try {
              await triggerMaskedCall(rideId)
            } catch {
              // masking disabled/limit reached — silently no-op, no raw number to fall back to
            }
          }}
          className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
          style={{ background: '#E4F8FA' }}
          aria-label="Call driver"
        >
          <Phone size={14} style={{ color: '#0A9FB0' }} />
        </button>
      )}
```

Import `triggerMaskedCall` from `@/lib/ride-api` at the top of the file. Confirm the exact existing boolean this component uses elsewhere for "driver is assigned" (the surrounding component already renders driver name/rating conditionally — reuse that same guard instead of introducing a new one).

- [ ] **Step 3: Manual check**

Run: `cd apps/user && pnpm dev`, open an active ride with a driver assigned, tap the call icon, confirm a `POST /rides/:id/call` fires (network tab) instead of opening the phone dialer directly.

- [ ] **Step 4: Commit**

```bash
git add "apps/user/app/(main)/ride/[id]/page.tsx" apps/user/lib/ride-api.ts
git commit -m "feat(call-masking): route rider's call-driver button through masked-call API"
```

---

### Task 10: Frontend — driver app call buttons

**Files:**
- Modify: `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx:570-578`
- Modify: `apps/driver/src/pages/ActiveRide/TripInProgress.tsx` (same button, ~L695-705)
- Modify: `apps/driver/src/lib/onboarding-api.ts` or wherever the driver app's ride API client lives — add `triggerMaskedCall`

- [ ] **Step 1: Add the API call**

Add to the driver app's ride API module (find it via the same axios-instance pattern used for other ride actions):

```typescript
export async function triggerMaskedCall(rideId: string): Promise<{ status: string; sid: string }> {
  const { data } = await api.post(`/rides/${rideId}/call`)
  return data
}
```

- [ ] **Step 2: Replace both `tel:` links**

In `NavigateToPickup.tsx:570-578` and the equivalent block in `TripInProgress.tsx`, replace:

```tsx
                {activeRide?.userPhone && (
                  <a
                    href={`tel:${activeRide.userPhone}`}
                    className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center active:scale-95 transition-transform"
                    aria-label="Call rider"
                  >
                    <Phone size={18} className="text-text-secondary" />
                  </a>
                )}
```

with:

```tsx
                {activeRide && (
                  <button
                    onClick={async () => {
                      try {
                        await triggerMaskedCall(activeRide.id)
                      } catch {
                        // masking disabled/limit reached — no raw number to fall back to
                      }
                    }}
                    className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center active:scale-95 transition-transform"
                    aria-label="Call rider"
                  >
                    <Phone size={18} className="text-text-secondary" />
                  </button>
                )}
```

(Confirm `activeRide.id` is the correct existing field name for the ride ID in this component's state shape before using it.)

- [ ] **Step 3: Manual check**

Run: `cd apps/driver && pnpm dev`, go through pickup/trip-in-progress with an active ride, tap the call icon on both screens, confirm `POST /rides/:id/call` fires.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx apps/driver/src/pages/ActiveRide/TripInProgress.tsx
git commit -m "feat(call-masking): route driver's call-rider button through masked-call API"
```

---

### Task 11: End-to-end manual verification

1. Confirm `exotel_masking_enabled` is `'false'` in `system_config` — deploy everything with masking off first, verify nothing breaks (call buttons should silently no-op, same as today's already-shipped "hide numbers" behavior).
2. Load real Exotel credentials into `.env` (`EXOTEL_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`), confirm the 5 seeded ExoPhones are active on the Exotel dashboard.
3. Record/upload a short "Connecting you to your Ocar driver, please hold" WAV, set `EXOTEL_WAIT_AUDIO_URL` to its public URL.
4. Set `EXOTEL_STATUS_CALLBACK_URL` to `https://<api-host>/api/v1/webhooks/exotel/status`.
5. Flip `system_config.exotel_masking_enabled` to `'true'`.
6. Book a ride as a user, accept as a driver on a second device. Confirm a `ride_call_masks` row appears with a pool number, and that number flips to `allocated` in `exotel_number_pool`.
7. Tap "Call driver" on the rider's screen — confirm the rider's own phone rings first (masked caller ID = the virtual number), answering bridges to the driver's real phone, and the driver sees the virtual number, not the rider's.
8. Let the call run past `exotel_call_time_limit_seconds` (temporarily set it low, e.g. `30`, for this test) and confirm Exotel drops the call at the cap.
9. Tap call 6 times in a row (`exotel_max_calls_per_ride = 5`) and confirm the 6th returns `409 CALL_LIMIT_REACHED`.
10. Complete the ride, confirm `ride_call_masks.status = 'released'` and the pool number flips back to `available` within seconds.
11. Check `exotel_call_events` has rows with `duration_sec`/`price_inr` populated a couple minutes after each call (StatusCallback is async).
12. Temporarily set `system_config.exotel_daily_budget_inr` to `1`, make one more call, wait for the `check_daily_spend` job to fire (or trigger it manually), confirm `exotel_masking_enabled` flips back to `'false'` and an admin notification arrives.

---

## Pool sizing note

Start with **5 ExoPhones**. A number is only held for the ride's active duration (allocate on accept, release on completion/cancellation/expiry — typically 15-90 minutes), not for the ride's full lifetime from booking, so pool size needs to track **peak concurrent accepted-or-in-progress rides**, not daily ride volume. Watch for `allocateNumber` returning `null` (pool exhausted, silently skipped today per Task 5 Step 4) — add a log line there before launch so exhaustion is visible, and grow the pool a few numbers at a time as concurrent-ride volume grows. Revisit LeadAssist/ExoBridge (see plan header) once manually managing pool size becomes real ops overhead.

## Deferred / out of scope

- LeadAssist/ExoBridge managed pooling (see architecture note above — swap-in later, not a blocker for launch).
- In-app VoIP (no telephony bridge, real phone call only) — this plan intentionally keeps using the real phone network via Exotel, not building a WebRTC layer.
- Per-number-type cost tiers (landline vs mobile ExoPhone pricing) — start with whatever Exotel provisions by default, tune after the first real invoice.
