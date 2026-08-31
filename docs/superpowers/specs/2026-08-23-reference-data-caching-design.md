# Reference-Data Caching Strategy — Design

**Date:** 2026-08-23
**Status:** IMPLEMENTED (2026-08-24) — see `api/src/lib/cache/reference-cache.ts`,
`single-flight.ts`, and the `invalidate()` call sites across the pricing/admin/geo/
notifications/safety/rides repositories. This document is the design of record; the
shipped code follows it with one deliberate deviation (§04b cross-instance lock was
not implemented — see the note in that section).
**Scope:** Which tables to cache, with what strategy, how invalidation is wired, and how
cache stampedes are prevented.

---

## 00. Current state

Only two things in the entire API are cached in Redis today:

| What | Where | TTL |
|---|---|---|
| Auth principal lookup (user/driver/admin status check) | `middleware/auth.middleware.ts` | 20 s |
| Google Routes API responses | `modules/geo/geo.service.ts` | `ROUTE_CACHE_TTL_SECONDS` |

**Every reference-data read goes to Postgres on every request.** `getCurrentRateCard`,
`getStopCharge`, `getActiveSurge`, `getRentalPackage`, city lookups and vehicle-category lookups
are all uncached. A single `POST /api/v1/pricing/estimate` currently issues **four** separate
Postgres round trips (rate card, stop charge, surge, rental package) for data that changes
roughly monthly.

This has not been a bottleneck at current volume. It becomes one under the campaign load profile
(5–6k concurrent, per `docs/architecture/2026-08-04-production-scale-readiness-report.md`),
because §5 of that report identifies the **Neon/RDS connection pool** as one of the two resources
expected to saturate first. Reference-data reads are the cheapest possible thing to remove from
that pool.

---

## 01. Classification

Tables are classified by **mutation frequency**, **read volume**, and **consequence of serving a
stale value** — the last is the one that decides strategy, not the first two.

### Tier 1 — Reference data (cache aggressively)

Changes only through a deliberate admin action. Read constantly. Stale value is a correctness
problem, so every write path must invalidate.

| Table | Read sites | Write sites | Stale-value consequence |
|---|---|---|---|
| `rate_cards` | 8 | 4 | **Wrong fare quoted.** Revenue or trust loss. |
| `cities` | 30 | 4 | Wrong billing mode, wrong geofence. |
| `vehicle_categories` | 24 | 2 | Wrong category shown/priced. |
| `rental_packages` | 5 | 3 | Wrong package price. |
| `vehicle_brands` | 6 | 2 | Cosmetic — stale dropdown. |
| `vehicle_models` | 4 | 2 | Cosmetic — stale dropdown. |
| `package_tiers` | 3 | 2 | Wrong driver package price. |
| `notification_templates` | 3 | 2 | Old SMS/push copy sent. |
| `stop_charges` | 1 | 0 | Wrong multi-stop fee. Seed-only today. |
| `category_fallback_rules` | 1 | 0 | Wrong driver-matching eligibility. Seed-only today. |
| `rating_tag_definitions` | 3 | 0 | Stale rating tag list. Seed-only today. |

### Tier 2 — Operational config (short TTL, invalidate on write)

`system_config` is read on genuinely hot paths and changes rarely — but it holds **kill
switches**, which makes TTL selection a safety decision rather than a performance one. See §05.

### Tier 3 — Time-bounded (special handling, do not cache naively)

`surge_events`. The query is `starts_at <= now() AND ends_at > now()`. **The correct answer
changes with the clock, not only with writes.** A naive TTL cache will keep serving a surge after
it has ended, or fail to serve one that has just begun. See §06.

### Do not cache

Everything transactional: `rides`, `payments`, `driver_wallets`, `driver_sessions`,
`driver_location_snapshots`, ledgers, `settlements`, `ratings`, `disputes`. These are
read-your-own-write, per-entity, and low fan-out. Caching them buys nothing and risks serving a
stale balance or ride status — the highest-consequence staleness in the system.

---

## 02. Strategy: cache-aside with delete-on-write

**Decision: cache-aside, invalidated by `DEL` on write. Not write-through.**

This reverses an earlier verbal recommendation of write-through, and the reason matters.

Write-through (updating the cache with the new value in the same operation as the DB write) has an
appealing property: no miss window at all. But it introduces a **stale-set race** that
delete-on-write does not have:

