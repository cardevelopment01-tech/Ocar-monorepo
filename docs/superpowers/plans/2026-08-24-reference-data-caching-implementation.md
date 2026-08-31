# Reference-Data Caching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the hottest, safest-to-cache Postgres reads (rate cards, system config, cities,
vehicle categories, and the remaining seed-only reference tables) behind a shared Redis
cache-aside helper with delete-on-write invalidation, single-flight miss collapsing, negative
caching, and TTL jitter — per
`docs/superpowers/specs/2026-08-23-reference-data-caching-design.md`.

**Architecture:** One shared helper (`lib/cache/reference-cache.ts`) provides `cachedRead()` and
`invalidate()`. Every reference-data read function is rewritten as a thin wrapper: the original
SQL body is renamed to a private `fetchXFromDb()` and called only on a cache miss. Every write
path that mutates a Tier-1 table calls `invalidate()` with the same key(s) **after** its
transaction commits, never before. `rate_cards` uses a namespace-version counter instead of
enumerating derived keys, because one write can affect many resolved `(category, rideType,
city)` combinations at once.

**Tech Stack:** ioredis (existing `api/src/db/redis.ts`), vitest, prom-client.

**Verified against live code on 2026-08-24** — all file paths, function names, and line numbers
below were confirmed by reading the actual files, not assumed from the design doc (which may
drift). Two tables in the design doc's classification (`vehicle_brands`, `vehicle_models`) are
intentionally **out of scope** — the design doc's own §10 rollout order never schedules them, so
building them now would be scope creep beyond what was asked for. Add them later with the same
recipe as Task 8 if read volume ever justifies it.

---

## Task 1: Single-flight helper

**Files:**
- Create: `api/src/lib/cache/single-flight.ts`
- Test: `api/src/lib/cache/single-flight.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// api/src/lib/cache/single-flight.test.ts
import { describe, it, expect, vi } from 'vitest'
import { singleFlight } from './single-flight'

describe('singleFlight', () => {
  it('calls fn once and returns its result', async () => {
    const fn = vi.fn().mockResolvedValue('value')
    const result = await singleFlight('key-a', fn)
    expect(result).toBe('value')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent calls for the same key into one fn invocation', async () => {
    let resolveFn: (v: string) => void
    const fn = vi.fn(() => new Promise<string>((resolve) => { resolveFn = resolve }))

    const p1 = singleFlight('key-b', fn)
    const p2 = singleFlight('key-b', fn)
    resolveFn!('shared')

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe('shared')
    expect(r2).toBe('shared')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not collapse calls for different keys', async () => {
    const fn = vi.fn().mockResolvedValue('x')
    await Promise.all([singleFlight('key-c', fn), singleFlight('key-d', fn)])
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('allows a fresh call after the in-flight promise settles', async () => {
    const fn = vi.fn().mockResolvedValue('x')
    await singleFlight('key-e', fn)
    await singleFlight('key-e', fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not cache a rejection — a failed call can be retried', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('recovered')
    await expect(singleFlight('key-f', fn)).rejects.toThrow('boom')
    const result = await singleFlight('key-f', fn)
    expect(result).toBe('recovered')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/lib/cache/single-flight.test.ts`
Expected: FAIL — `Cannot find module './single-flight'`

- [ ] **Step 3: Write the implementation**

```ts
// api/src/lib/cache/single-flight.ts
const inflight = new Map<string, Promise<unknown>>()

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/lib/cache/single-flight.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/cache/single-flight.ts api/src/lib/cache/single-flight.test.ts
git commit -m "feat(cache): add single-flight helper for collapsing concurrent cache misses"
```

---

## Task 2: Core reference-cache helper (`cachedRead` / `invalidate`)

**Files:**
- Create: `api/src/lib/cache/reference-cache.ts`
- Test: `api/src/lib/cache/reference-cache.test.ts`
- Modify: `api/src/observability/metrics.ts:1` (add `Counter` import + two counters)

This is the module every subsequent task depends on. It wraps the existing `getJSON` /
`setWithTTL` from `api/src/db/redis.ts` (already used by `auth.middleware.ts` and
`geo.service.ts` — same style, reused here) with: single-flight collapsing, TTL jitter (§04c of
the design doc), negative-result caching (rule 8), and metrics.

`getJSON` already swallows every internal error and resolves `null` on failure (see
`api/src/db/redis.ts:40-48`) — that is what makes rule 4 ("a cache miss is not an error") true for
reads with zero extra code here. `setWithTTL` does **not** swallow errors, so `cachedRead` wraps
it in its own try/catch — a failed cache **write** must never fail the read that triggered it.

- [ ] **Step 1: Add the two counters to metrics.ts**

Read `api/src/observability/metrics.ts` first — it currently imports `Registry, collectDefaultMetrics, Histogram, Gauge` from `prom-client` (no `Counter` yet) and exports `register`, `httpRequestDuration`, and two `Gauge`s. Add `Counter` to the import and append these two exports after `httpRequestDuration` (same file, same `registers: [register]` pattern — do not create a second registry):

```ts
export const cacheHitsTotal = new Counter({
  name: 'cache_hits_total',
  help: 'Reference-data cache hits by table',
  labelNames: ['table'],
  registers: [register],
})

export const cacheMissesTotal = new Counter({
  name: 'cache_misses_total',
  help: 'Reference-data cache misses by table',
  labelNames: ['table'],
  registers: [register],
})
```

- [ ] **Step 2: Write the failing test**