```
Writer A: UPDATE rate_card -> value A     (commits first)
Writer B: UPDATE rate_card -> value B     (commits second)
DB final state: B                          ✓

Writer B: SET cache = B                    (network reorders)
Writer A: SET cache = A                    (arrives last)
Cache final state: A                       ✗ — permanently wrong until TTL
```

The cache now disagrees with the database indefinitely. With `DEL`, both writers delete, and the
next read repopulates from the database — which is authoritative — so the outcome is correct
regardless of ordering.

The cost of choosing `DEL` is a miss window of roughly **1–3 ms**, paid by **one** request (§04
collapses the rest). That is the correct trade: a few milliseconds once a month, against a class
of bug that silently prices rides wrong until someone notices.

### Ordering rule — non-negotiable

```
1. BEGIN
2. write to Postgres
3. COMMIT          ← must complete first
4. DEL cache key   ← only after commit
```

Invalidating **before** commit opens a window where a concurrent read re-populates the cache with
the *old* committed value, and that value then persists for the full TTL. This is the single most
common way a correct-looking invalidation still serves stale data.

---

## 03. Key schema

```
ref:v1:<table>:<discriminator>
```

- `ref:` namespace keeps reference data separable from `ride:*`, `auth:*`, `geo:*`.
- `v1` is a **schema version**. Bumping it in code invalidates every reference key at once
  without touching Redis — the deploy-time escape hatch when a cached shape changes.

| Key | Populated by |
|---|---|
| `ref:v1:rate_card:<categoryId>:<rideType>:<cityId\|global>` | `getCurrentRateCard` |
| `ref:v1:stop_charge:<categoryId>` | `getStopCharge` |
| `ref:v1:rental_package:<packageId>` | `getRentalPackage` |
| `ref:v1:rental_packages:<categoryId>:<cityId\|global>` | `getRentalPackagesByCategory` |
| `ref:v1:city:<cityId>` / `ref:v1:cities:all` | city lookups |
| `ref:v1:vehicle_categories:all` | category list |
| `ref:v1:category_fallback:<categoryId>` | `getEligibleDriverCategoryIds` |
| `ref:v1:config:<key>` | `getConfigValue` |

**Invalidation is by exact key, never by `KEYS` or `SCAN` pattern matching.** `KEYS` is O(N) and
blocks the Redis event loop; on a shared single-node Valkey that stalls every instance
simultaneously. Where one write must clear several keys — a rate-card edit affecting both a
city-specific and the global row — the write path deletes the specific known keys, or bumps a
namespace version (§07).

---

## 04. Stampede prevention

The real risk is not invalidation duration. It is **concurrency at the moment of the miss**: if a
hot key is invalidated at peak and 500 requests miss in the same millisecond, all 500 query
Postgres simultaneously. With 2–4 instances each holding a pool, that is exactly the connection-pool
exhaustion the readiness report warns about — the cache layer amplifying an outage instead of
preventing one.

Current consensus is to layer two mechanisms rather than choose one:

### (a) In-process single-flight

Collapses concurrent misses **within one Node process** to a single database query. Cheap, no
network hop, and handles the majority of the fan-out because each instance only needs one fetch.

```ts
// lib/cache/single-flight.ts
const inflight = new Map<string, Promise<unknown>>()

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
```

### (b) Cross-instance lock

With 2–4 instances, in-process collapsing still permits one query per instance. For genuinely hot
keys a short Redis lock reduces that to one query fleet-wide; the losers briefly wait and re-read.

```ts
// atomic — SET ... NX EX, never separate SETNX + EXPIRE (that can leak a
// permanent lock if the process dies between the two commands)
const got = await client.set(`lock:${key}`, '1', 'EX', 5, 'NX')
```

**Recommendation:** implement (a) for every cached read immediately — it is ~15 lines and removes
most of the risk. Add (b) only for `rate_card` and `config` keys, which are the hottest. Do not
add (b) everywhere; a lock on a cold key is pure latency.

### (c) TTL jitter

Every TTL gets ±10% randomness. Without it, keys populated together — for example, at instance
boot or after a deploy — expire together, producing a synchronised cliff. Jitter is one line and
prevents a self-inflicted stampede that has nothing to do with any admin action.

```ts
const jitter = (base: number) => Math.floor(base * (0.9 + Math.random() * 0.2))
```

---

## 05. `system_config` — TTL is a safety decision

`getConfigValue` is called on hot paths:

| Key | Called from | Path heat |
|---|---|---|
| `driver_minimum_balance` | `goOnline`, broadcast driver filtering, `/return-cab-available` | **Hot** — per broadcast, per driver |
| `commission_percent` | ride completion | Per ride |
| `cash_collection_enabled`, `cash_collection_tolerance` | `collectCash` | Per ride |
| `driver_payouts_enabled` | settlements, instant payout | Per payout |
| `exotel_*` | call masking | Per call |

`CLAUDE.md` currently documents two of these as *"read live on every request. No deploy needed."*
Both are **kill switches**: `driver_payouts_enabled` gates real money movement, and
`driver_minimum_balance` is currently set to `-999999` to disable a gate during client testing.

Caching them weakens that guarantee. The resolution:

- **TTL 30 s** (jittered) — bounds worst-case staleness if invalidation is ever missed.
- **Explicit `DEL` in `updateConfigValue()`** — makes a deliberate flip effectively immediate
  (single-digit ms), not 30 s.
- **`CLAUDE.md` must be updated** to say "read live, cached 30 s, invalidated immediately on
  admin update" rather than "read live on every request". Leaving that line unchanged after
  implementing this would make the documentation wrong about a safety control.

Note `call-masking.service.ts:107` writes `system_config` directly with raw SQL, bypassing
`updateConfigValue()`. That write path must invalidate too — see §08.

---

## 06. `surge_events` — bound the TTL to the event boundary

The active-surge query depends on `now()`. Two distinct staleness modes exist, and only one is
fixed by invalidating on write:

| Mode | Cause | Fixed by invalidation? |
|---|---|---|
| Admin creates/edits a surge | A write | Yes |
| A surge starts or ends | The clock | **No** |

A fixed 10-minute TTL would keep applying a surge multiplier for up to 10 minutes after it ended —
overcharging real customers — and would delay a scheduled surge by up to 10 minutes.

**Strategy: cache, but clamp the TTL to the next boundary.**

```ts
// On a hit: TTL = min(baseTtl, seconds until this surge's ends_at)
// On a miss with no active surge: cache the negative result only until the
//   next scheduled starts_at, so a surge beginning in 90 s is not masked
//   for the full base TTL.
const ttl = Math.max(1, Math.min(baseTtl, secondsUntil(row.ends_at)))
```

The negative-result case matters as much as the positive one. Caching "no surge" for a flat 5
minutes means a surge scheduled to begin at 18:00 does not take effect until 18:05.

**Simpler alternative, and a legitimate choice:** do not cache surge at all. It is one indexed
query, `surge_events` is small, and time-dependent caching is the single easiest place in this
design to introduce a subtle billing bug. If the load test shows surge lookups are not a
meaningful share of database load, leaving them uncached is the lower-risk option. Decide from
measurement, not assumption.

---

## 07. Where invalidation hooks go — and the trap

**Four Tier-1 tables have write paths in two different modules:**

| Table | Write path A | Write path B |
|---|---|---|
| `rate_cards` | `modules/admin/admin.repository.ts:1527,1554` | `modules/pricing/pricing.repository.ts:174,200` |
| `cities` | `modules/admin/admin.repository.ts:979,1033` | `modules/geo/geo.repository.ts:176,225` |
| `surge_events` | `modules/admin/admin.repository.ts:1096,1111` | `modules/pricing/pricing.repository.ts:128,143` |
| `system_config` | `lib/system-config.ts:79` | `modules/call-masking/call-masking.service.ts:107` |

This is the highest-risk part of the whole design. **Adding invalidation to the admin path only
means the pricing path silently continues serving stale prices** — and it would pass every manual
test performed through the admin UI, because that is the path that *was* fixed.

**Rule: invalidation belongs in the repository function that performs the write, never in the
service or controller above it.** A future third write path then inherits it automatically.

Where a single write invalidates several derived keys, use a **namespace version counter** rather
than pattern deletion:

```ts
// bump once; every key built from this version is orphaned instantly
await client.incr('ref:v1:rate_card:ver')
// reads build: ref:v1:rate_card:<ver>:<categoryId>:<rideType>:<cityId>
```

Orphaned keys expire naturally by TTL. This is O(1), avoids `KEYS`/`SCAN` entirely, and is the
correct tool for "an edit to the global rate card affects every city's resolved value".