```ts
// api/src/lib/cache/reference-cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetJSON = vi.fn()
const mockSetWithTTL = vi.fn()
const mockDel = vi.fn()
vi.mock('@/db/redis', () => ({
  getJSON: (...a: unknown[]) => mockGetJSON(...a),
  setWithTTL: (...a: unknown[]) => mockSetWithTTL(...a),
  client: { del: (...a: unknown[]) => mockDel(...a) },
}))

const mockHitsInc = vi.fn()
const mockMissesInc = vi.fn()
vi.mock('@/observability/metrics', () => ({
  cacheHitsTotal: { inc: (...a: unknown[]) => mockHitsInc(...a) },
  cacheMissesTotal: { inc: (...a: unknown[]) => mockMissesInc(...a) },
}))

import { cachedRead, invalidate } from './reference-cache'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cachedRead', () => {
  it('returns the cached value on a hit without calling fetchFn', async () => {
    mockGetJSON.mockResolvedValue({ id: 1 })
    const fetchFn = vi.fn()

    const result = await cachedRead('rate_cards', 'ref:v1:test:1', 3600, fetchFn)

    expect(result).toEqual({ id: 1 })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(mockHitsInc).toHaveBeenCalledWith({ table: 'rate_cards' })
  })

  it('fetches and populates the cache on a miss', async () => {
    mockGetJSON.mockResolvedValue(null)
    const fetchFn = vi.fn().mockResolvedValue({ id: 2 })

    const result = await cachedRead('rate_cards', 'ref:v1:test:2', 3600, fetchFn)

    expect(result).toEqual({ id: 2 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(mockMissesInc).toHaveBeenCalledWith({ table: 'rate_cards' })
    expect(mockSetWithTTL).toHaveBeenCalledWith(
      'ref:v1:test:2',
      JSON.stringify({ id: 2 }),
      expect.any(Number)
    )
  })

  it('falls through to fetchFn when getJSON rejects (redis down)', async () => {
    mockGetJSON.mockRejectedValue(new Error('redis down'))
    const fetchFn = vi.fn().mockResolvedValue({ id: 3 })

    const result = await cachedRead('rate_cards', 'ref:v1:test:3', 3600, fetchFn)

    expect(result).toEqual({ id: 3 })
  })

  it('still returns the fetched value when the cache write fails', async () => {
    mockGetJSON.mockResolvedValue(null)
    mockSetWithTTL.mockRejectedValue(new Error('redis down'))
    const fetchFn = vi.fn().mockResolvedValue({ id: 4 })

    const result = await cachedRead('rate_cards', 'ref:v1:test:4', 3600, fetchFn)

    expect(result).toEqual({ id: 4 })
  })

  it('caches a negative result and does not call fetchFn again while it is cached', async () => {
    mockGetJSON.mockResolvedValueOnce(null).mockResolvedValueOnce('__NULL__')
    const fetchFn = vi.fn().mockResolvedValue(null)

    const first = await cachedRead('rate_cards', 'ref:v1:test:5', 3600, fetchFn)
    expect(first).toBeNull()
    expect(mockSetWithTTL).toHaveBeenCalledWith(
      'ref:v1:test:5',
      JSON.stringify('__NULL__'),
      expect.any(Number)
    )

    const second = await cachedRead('rate_cards', 'ref:v1:test:5', 3600, fetchFn)
    expect(second).toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('uses the shorter negative TTL (~30s) for a null result, not the positive TTL', async () => {
    mockGetJSON.mockResolvedValue(null)
    const fetchFn = vi.fn().mockResolvedValue(null)

    await cachedRead('rate_cards', 'ref:v1:test:6', 3600, fetchFn)

    const [, , ttlUsed] = mockSetWithTTL.mock.calls[0]
    expect(ttlUsed).toBeLessThan(60)
  })

  it('collapses concurrent misses for the same key into one fetchFn call', async () => {
    mockGetJSON.mockResolvedValue(null)
    let resolveFetch: (v: unknown) => void
    const fetchFn = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))

    const p1 = cachedRead('rate_cards', 'ref:v1:test:7', 3600, fetchFn)
    const p2 = cachedRead('rate_cards', 'ref:v1:test:7', 3600, fetchFn)
    resolveFetch!({ id: 7 })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual({ id: 7 })
    expect(r2).toEqual({ id: 7 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('applies TTL jitter within +/-10% of the base TTL', async () => {
    mockGetJSON.mockResolvedValue(null)
    const fetchFn = vi.fn().mockResolvedValue({ id: 8 })

    await cachedRead('rate_cards', 'ref:v1:test:8', 1000, fetchFn)

    const [, , ttlUsed] = mockSetWithTTL.mock.calls[0]
    expect(ttlUsed).toBeGreaterThanOrEqual(900)
    expect(ttlUsed).toBeLessThanOrEqual(1100)
  })
})

describe('invalidate', () => {
  it('calls redis DEL with the given keys', async () => {
    await invalidate('ref:v1:a', 'ref:v1:b')
    expect(mockDel).toHaveBeenCalledWith('ref:v1:a', 'ref:v1:b')
  })

  it('swallows redis errors instead of throwing', async () => {
    mockDel.mockRejectedValue(new Error('redis down'))
    await expect(invalidate('ref:v1:a')).resolves.toBeUndefined()
  })

  it('is a no-op when called with zero keys', async () => {
    await invalidate()
    expect(mockDel).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run src/lib/cache/reference-cache.test.ts`
Expected: FAIL — `Cannot find module './reference-cache'`

- [ ] **Step 4: Write the implementation**