---

## 08. Correctness rules

1. **Commit before invalidate.** Always. §02.
2. **Delete, never set, on the write path.** §02.
3. **Invalidate in the repository, not the service.** §07.
4. **A cache miss is not an error.** Every read must fall through to Postgres if Redis is
   unavailable. Valkey is a single node with no replica (`G-10`) — a cache outage must degrade
   latency, never availability. Wrap reads in try/catch and treat a Redis error as a miss.
5. **Never cache anything derived from `now()` without clamping the TTL to the boundary.** §06.
6. **Never `KEYS` or unbounded `SCAN` in a request path.** §03.
7. **No in-process memoisation of reference data.** With 2–4 instances, an in-memory cache cannot
   be invalidated across the fleet — instance A would serve the new price while B, C and D serve
   the old one. Shared Valkey is what makes invalidation atomic fleet-wide. In-process
   single-flight (§04a) is fine because it holds a value only for the duration of one in-flight
   query, not across requests.
8. **Cache negative results deliberately, with a short TTL.** Otherwise a lookup for a
   non-existent rate card queries Postgres on every request — a trivially exploitable
   cache-penetration path.

---

## 09. Proposed TTLs

TTL is the **backstop for a missed invalidation**, not the primary correctness mechanism. Values
are chosen by consequence-of-staleness, not by how often the data changes.

| Key group | TTL | Reasoning |
|---|---|---|
| `vehicle_brands`, `vehicle_models` | 24 h | Cosmetic. Near-zero consequence. |
| `vehicle_categories`, `cities` | 6 h | Structural; changes are rare and deliberate. |
| `rate_cards`, `rental_packages`, `stop_charges`, `package_tiers` | 1 h | Money. Short enough that a missed invalidation is contained. |
| `category_fallback_rules`, `rating_tag_definitions` | 6 h | Seed-only today. |
| `notification_templates` | 15 min | Edited through an admin UI; a short TTL keeps the feedback loop tight. |
| `system_config` | 30 s | Kill switches. §05. |
| `surge_events` | ≤ 5 min, clamped to boundary | §06. |
| Negative results | 30 s | Penetration guard. |

All jittered ±10% (§04c).

---

## 10. Rollout

Ordered by value-per-unit-risk.

1. **`lib/cache/reference-cache.ts`** — `cachedRead(key, ttl, fetchFn)` wrapping get → miss →
   single-flight → fetch → set-with-jittered-TTL, plus `invalidate(...keys)`. All Redis errors
   swallowed and treated as a miss (rule 4). One place to get right; every call site inherits it.
2. **Unit tests for the helper before any call site uses it** — hit, miss, Redis-down,
   concurrent-miss collapsing, negative caching, TTL jitter bounds. This is also the first real
   test coverage for a shared infrastructure component (see gap `G-13`).
3. **`rate_cards`** — highest read volume among money-affecting tables, and the one the client
   asked about. Both write paths (§07).
4. **`system_config`** — hottest call sites; must land with the `CLAUDE.md` correction (§05).
5. **`cities`, `vehicle_categories`** — highest raw read counts (30 and 24).
6. **`rental_packages`, `stop_charges`, `package_tiers`, `category_fallback_rules`,
   `rating_tag_definitions`, `notification_templates`.**
7. **`surge_events`** — last, and only if measurement justifies it. §06.

### Verification

- `pg_stat_statements` before and after (enabled per `rds.tf`) — these queries should fall sharply
  in call count. That is the measurement that proves the work was worth doing.
- A `cache_hits_total` / `cache_misses_total` counter per key group via `prom-client`, added to the
  `ocar-overview` dashboard. **A hit rate that is high but a stale-value complaint means a missed
  invalidation path** — that pairing is the signal worth alerting on.
- Explicit test: edit a rate card through **each** write path in turn and assert the fare estimate
  changes immediately. This is the test that catches §07's trap.

---

## 11. What this does not do

- It does not reduce write latency; it is a read-path optimisation only.
- It does not remove the need for the load test. Cache hit rates under real concurrency are a
  measurement, not a prediction.
- It does not make Valkey redundant — it increases dependence on it. Rule 4 (fail open to
  Postgres) is what keeps a cache outage from becoming a service outage, and it is the single most
  important rule in this document to implement correctly.