```ts
// api/src/lib/cache/reference-cache.ts
import { getJSON, setWithTTL, client as redisClient } from '@/db/redis'
import { logger } from '@/lib/logger'
import { cacheHitsTotal, cacheMissesTotal } from '@/observability/metrics'
import { singleFlight } from './single-flight'

const NEGATIVE_SENTINEL = '__NULL__'
const NEGATIVE_TTL_SECONDS = 30

function jitter(baseSeconds: number): number {
  return Math.floor(baseSeconds * (0.9 + Math.random() * 0.2))
}

/**
 * Cache-aside read with single-flight miss collapsing, TTL jitter, and negative
 * caching. `table` is a metrics label only (e.g. 'rate_cards') — it never touches
 * the cache key itself.
 */
export async function cachedRead<T>(
  table: string,
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T | null>
): Promise<T | null> {
  return singleFlight(key, async () => {
    const cached = await getJSON<T | typeof NEGATIVE_SENTINEL>(key)

    if (cached === NEGATIVE_SENTINEL) {
      cacheHitsTotal.inc({ table })
      return null
    }
    if (cached !== null) {
      cacheHitsTotal.inc({ table })
      return cached
    }

    cacheMissesTotal.inc({ table })
    const value = await fetchFn()

    try {
      const ttl = jitter(value === null ? NEGATIVE_TTL_SECONDS : ttlSeconds)
      await setWithTTL(key, JSON.stringify(value === null ? NEGATIVE_SENTINEL : value), ttl)
    } catch (err) {
      logger.warn({ err, key }, 'reference-cache: failed to populate cache, serving DB value')
    }

    return value
  })
}

/** Delete-on-write invalidation. Call only after the write transaction has committed. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    await redisClient.del(...keys)
  } catch (err) {
    logger.warn({ err, keys }, 'reference-cache: failed to invalidate, will serve stale until TTL')
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run src/lib/cache/reference-cache.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/cache/reference-cache.ts api/src/lib/cache/reference-cache.test.ts api/src/observability/metrics.ts
git commit -m "feat(cache): add cachedRead/invalidate helper with jitter, negative caching, metrics"
```

---

## Task 3: `rate_cards` — highest-value, dual-write-path table

**Files:**
- Modify: `api/src/constants/redis-keys.ts` (add key builders)
- Modify: `api/src/constants/limits.ts` (add TTL constant)
- Modify: `api/src/modules/pricing/pricing.repository.ts:3-19` (`getCurrentRateCard`)
- Modify: `api/src/modules/pricing/pricing.repository.ts:174-204` (`createRateCard`)
- Modify: `api/src/modules/admin/admin.repository.ts:1524-1580` (`createAdminRateCard`)

`rate_cards` resolves per `(categoryId, rideType, cityId | global)` — one admin edit to the
*global* row can change the resolved value for every city that doesn't have its own override.
Enumerating every affected key on write is fragile (§07 of the design doc calls this out
explicitly). Use a namespace-version counter instead: reads build their key from the current
version, writes just `INCR` the version — every previously-built key is orphaned instantly and
expires naturally by TTL.

- [ ] **Step 1: Add key builders to `redis-keys.ts`**

Open `api/src/constants/redis-keys.ts` — it already exports `routeKey` (line 19) in this style.
Add:

```ts
export const RATE_CARD_VERSION_KEY = 'ref:v1:rate_card:ver'

export function rateCardKey(
  version: string,
  categoryId: number,
  rideType: string,
  cityId: number | null
): string {
  return `ref:v1:rate_card:${version}:${categoryId}:${rideType}:${cityId ?? 'global'}`
}
```

- [ ] **Step 2: Add the TTL constant to `limits.ts`**

Open `api/src/constants/limits.ts` — it already exports `ROUTE_CACHE_TTL_SECONDS = 90` (line 53)
in this style. Add next to it:

```ts
export const RATE_CARD_CACHE_TTL_SECONDS = 3600 // 1h — money-affecting, short backstop TTL
```

- [ ] **Step 3: Wrap `getCurrentRateCard` in `pricing.repository.ts`**

Read the current function first (lines 3-19) to confirm the SQL hasn't drifted, then replace it
with:

```ts
import { cachedRead, invalidate } from '@/lib/cache/reference-cache'
import { client as redisClient } from '@/db/redis'
import { rateCardKey, RATE_CARD_VERSION_KEY } from '@/constants/redis-keys'
import { RATE_CARD_CACHE_TTL_SECONDS } from '@/constants/limits'

export async function getCurrentRateCard(
  categoryId: number,
  rideType: string,
  cityId: number | null
) {
  const version = (await redisClient.get(RATE_CARD_VERSION_KEY)) ?? '0'
  const key = rateCardKey(version, categoryId, rideType, cityId)
  return cachedRead('rate_cards', key, RATE_CARD_CACHE_TTL_SECONDS, () =>
    fetchCurrentRateCardFromDb(categoryId, rideType, cityId)
  )
}

async function fetchCurrentRateCardFromDb(
  categoryId: number,
  rideType: string,
  cityId: number | null
) {
  const res = await pool.query(
    `SELECT rc.*,
            vc.display_name AS category_name,
            vc.slug AS category_slug
     FROM rate_cards rc
     JOIN vehicle_categories vc ON vc.id = rc.category_id
     WHERE rc.category_id = $1
       AND rc.ride_type = $2
       AND rc.effective_to IS NULL
       AND (rc.city_id = $3 OR rc.city_id IS NULL)
     ORDER BY rc.city_id NULLS LAST
     LIMIT 1`,
    [categoryId, rideType, cityId]
  )
  return res.rows[0] ?? null
}
```

Note `redisClient` (aliased from `@/db/redis`'s `client`) — both `createRateCard` in this same
file and `createAdminRateCard` use a local `client` variable for their `pool.connect()` transaction
handle, so the redis client **must** be imported under a different name to avoid shadowing it.

- [ ] **Step 4: Invalidate in `pricing.repository.ts`'s `createRateCard` (lines 174-204)**

After the existing `COMMIT` (this function already wraps its writes in `BEGIN`/`COMMIT` via its
own `pool.connect()` — do not restructure that transaction, only add the invalidation call after
it resolves):

```ts
    await client.query('COMMIT')
    await redisClient.incr(RATE_CARD_VERSION_KEY)
```

- [ ] **Step 5: Invalidate in `admin.repository.ts`'s `createAdminRateCard` (lines 1524-1580)**

Same pattern — this is write-path B for the same table (§07's trap: fixing only one path leaves
the other silently serving stale prices). Import `redisClient` and `RATE_CARD_VERSION_KEY` at the
top of `admin.repository.ts`, then after its `COMMIT` (line 1573):

```ts
    await client.query('COMMIT')
    await redisClient.incr(RATE_CARD_VERSION_KEY)
```

- [ ] **Step 6: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Manual verification of both write paths**

Run: `cd api && pnpm dev` (in one terminal), then in another:

```powershell
# 1. Hit the estimate endpoint twice, confirm second call is a cache hit (check logs/metrics, no new pg query in pg_stat_statements delta)
# 2. Edit the same rate card via the ADMIN endpoint (write path A)
# 3. Re-hit the estimate endpoint — the new price must appear immediately, not after 1h
# 4. Edit the same rate card via the PRICING module's own write path (write path B), if it is reachable independently
# 5. Re-hit the estimate endpoint — the new price must appear immediately
```

This is the exact test the design doc's §10 verification section calls for — it is the one that
catches a fix applied to only one write path.

- [ ] **Step 8: Commit**

```bash
git add api/src/constants/redis-keys.ts api/src/constants/limits.ts api/src/modules/pricing/pricing.repository.ts api/src/modules/admin/admin.repository.ts
git commit -m "feat(cache): cache getCurrentRateCard behind a version-counter invalidation scheme"
```

---

## Task 4: `system_config` — kill switches, TTL is a safety decision

**Files:**
- Modify: `api/src/constants/redis-keys.ts` (add `configKey`)
- Modify: `api/src/constants/limits.ts` (add TTL constant)
- Modify: `api/src/lib/system-config.ts:3-10` (`getConfigValue`) and `:77-86` (`updateConfigValue`)
- Modify: `api/src/modules/call-masking/call-masking.service.ts:101-109` (`checkDailySpend` — the
  bypass write path that does not go through `updateConfigValue`)
- Modify: `CLAUDE.md` (correct the two "read live on every request" claims — see Step 6)

- [ ] **Step 1: Add key builder and TTL constant**

`redis-keys.ts`:
```ts
export function configKey(key: string): string {
  return `ref:v1:config:${key}`
}
```

`limits.ts`:
```ts
export const CONFIG_CACHE_TTL_SECONDS = 30 // kill switches — bounds worst-case staleness only; a real flip is invalidated immediately
```

- [ ] **Step 2: Wrap `getConfigValue`**

Read `api/src/lib/system-config.ts` in full first (87 lines) to confirm it hasn't drifted, then
replace `getConfigValue` (lines 3-10):

```ts
import { cachedRead, invalidate } from '@/lib/cache/reference-cache'
import { configKey } from '@/constants/redis-keys'
import { CONFIG_CACHE_TTL_SECONDS } from '@/constants/limits'

export async function getConfigValue(key: string, fallback: string): Promise<string> {
  const value = await cachedRead('system_config', configKey(key), CONFIG_CACHE_TTL_SECONDS, () =>
    fetchConfigValueFromDb(key)
  )
  return value ?? fallback
}

async function fetchConfigValueFromDb(key: string): Promise<string | null> {
  const res = await pool.query(
    `SELECT value FROM system_config WHERE key = $1 AND status = 'active'`,
    [key]
  )
  return res.rows[0]?.value ?? null
}
```

- [ ] **Step 3: Invalidate in `updateConfigValue` (lines 77-86)**

```ts
export async function updateConfigValue(
  id: bigint,
  value: string,
  updatedBy: bigint
): Promise<SystemConfigRow | null> {
  const res = await pool.query<ConfigRow>(
    `UPDATE system_config SET value = $2, updated_by = $3
     WHERE id = $1 AND status = 'active'
     RETURNING ${CONFIG_COLUMNS}`,
    [id, value, updatedBy]
  )
  const row = res.rows[0]
  if (!row) return null
  await invalidate(configKey(row.key))
  return toConfig(row)
}
```

- [ ] **Step 4: Invalidate the bypass write path in `call-masking.service.ts`**

This write (lines 106-109) updates `system_config` directly with raw SQL, skipping
`updateConfigValue` entirely — per §05 of the design doc, this path must invalidate too or the
cache will keep serving `'true'` for up to 30s after `checkDailySpend` flips the switch off.

```ts
import { invalidate } from '@/lib/cache/reference-cache'
import { configKey } from '@/constants/redis-keys'

// inside checkDailySpend(), after the existing UPDATE:
const { rowCount } = await pool.query(
  `UPDATE system_config SET value = 'false', updated_at = now()
   WHERE key = 'exotel_masking_enabled' AND value = 'true'`
)
if (!rowCount) return
await invalidate(configKey('exotel_masking_enabled'))
```

- [ ] **Step 5: Typecheck and run existing tests**

Run: `cd api && npx tsc --noEmit && pnpm test`
Expected: no new errors, all existing tests still pass

- [ ] **Step 6: Correct `CLAUDE.md`'s stale safety claims**

Open the project's `CLAUDE.md`. Two "Pending Ops Actions" bullets currently say the config value
is "read live on every request. No deploy needed." That is no longer accurate once this task
lands — it is now cached for up to 30s, invalidated immediately on write. Update both occurrences
(the `driver_payouts_enabled` bullet and the `driver_minimum_balance` bullet) to read:

```
read live, cached 30s, invalidated immediately on admin update — no deploy needed
```

This is the exact correction the design doc's §05 requires: "Leaving that line unchanged after
implementing this would make the documentation wrong about a safety control."

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/system-config.ts api/src/modules/call-masking/call-masking.service.ts api/src/constants/redis-keys.ts api/src/constants/limits.ts CLAUDE.md
git commit -m "feat(cache): cache system_config with 30s TTL, invalidate on both write paths"
```

---

## Task 5: `cities` — dual-write-path, per-id + list-all keys

**Files:**
- Modify: `api/src/constants/redis-keys.ts` (add `cityByIdKey`, `CITIES_ALL_KEY`)
- Modify: `api/src/constants/limits.ts` (add TTL constant)
- Modify: `api/src/modules/geo/geo.repository.ts:29` (`getCityById`) and `:22` (`getAllCities`)
- Modify: `api/src/modules/geo/geo.repository.ts:164-186` (`createCity`) and `:199-225`
  (`updateCity`)
- Modify: `api/src/modules/admin/admin.repository.ts:967-989` (`createAdminCity`) and `:1033`
  (`updateAdminCity`)

Only `getCityById` and `getAllCities` are wrapped — those are the two keys the design doc's §03
key table actually lists (`ref:v1:city:<cityId>` / `ref:v1:cities:all`). `getActiveCities` and
`getCityBySlug` stay uncached; adding keys for them isn't in the design doc's scope and they're
lower read-volume paths.

- [ ] **Step 1: Add key builders and TTL constant**

`redis-keys.ts`:
```ts
export const CITIES_ALL_KEY = 'ref:v1:cities:all'

export function cityByIdKey(id: number | bigint): string {
  return `ref:v1:city:${id}`
}
```

`limits.ts`:
```ts
export const CITY_CACHE_TTL_SECONDS = 21600 // 6h — structural, changes are rare and deliberate
```

- [ ] **Step 2: Wrap the two reads in `geo.repository.ts`**

Read the current `getCityById` (line 29) and `getAllCities` (line 22) bodies first, then rename
each SQL body to a private `fetchXFromDb` function (moved verbatim, unchanged) and wrap it:

```ts
import { cachedRead, invalidate } from '@/lib/cache/reference-cache'
import { cityByIdKey, CITIES_ALL_KEY } from '@/constants/redis-keys'
import { CITY_CACHE_TTL_SECONDS } from '@/constants/limits'

export async function getCityById(id: bigint) {
  return cachedRead('cities', cityByIdKey(id), CITY_CACHE_TTL_SECONDS, () =>
    fetchCityByIdFromDb(id)
  )
}

async function fetchCityByIdFromDb(id: bigint) {
  // <-- move the existing getCityById query body here unchanged -->
}

export async function getAllCities() {
  return cachedRead('cities', CITIES_ALL_KEY, CITY_CACHE_TTL_SECONDS, fetchAllCitiesFromDb)
}

async function fetchAllCitiesFromDb() {
  // <-- move the existing getAllCities query body here unchanged -->
}
```

- [ ] **Step 3: Invalidate in `geo.repository.ts`'s `createCity` and `updateCity`**

`createCity` (lines 164-186) — after the `INSERT` resolves and the new row's `id` is known:

```ts
  const row = res.rows[0]
  await invalidate(CITIES_ALL_KEY, cityByIdKey(row.id))
  return row
```

`updateCity` (lines 199-225) — after the `UPDATE` resolves (and also on the early-return path at
line 221 that calls `getCityById` when no fields changed — that path reads a cache that is already
correct, no invalidation needed there):

```ts
  const row = res.rows[0]
  await invalidate(CITIES_ALL_KEY, cityByIdKey(id))
  return row
```

- [ ] **Step 4: Invalidate in `admin.repository.ts`'s `createAdminCity` and `updateAdminCity`**

Same two calls, same import, added right after each write resolves — `createAdminCity` (INSERT at
lines 979-989) and `updateAdminCity` (UPDATE at line 1033). This is write-path A for the same
table; skipping it means the admin UI would show a stale city list for up to 6h after its own
edit.

- [ ] **Step 5: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/geo/geo.repository.ts api/src/modules/admin/admin.repository.ts api/src/constants/redis-keys.ts api/src/constants/limits.ts
git commit -m "feat(cache): cache city lookups, invalidate on both admin and geo write paths"
```

---

## Task 6: `vehicle_categories`

**Files:**
- Modify: `api/src/constants/redis-keys.ts` (add `VEHICLE_CATEGORIES_ALL_KEY`)
- Modify: whichever file holds the public-facing "list all vehicle categories" read function
  actually used on the hot pricing/booking path (see Step 1 — this was not resolved during
  research and must be found before writing code)
- Modify: `api/src/modules/admin/admin.repository.ts:607-611` (`createCategory`) and `:622-635`
  (`updateCategory`)

- [ ] **Step 1: Find the public read function**

Only the admin-side `listAdminCategories` (admin.repository.ts:591) was confirmed during
research. The design doc's classification table cites 24 read sites for this table — almost
certainly a customer-facing lookup used during pricing/booking, not the admin list. Before
writing any code, run:

```
grep -rn "FROM vehicle_categories" api/src/modules
```

Identify the function with the highest call-site fan-out (likely in a `vehicles` module). Wrap
**that** function, not `listAdminCategories` — caching only the admin list would miss almost all
the read volume this table classification exists for.

- [ ] **Step 2: Add key builder and confirm TTL constant**

`redis-keys.ts`:
```ts
export const VEHICLE_CATEGORIES_ALL_KEY = 'ref:v1:vehicle_categories:all'
```

Reuse `CITY_CACHE_TTL_SECONDS` (21600s / 6h) from Task 5 — the design doc's §09 TTL table groups
`vehicle_categories` and `cities` under the same 6h "structural" reasoning. Rename that constant
to `STRUCTURAL_CACHE_TTL_SECONDS` in `limits.ts` and update Task 5's `getCityById`/`getAllCities`
call sites to the new name, rather than defining a second constant with an identical value —
DRY.

- [ ] **Step 3: Wrap the read function found in Step 1**

Same extract-and-wrap recipe as Task 5 Step 2: rename the existing query body to a private
`fetchAllVehicleCategoriesFromDb()` (moved verbatim), then:

```ts
import { cachedRead, invalidate } from '@/lib/cache/reference-cache'
import { VEHICLE_CATEGORIES_ALL_KEY } from '@/constants/redis-keys'
import { STRUCTURAL_CACHE_TTL_SECONDS } from '@/constants/limits'

export async function <existingFunctionName>() {
  return cachedRead(
    'vehicle_categories',
    VEHICLE_CATEGORIES_ALL_KEY,
    STRUCTURAL_CACHE_TTL_SECONDS,
    fetchAllVehicleCategoriesFromDb
  )
}
```

- [ ] **Step 4: Invalidate in `admin.repository.ts`'s `createCategory` and `updateCategory`**

After the `INSERT` (line 611) and `UPDATE` (lines 634-635) each resolve:

```ts
await invalidate(VEHICLE_CATEGORIES_ALL_KEY)
```

- [ ] **Step 5: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(cache): cache vehicle category lookups"
```

---

## Task 7: Remaining seed/low-write Tier-1 tables

**Files:**
- Modify: `api/src/constants/redis-keys.ts` (add key builders below)
- Modify: `api/src/constants/limits.ts` (add `NOTIFICATION_TEMPLATE_CACHE_TTL_SECONDS`)
- Modify: `api/src/modules/pricing/pricing.repository.ts:58` (`getRentalPackage`) — has a write
  path
- Modify: `api/src/modules/admin/admin.repository.ts:1289` (`listAdminRentalPackages`), `:1352`
  and `:1370-1380` (rental package writes)
- Modify: `api/src/modules/admin/admin.repository.ts:1744` (`listPackageTiers`), `:1752-1756`
  (`createPackageTier`), `:1778` (package tier update)
- Modify: `api/src/modules/notifications/templates.repository.ts:58` (`getActiveTemplate`), `:91-100`
  (`updateTemplateContent`), `:106-112` (`setTemplateActive`)
- No write path exists for `stop_charges`, `category_fallback_rules`, or
  `rating_tag_definitions` — cache them read-only, no invalidation hook (see Step 4).

Three tables here (`rental_packages`, `package_tiers`, `notification_templates`) have real write
paths and need the same read-wrap-plus-invalidate treatment as prior tasks. Three others
(`stop_charges`, `category_fallback_rules`, `rating_tag_definitions`) are populated only by
migrations — confirmed during research (no `INSERT`/`UPDATE` against them anywhere in
`admin.repository.ts` or the relevant module repositories). Caching those needs no invalidation
hook at all; a long TTL is safe because nothing in the running app can make the cached value
stale.

- [ ] **Step 1: Add key builders**

```ts
export function rentalPackageKey(packageId: number): string {
  return `ref:v1:rental_package:${packageId}`
}
export const PACKAGE_TIERS_ALL_KEY = 'ref:v1:package_tiers:all'
export const STOP_CHARGES_ALL_KEY = 'ref:v1:stop_charges:all'
export const CATEGORY_FALLBACK_ALL_KEY = 'ref:v1:category_fallback:all'
export const RATING_TAGS_ALL_KEY = 'ref:v1:rating_tags:all'
export function notificationTemplateKey(slug: string, channel: string, locale: string): string {
  return `ref:v1:notification_template:${slug}:${channel}:${locale}`
}
```

`limits.ts`:
```ts
export const NOTIFICATION_TEMPLATE_CACHE_TTL_SECONDS = 900 // 15min — edited via admin UI, keep the feedback loop tight
```

Reuse `RATE_CARD_CACHE_TTL_SECONDS` (3600s) for `rental_packages`/`package_tiers` (design doc §09
groups them with rate cards) and `STRUCTURAL_CACHE_TTL_SECONDS` (21600s) for the two seed-only
lookup tables that have discriminator-scoped reads.

- [ ] **Step 2: Wrap `getRentalPackage` in `pricing.repository.ts`**

Read the current body (line 58) first, then apply the same extract-and-wrap recipe:

```ts
import { cachedRead, invalidate } from '@/lib/cache/reference-cache'
import { rentalPackageKey } from '@/constants/redis-keys'
import { RATE_CARD_CACHE_TTL_SECONDS } from '@/constants/limits'

export async function getRentalPackage(packageId: number) {
  return cachedRead(
    'rental_packages',
    rentalPackageKey(packageId),
    RATE_CARD_CACHE_TTL_SECONDS,
    () => fetchRentalPackageFromDb(packageId)
  )
}

async function fetchRentalPackageFromDb(packageId: number) {
  // <-- move the existing getRentalPackage query body here unchanged -->
}
```

Invalidate in `admin.repository.ts`'s rental-package create (line ~1380) and update (line 1352)
functions — after each resolves, call `invalidate(rentalPackageKey(row.id))` with the affected
package's id.

- [ ] **Step 3: Wrap `listPackageTiers` in `admin.repository.ts`**

Same recipe, single list-all key:

```ts
export async function listPackageTiers() {
  return cachedRead('package_tiers', PACKAGE_TIERS_ALL_KEY, RATE_CARD_CACHE_TTL_SECONDS, fetchPackageTiersFromDb)
}

async function fetchPackageTiersFromDb() {
  // <-- move the existing listPackageTiers query body here unchanged -->
}
```

Invalidate with `invalidate(PACKAGE_TIERS_ALL_KEY)` at the end of `createPackageTier` (line 1752)
and the package-tier update function (line 1778).

- [ ] **Step 4: Wrap the three write-less tables read-only, no invalidation**

`stop_charges` (`getStopCharge`, `pricing.repository.ts:50-56`), `category_fallback_rules`
(inline query, `rides.repository.ts:30`), and `rating_tag_definitions` (inline query,
`safety.repository.ts:12`) each get the same extract-and-wrap treatment but with **no**
`invalidate()` call anywhere, since no write path exists to call it from:

```ts
// example: stop_charges
export async function getStopCharge(categoryId: number) {
  return cachedRead(
    'stop_charges',
    stopChargeKey(categoryId),
    STRUCTURAL_CACHE_TTL_SECONDS,
    () => fetchStopChargeFromDb(categoryId)
  )
}

async function fetchStopChargeFromDb(categoryId: number) {
  // <-- move the existing query body here unchanged -->
}
```

Repeat the same shape for the category-fallback and rating-tags inline queries, using
`CATEGORY_FALLBACK_ALL_KEY` / `RATING_TAGS_ALL_KEY` (or a per-`categoryId` key for
category-fallback, matching its current per-id lookup signature).

If one of these tables is ever given an app-level write path in the future, that PR must add the
matching `invalidate()` call at the same time — flag this in the PR description, don't rely on
someone remembering.

- [ ] **Step 5: Wrap `getActiveTemplate` in `templates.repository.ts`**

```ts
export async function getActiveTemplate(slug: string, channel: string, locale = 'en') {
  return cachedRead(
    'notification_templates',
    notificationTemplateKey(slug, channel, locale),
    NOTIFICATION_TEMPLATE_CACHE_TTL_SECONDS,
    () => fetchActiveTemplateFromDb(slug, channel, locale)
  )
}

async function fetchActiveTemplateFromDb(slug: string, channel: string, locale: string) {
  // <-- move the existing getActiveTemplate query body here unchanged -->
}
```

Invalidate in `updateTemplateContent` (lines 91-100) and `setTemplateActive` (lines 106-112) —
both need the template's `slug`/`channel`/`locale` to build the key; if the `UPDATE ... RETURNING`
doesn't already return those columns, add them to the `RETURNING` list so the key can be built
from the result row without a second query:

```ts
await invalidate(notificationTemplateKey(row.slug, row.channel, row.locale))
```

- [ ] **Step 6: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(cache): cache rental packages, package tiers, notification templates, and seed-only lookup tables"
```

---

## Task 8: `surge_events` — gated on measurement, do last

**Files:**
- Modify: `api/src/constants/redis-keys.ts` (add `surgeKey`)
- Modify: `api/src/modules/pricing/pricing.repository.ts:88-103` (`getActiveSurge`)

**Do not start this task until Tasks 1-7 are deployed and `pg_stat_statements` shows
`getActiveSurge`'s query is actually a meaningful share of database load.** The design doc is
explicit that this is the one place in the whole design where a time-bounded cache can introduce
a real billing bug (§06), and offers "don't cache it at all" as a legitimate, lower-risk choice.
It is one indexed query against a small table — leave it uncached unless the load test proves
otherwise.

If measurement justifies it:

- [ ] **Step 1: Add key builder**

```ts
export function surgeKey(cityId: number, categoryId: number): string {
  return `ref:v1:surge:${cityId}:${categoryId}`
}
```

- [ ] **Step 2: Wrap `getActiveSurge` with a boundary-clamped TTL**

Read the current body (lines 88-103) first, then:

```ts
import { cachedRead } from '@/lib/cache/reference-cache'
import { surgeKey } from '@/constants/redis-keys'

const SURGE_BASE_TTL_SECONDS = 300

function secondsUntil(date: Date): number {
  return Math.floor((date.getTime() - Date.now()) / 1000)
}

export async function getActiveSurge(cityId: number, categoryId: number) {
  // Cache only when there's an active row — a naive cache of the "no surge" case
  // must not use SURGE_BASE_TTL_SECONDS or it delays a scheduled surge by up to 5 min.
  const row = await fetchActiveSurgeFromDb(cityId, categoryId)
  if (!row) return null

  const ttl = Math.max(1, Math.min(SURGE_BASE_TTL_SECONDS, secondsUntil(new Date(row.ends_at))))
  return cachedRead('surge_events', surgeKey(cityId, categoryId), ttl, () =>
    fetchActiveSurgeFromDb(cityId, categoryId)
  )
}

async function fetchActiveSurgeFromDb(cityId: number, categoryId: number) {
  // <-- move the existing getActiveSurge query body here unchanged -->
}
```

Note this calls the DB once outside the cache to compute the clamp, then again inside
`cachedRead` on an actual miss — accepted cost, since surge lookups are already agreed to be a
low-volume query; do not "optimize" this into a single call at the expense of the clamping logic
staying correct and readable.

- [ ] **Step 3: Invalidate at both surge write paths**

`admin.repository.ts`'s `createAdminSurgeEvent` (line 1086) / `cancelAdminSurgeEvent` (line 1109),
and `pricing.repository.ts`'s `createSurgeEvent` (line ~122) / `cancelSurgeEvent` (line 141) — all
four need `invalidate(surgeKey(cityId, categoryId))` after they resolve. If `categoryId` is
`null` (applies to all categories), invalidate every currently-cached `categoryId` variant is not
tractable with a plain key — use a namespace-version counter here too, same pattern as Task 3, if
`category_id IS NULL` writes turn out to be common in practice.

- [ ] **Step 4: Commit**

```bash
git add api/src/constants/redis-keys.ts api/src/modules/pricing/pricing.repository.ts api/src/modules/admin/admin.repository.ts
git commit -m "feat(cache): cache active surge lookups with boundary-clamped TTL"
```

---

## Task 9 (optional): Cross-instance lock for the hottest keys

**Files:**
- Create: `api/src/lib/cache/cache-lock.ts`
- Test: `api/src/lib/cache/cache-lock.test.ts`
- Modify: `api/src/modules/pricing/pricing.repository.ts` (`getCurrentRateCard`)
- Modify: `api/src/lib/system-config.ts` (`getConfigValue`)

**Do not build this until Tasks 1-4 are deployed and measurement shows single-flight collapsing
(Task 1-2) is insufficient** — the design doc's own recommendation (§04b) is that single-flight
handles most of the fan-out on its own, and a lock on a key that doesn't need it is pure added
latency. This task exists so the recipe is ready if the load test shows otherwise.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/lib/cache/cache-lock.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSet = vi.fn()
const mockDel = vi.fn()
vi.mock('@/db/redis', () => ({
  client: { set: (...a: unknown[]) => mockSet(...a), del: (...a: unknown[]) => mockDel(...a) },
}))

import { withLock } from './cache-lock'

beforeEach(() => vi.clearAllMocks())

describe('withLock', () => {
  it('runs fn and releases the lock when it acquires the lock', async () => {
    mockSet.mockResolvedValue('OK')
    const fn = vi.fn().mockResolvedValue('winner')
    const retry = vi.fn()

    const result = await withLock('rate_card:1', 5, fn, retry)

    expect(result).toBe('winner')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
    expect(mockDel).toHaveBeenCalledWith('lock:rate_card:1')
  })

  it('releases the lock even when fn throws', async () => {
    mockSet.mockResolvedValue('OK')
    const fn = vi.fn().mockRejectedValue(new Error('boom'))

    await expect(withLock('rate_card:1', 5, fn, vi.fn())).rejects.toThrow('boom')
    expect(mockDel).toHaveBeenCalledWith('lock:rate_card:1')
  })

  it('calls retry instead of fn when the lock is already held', async () => {
    mockSet.mockResolvedValue(null)
    const fn = vi.fn()
    const retry = vi.fn().mockResolvedValue('from-cache')

    const result = await withLock('rate_card:1', 5, fn, retry)

    expect(result).toBe('from-cache')
    expect(fn).not.toHaveBeenCalled()
  })

  it('acquires the lock atomically with SET NX EX, never separate commands', async () => {
    mockSet.mockResolvedValue('OK')
    await withLock('rate_card:1', 5, vi.fn().mockResolvedValue('x'), vi.fn())

    expect(mockSet).toHaveBeenCalledWith('lock:rate_card:1', '1', 'EX', 5, 'NX')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/lib/cache/cache-lock.test.ts`
Expected: FAIL — `Cannot find module './cache-lock'`

- [ ] **Step 3: Write the implementation**

```ts
// api/src/lib/cache/cache-lock.ts
import { client as redisClient } from '@/db/redis'

/**
 * Fleet-wide lock: the loser waits briefly and calls `retry` (expected to be
 * the same cachedRead call again, which will now find the winner's value in
 * cache) instead of also hitting the database.
 */
export async function withLock<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  retry: () => Promise<T>
): Promise<T> {
  const lockKey = `lock:${key}`
  const acquired = await redisClient.set(lockKey, '1', 'EX', ttlSeconds, 'NX')

  if (!acquired) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return retry()
  }

  try {
    return await fn()
  } finally {
    await redisClient.del(lockKey)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/lib/cache/cache-lock.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire it into `getCurrentRateCard`'s fetch, using retry-into-cachedRead**

Modify the Task 3 implementation of `getCurrentRateCard` (`pricing.repository.ts`) so the DB fetch
on a miss goes through `withLock`, retrying the whole cached call (which will hit cache once the
winner populates it) instead of hitting the DB again:

```ts
export async function getCurrentRateCard(
  categoryId: number,
  rideType: string,
  cityId: number | null
) {
  const version = (await redisClient.get(RATE_CARD_VERSION_KEY)) ?? '0'
  const key = rateCardKey(version, categoryId, rideType, cityId)
  return cachedRead('rate_cards', key, RATE_CARD_CACHE_TTL_SECONDS, () =>
    withLock(
      key,
      5,
      () => fetchCurrentRateCardFromDb(categoryId, rideType, cityId),
      () => getCurrentRateCard(categoryId, rideType, cityId)
    )
  )
}
```

Apply the identical pattern to `getConfigValue` in `system-config.ts`.

- [ ] **Step 6: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/cache/cache-lock.ts api/src/lib/cache/cache-lock.test.ts api/src/modules/pricing/pricing.repository.ts api/src/lib/system-config.ts
git commit -m "feat(cache): add cross-instance lock for the hottest reference-cache keys"
```

---

## Task 10: Verification and dashboard wiring

**Files:**
- No new source files — this task is measurement and documentation only.

- [ ] **Step 1: Confirm `pg_stat_statements` is capturing the affected queries**

`infra/terraform/rds.tf` already references `pg_stat_statements` (lines ~83-103). Before/after
comparison of call counts for `getCurrentRateCard`, `getConfigValue`, `getCityById`, and
`getAllCities`'s underlying SQL is the measurement that proves this work was worth doing — per
§10 of the design doc. Run:

```sql
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
WHERE query ILIKE '%rate_cards%' OR query ILIKE '%system_config%' OR query ILIKE '%FROM cities%'
ORDER BY calls DESC;
```

Capture this once before Task 3 is deployed and once ~24h after, to show the drop.

- [ ] **Step 2: Add a Grafana panel for `cache_hits_total` / `cache_misses_total`**

These two counters were added to `/metrics` in Task 2. Add a panel to the `ocar-overview` Grafana
dashboard showing hit-rate per `table` label:
`sum(rate(cache_hits_total[5m])) by (table) / (sum(rate(cache_hits_total[5m])) by (table) + sum(rate(cache_misses_total[5m])) by (table))`.
Per the design doc: **a hit rate that is high but a stale-value complaint is the signal a
missed-invalidation path exists** — this pairing is worth an alert, not just a chart, once
baseline hit rates are known.

- [ ] **Step 3: Manual dual-write-path regression check**

For every table with two write paths (`rate_cards`, `cities`, `surge_events` if Task 8 was done,
`system_config`), edit through **each** path in turn and confirm the read-side reflects the change
immediately, not after the TTL. This is the exact test the design doc's §10 verification section
calls for, and it is the one that would have caught a fix applied to only one write path. Task 3
Step 7 already covers `rate_cards`; repeat the same shape for `cities` (edit via
`admin.repository.ts`'s path, confirm `getCityById`/`getAllCities` update immediately; edit via
`geo.repository.ts`'s path, confirm the same) and for `system_config` (flip
`exotel_masking_enabled` via `checkDailySpend`'s bypass path — the trickiest one, since it's not
even routed through `updateConfigValue`).

- [ ] **Step 4: No commit — this task only produces measurement output and dashboard config,
  which lives in Grafana, not git.**
