
# Load-Test Hardening — Spike, Soak, Query-Plan Regression, Mixed Read/Write, and First-Run Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended for this plan — several steps produce operational scripts that should be dry-run-reviewed before a live session) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Path:** `docs/superpowers/plans/2026-08-19-load-test-hardening.md`
- **Goal:** Close the four coverage gaps the existing load-test suite documents but does not yet exercise — spike/instant-scale, soak/endurance, automated query-plan regression, and concurrent admin-read-during-write — and provide the first-real-staging-execution runbook the suite has never had run against it.
- **Architecture:** Extend the existing, well-built k6 + seed + verify suite in place. Reuse its conventions: the `BBSR`/`CTC` corridor constants, `MAX_DRIVERS`/`MAX_RIDERS`/`BOOKING_RATE`/`HOLD_DURATION` env vars, the `rampStages()` shape, the hand-rolled `lib/socketio.js` client, and the `tokens.json` token pool. New k6 scenarios use k6 thresholds as CI/deploy gates (a breached threshold exits non-zero). The query-regression check follows `verify/reconcile.js`'s shape (pg `Client`, `DATABASE_URL` env, `process.exit(1)` on violation) and approximates p95 as `mean + 1.6449·stddev` from `pg_stat_statements` (true percentiles aren't stored — pgMustard).
- **Tech Stack:** k6 (spike/soak/mixed scenarios), Node + `pg` (already in `load-tests/package.json`) for the query-regression script, `pg_stat_statements` (a documented staging prerequisite, README §2.4).

> Depends on Plan A Task 0 being merged (the accept-race threshold is now a regression guard). No other Plan A dependency.

---

## Task 1 — Spike test (instant 0→N), new file `load-tests/k6/spike.js`

The existing `main.js` only does 5-minute ramps — it never tests ASG *reaction time* to a sudden surge or the system's *recovery* after it. Spike testing (Grafana k6) recreates a sudden massive traffic jump and measures recovery. New file (not a `main.js` mode) because its executor shape, thresholds (looser latency during the spike), and recovery tail are fundamentally different from the steady ramp.

### Step 1.1 — Create `load-tests/k6/spike.js`

```javascript
// load-tests/k6/spike.js
//
// SPIKE test — the gap main.js's 5-minute ramps don't cover: an instant 0->N
// surge, to measure ASG reaction time and post-spike RECOVERY (does latency
// return to baseline once the spike passes, or does the system stay degraded).
// Spike testing per Grafana k6's own guidance is about recovery, not sustained
// capacity — that's what main.js's soak-shaped ramps already prove.
//
// Two scenarios, fired together:
//   booking_spike  HTTP, ramping-arrival-rate — jumps 0 -> SPIKE_RATE/min in
//                  10s, holds 2m, drops to a low baseline and holds 3m so you
//                  can watch recovery (latency should fall back, not stay high).
//   rider_spike    Socket.io, ramping-vus — jumps 0 -> SPIKE_RIDERS in 10s
//                  (a connection storm — the harder thing for Redis pub/sub
//                  fan-out + the ALB to absorb), holds 2m, drops.
//
// Thresholds are deliberately LOOSER on latency than main.js (p95<1500 vs 500):
// a spike is allowed to hurt briefly; what must hold is that it does not error
// out (http_req_failed) or fail to accept connections, and that it recovers.
//
// PREREQUISITES — same as main.js (see ../README.md): staging up, tokens.json
// seeded, smoke.js green. Run this AFTER a clean main.js step, not as the first
// thing against staging. Start with a small SPIKE_RATE/SPIKE_RIDERS and step up.
//
// Usage:
//   BASE_URL=https://staging.ocar.example.com \
//   WS_URL=wss://staging.ocar.example.com \
//   CATEGORY_ID=1 CITY_ID=1 \
//   SPIKE_RATE=300 SPIKE_RIDERS=2000 \
//   k6 run spike.js

import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Counter } from 'k6/metrics'
import { connect as sioConnect } from './lib/socketio.js'

const tokens = JSON.parse(open('./tokens.json'))

const BASE_URL = __ENV.BASE_URL || 'https://staging.ocar.example.com'
const WS_URL = (__ENV.WS_URL || BASE_URL.replace(/^http/, 'ws')) + '/socket.io/?EIO=4&transport=websocket'
const CATEGORY_ID = __ENV.CATEGORY_ID || '1'
const CITY_ID = __ENV.CITY_ID || '1'

const SPIKE_RATE = Number(__ENV.SPIKE_RATE || 300)     // bookings/min at the peak of the spike
const SPIKE_RIDERS = Number(__ENV.SPIKE_RIDERS || 2000) // concurrent sockets slammed on in 10s

// Same Bhubaneswar <-> Cuttack corridor as main.js — not arbitrary coordinates.
const BBSR = { lat: 20.2961, lng: 85.8245 }
const CTC = { lat: 20.4625, lng: 85.8830 }

const socketConnectFailures = new Counter('socket_connect_failures')
const bookingFailures = new Counter('booking_failures')

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
}
function randOf(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function jitter(base, spread) { return base + (Math.random() - 0.5) * spread }

export const options = {
  scenarios: {
    booking_spike: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1m',
      startRate: 0,
      preAllocatedVUs: 50,
      maxVUs: 300,
      exec: 'bookingFlow',
      stages: [
        { duration: '10s', target: SPIKE_RATE }, // instant surge
        { duration: '2m',  target: SPIKE_RATE }, // hold the peak
        { duration: '10s', target: 10 },         // drop hard
        { duration: '3m',  target: 10 },          // recovery observation window
      ],
    },
    rider_spike: {
      executor: 'ramping-vus',
      exec: 'riderIdleWatch',
      startVUs: 0,
      stages: [
        { duration: '10s', target: SPIKE_RIDERS }, // connection storm
        { duration: '2m',  target: SPIKE_RIDERS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // Looser than main.js on purpose — a spike may hurt latency briefly. What
    // must hold: it doesn't error out and it accepts the connection storm.
    http_req_duration: ['p(95)<1500'],
    http_req_failed: ['rate<0.05'],
    socket_connect_failures: ['count<100'],
  },
}

export function bookingFlow() {
  const user = randOf(tokens.users)
  const opts = authHeaders(user.token)
  group('booking_spike', function () {
    const distanceKm = 28
    const estimateRes = http.post(
      `${BASE_URL}/api/v1/pricing/estimate`,
      JSON.stringify({
        category_id: Number(CATEGORY_ID),
        ride_type: 'one_way',
        distance_km: distanceKm,
        duration_min: 45,
        city_id: Number(CITY_ID),
      }),
      opts
    )
    if (!check(estimateRes, { 'spike: estimate 200': (r) => r.status === 200 })) {
      bookingFailures.add(1); return
    }
    const bookRes = http.post(
      `${BASE_URL}/api/v1/rides`,
      JSON.stringify({
        categoryId: Number(CATEGORY_ID),
        rideType: 'one_way',
        originLat: jitter(BBSR.lat, 0.02),
        originLng: jitter(BBSR.lng, 0.02),
        originAddress: 'Spike test pickup',
        destinationLat: jitter(CTC.lat, 0.02),
        destinationLng: jitter(CTC.lng, 0.02),
        destinationAddress: 'Spike test drop',
        originCityId: Number(CITY_ID),
        distanceKm,
        durationMin: 45,
        paymentChannel: 'cash',
      }),
      opts
    )
    if (!check(bookRes, { 'spike: create booking 201': (r) => r.status === 201 })) {
      bookingFailures.add(1); return
    }
    // Cancel so a spike doesn't leave thousands of unmatched 'requested' rides.
    const rideId = bookRes.json('id')
    http.post(
      `${BASE_URL}/api/v1/rides/${rideId}/cancel`,
      JSON.stringify({ reasonCode: 'load_test', reason: 'spike cleanup' }),
      opts
    )
  })
}

export function riderIdleWatch() {
  const user = randOf(tokens.users)
  sioConnect(
    WS_URL,
    user.token,
    function (conn) {
      // Hold ~2.5m so the connection survives the peak-hold stage, then close.
      conn.raw.setTimeout(function () { conn.close() }, 150000)
    },
    function (err) {
      socketConnectFailures.add(1)
      console.error('spike rider socket error: ' + err)
    }
  )
}
```

### Step 1.2 — Dry-run the spike at tiny scale before trusting it

```
cd load-tests/k6
BASE_URL=... WS_URL=... CATEGORY_ID=<real> CITY_ID=<real> \
SPIKE_RATE=20 SPIKE_RIDERS=50 \
k6 run spike.js
```
Expected: green thresholds, and the k6 summary shows a latency bump during the 2m peak that falls back during the 3m recovery window. Only then run at real `SPIKE_RATE`/`SPIKE_RIDERS`, stepping up per README §4's philosophy.

**Acceptance:** `spike.js` runs clean at tiny scale; thresholds present and evaluated.

---

## Task 2 — Soak / endurance run (no new file — `HOLD_DURATION` preset on `main.js`)

**Decision + justification:** `main.js`'s `rampStages()` already parameterizes the hold via `HOLD_DURATION`, and its scenarios already hold idle sockets + a steady booking rate — which is exactly a soak profile. A whole new file would duplicate `main.js` almost verbatim just to change one duration string; that's the kind of copy that rots out of sync. A soak is therefore a *documented invocation* of `main.js` with a multi-hour `HOLD_DURATION`, plus a small guard so the socket hold-timeout tracks it. Grafana k6: soak/endurance tests catch slow-growing issues (memory leaks, connection/handle exhaustion) via a moderate load held for hours.

### Step 2.1 — Verify `main.js`'s socket hold already tracks `HOLD_DURATION`

Confirm (read only) that in `load-tests/k6/main.js`, `driverGpsPing` and `riderIdleWatch` set their `conn.raw.setTimeout(...)` to `durationToMs(__ENV.HOLD_DURATION || '15m')` (they do — lines ~262 and ~289). This means a `HOLD_DURATION=4h` run keeps sockets open for the full soak with no code change. No edit needed; this step is the confirmation the decision rests on.

### Step 2.2 — Add a "Soak / endurance run" subsection to `load-tests/README.md`

Insert immediately after §4 (the ramp plan), before §5:

```markdown
### 4a. Soak / endurance run (catching leaks, not capacity)

§4 proves the system survives the target *concurrency*. It does not prove it
survives *time* — the max run above is ~40 min, too short to surface a slow
connection leak, a Redis client that never gets released, or heap growth on the
Node instances. A soak run is the same `main.js`, held for hours at a MODERATE
load (not the peak — you're watching for drift over time, not a ceiling):

```bash
BASE_URL=... WS_URL=... CATEGORY_ID=<real> CITY_ID=<real> \
MAX_DRIVERS=150 MAX_RIDERS=2000 BOOKING_RATE=10 \
HOLD_DURATION=4h BOOKING_DURATION=4h30m \
k6 run main.js
```

`HOLD_DURATION` drives both the socket-hold timeout and the ramp's hold stage,
so no code change is needed. Set `BOOKING_DURATION` a little longer than
`HOLD_DURATION` so the booking scenario doesn't stop before the sockets do.

**What you're watching (over the whole window, per §5):** the trend lines, not
the absolute numbers — Neon pooled-connection count (must be flat, not creeping),
Redis connected-clients (must return to baseline as VUs cycle, not accumulate),
per-instance memory / heap on the cAdvisor panel (flat, not a staircase), and
`t3.medium` `CPUCreditBalance` (should reach steady state, not drain to zero over
hours). A metric that trends up-and-to-the-right over a 4h hold with steady load
is a leak — that's the entire point of running it long. Cross-reference against
§6's triage buckets and clean up synthetic rows per §6.4 afterward.
```

**Acceptance:** README has a soak subsection referencing the existing env vars; no `main.js` code change required.

---

## Task 3 — Automated query-plan regression check, new file `load-tests/verify/query-regression.js`

README §7 currently leaves query-plan checking as a *manual* `EXPLAIN ANALYZE` step after bulk-seeding. Automate it: snapshot `pg_stat_statements` for named critical queries, then after a run (or after the bulk-seed) compare and fail if approximate p95 regresses past a tolerance. True p95 isn't stored by `pg_stat_statements`, so approximate it as `mean_exec_time + 1.6449·stddev_exec_time` (one-sided 95%; pgMustard).

### Step 3.1 — Create `load-tests/verify/query-regression.js`

```javascript
// load-tests/verify/query-regression.js
//
// Automated query-plan / latency regression gate — the thing README §7 leaves
// as a manual EXPLAIN ANALYZE step. Snapshots pg_stat_statements for a set of
// NAMED critical queries, then compares a later snapshot and fails if their
// approximate p95 latency regressed past a tolerance. This is what turns
// "seed 1M rides, then eyeball EXPLAIN" into a pass/fail check you can gate on.
//
// pg_stat_statements does NOT store true percentiles, so p95 is approximated as
// mean_exec_time + 1.6449 * stddev_exec_time (one-sided 95%). It's statistically
// rough but practically useful for catching a plan flip (seq scan creeping in,
// an index stopping being used) that moves mean+stddev sharply — exactly the
// regression class §7 cares about after data volume grows.
//
// Requires pg_stat_statements enabled (README §2.4 — already a documented
// staging prerequisite) and the pg dependency (load-tests/package.json, same as
// reconcile.js). Read-only except for the optional --reset.
//
// Usage:
//   # 1. before the run/seed, reset stats to get a clean window:
//   DATABASE_URL=<staging> node verify/query-regression.js --reset
//   # 2. capture the baseline (after a warm-up run at current data volume):
//   DATABASE_URL=<staging> node verify/query-regression.js --mode baseline --out baseline.json
//   # 3. after the change (e.g. after generate-bulk-ride-history.js), check:
//   DATABASE_URL=<staging> node verify/query-regression.js --mode check \
//     --baseline baseline.json --tolerance 0.2 --abs-p95-ms 500
//
// Exits 1 if any named query's p95 regressed past BOTH the relative tolerance
// and the absolute ceiling, so it can gate a "this passed" decision.

const fs = require('fs')
const { Client } = require('pg')

// The critical queries §7 names, matched by a stable substring of the
// normalized query text in pg_stat_statements. Keep these fragments specific
// enough to match one statement family and nothing else. If a match is missing
// after a run, the workload never exercised it — the check reports that, it is
// not silently ignored.
const CRITICAL_QUERIES = [
  { name: 'rides_list_admin',      match: 'FROM rides r%ORDER BY%LIMIT' },
  { name: 'driver_ride_history',   match: 'FROM rides%WHERE%driver_id%ORDER BY' },
  { name: 'live_map_bbox',         match: 'ST_MakePoint%ST_DWithin' },
  { name: 'ride_creation_insert',  match: 'INSERT INTO rides%' },
]

const Z_95 = 1.6449

function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
function hasFlag(flag) { return process.argv.includes(flag) }

function approxP95(meanMs, stddevMs) {
  return meanMs + Z_95 * (stddevMs || 0)
}

async function snapshot(client) {
  const out = {}
  for (const q of CRITICAL_QUERIES) {
    const res = await client.query(
      `SELECT queryid, calls, mean_exec_time, stddev_exec_time
         FROM pg_stat_statements
        WHERE query LIKE $1
        ORDER BY calls DESC
        LIMIT 1`,
      [q.match]
    )
    const row = res.rows[0]
    out[q.name] = row
      ? {
          queryid: String(row.queryid),
          calls: Number(row.calls),
          mean_ms: Number(row.mean_exec_time),
          stddev_ms: Number(row.stddev_exec_time),
          p95_ms: approxP95(Number(row.mean_exec_time), Number(row.stddev_exec_time)),
        }
      : null
  }
  return out
}

async function main() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL is required')
    process.exit(2)
  }
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  try {
    if (hasFlag('--reset')) {
      await client.query('SELECT pg_stat_statements_reset()')
      console.log('pg_stat_statements reset — start your run/seed now.')
      return
    }

    const mode = arg('--mode', 'baseline')
    const snap = await snapshot(client)

    if (mode === 'baseline') {
      const outPath = arg('--out', 'baseline.json')
      fs.writeFileSync(outPath, JSON.stringify(snap, null, 2))
      console.log(`baseline written to ${outPath}`)
      for (const name of Object.keys(snap)) {
        console.log(
          snap[name]
            ? `  ${name}: p95~${snap[name].p95_ms.toFixed(1)}ms over ${snap[name].calls} calls`
            : `  ${name}: NOT OBSERVED (workload didn't hit it)`
        )
      }
      return
    }

    // mode === 'check'
    const baselinePath = arg('--baseline', 'baseline.json')
    const tolerance = Number(arg('--tolerance', '0.2'))    // 20% relative regression allowed
    const absP95 = Number(arg('--abs-p95-ms', '500'))      // hard ceiling regardless of baseline
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))

    let failed = false
    for (const q of CRITICAL_QUERIES) {
      const before = baseline[q.name]
      const after = snap[q.name]
      if (!after) {
        console.warn(`? ${q.name}: not observed in this window — cannot check`)
        continue
      }
      if (!before) {
        console.warn(`? ${q.name}: no baseline entry — capture a baseline first`)
        continue
      }
      const relLimit = before.p95_ms * (1 + tolerance)
      const regressedRel = after.p95_ms > relLimit
      const regressedAbs = after.p95_ms > absP95
      // Fail only when BOTH fire: a query slow in absolute terms but flat vs.
      // baseline was already slow (a known cost), and a query that grew but is
      // still fast is noise. A real regression is "grew AND is now slow".
      if (regressedRel && regressedAbs) {
        failed = true
        console.error(
          `✗ ${q.name}: p95 ${before.p95_ms.toFixed(1)}ms -> ${after.p95_ms.toFixed(1)}ms ` +
          `(> ${(tolerance * 100).toFixed(0)}% AND > ${absP95}ms ceiling)`
        )
      } else {
        console.log(
          `✓ ${q.name}: p95 ${before.p95_ms.toFixed(1)}ms -> ${after.p95_ms.toFixed(1)}ms`
        )
      }
    }
    if (failed) {
      console.error('\nQuery-plan regression detected — see EXPLAIN ANALYZE per README §7.')
      process.exit(1)
    }
    console.log('\nNo query regressions past threshold.')
  } finally {
    await client.end()
  }
}

main().catch((err) => { console.error(err); process.exit(2) })
```

### Step 3.2 — Adjust the `match` fragments to the real normalized SQL

The `CRITICAL_QUERIES[].match` fragments are LIKE patterns against `pg_stat_statements.query`. After a warm-up run, verify each matches exactly one statement family:

```
DATABASE_URL=<staging> psql "$DATABASE_URL" -c \
  "SELECT left(query,90), calls FROM pg_stat_statements ORDER BY calls DESC LIMIT 40;"
```
For any `NOT OBSERVED` name, tighten/loosen its `match` fragment against the actual text above (e.g. the admin rides list query's real `FROM ... ORDER BY ... LIMIT` shape). Do not invent — read the real normalized text and match it.

### Step 3.3 — Document it in README §7

Append to `load-tests/README.md` §7, after the "**After seeding:**" paragraph:

```markdown
**Automating the regression check:** rather than eyeballing `EXPLAIN ANALYZE`,
`verify/query-regression.js` snapshots `pg_stat_statements` for the named
critical queries (rides list, driver history, live-map bounding box, ride
creation) and fails if their approximate p95 (mean + 1.6449·stddev — true
percentiles aren't stored) regresses past both a relative tolerance and an
absolute ceiling:

```bash
# reset + baseline at CURRENT volume, then seed, then check at NEW volume
DATABASE_URL=<staging> node verify/query-regression.js --reset
#   ...run a representative workload (e.g. one main.js step)...
DATABASE_URL=<staging> node verify/query-regression.js --mode baseline --out baseline.json
DATABASE_URL=<staging> node seed/generate-bulk-ride-history.js --rides 1000000 --months 12
#   ...re-run the same workload against the larger dataset...
DATABASE_URL=<staging> node verify/query-regression.js --mode check --baseline baseline.json
```

A red result is the signal to open `EXPLAIN ANALYZE` on that query (a seq scan
creeping in, an index stopping being used) — it points you at which query, so
the manual dig above is targeted instead of a fishing expedition.
```

**Acceptance:** `node verify/query-regression.js --mode baseline` writes a baseline and lists per-query p95; `--mode check` exits 0 on an unchanged DB and non-zero on an injected regression.

---

## Task 4 — Concurrent admin-read-during-write scenario (4th scenario in `main.js`)

README §7's admin/analytics read queries are only ever run *manually*, never *concurrently* with the booking/live-tracking write load. Add a 4th scenario to `main.js` that polls the real admin dashboard read endpoints while the write load runs — the realistic "ops has the dashboard open during peak" case. Endpoints below are the real ones from `api/src/modules/admin/admin.routes.ts` (mounted at `/api/v1/admin`).

### Step 4.1 — Add the scenario to `options.scenarios` in `load-tests/k6/main.js`

Insert after the `rider_watch` scenario block (keep the existing three unchanged):

```javascript
    admin_dashboard: {
      // An ops admin with the dashboard open, polling read endpoints WHILE the
      // booking/live-tracking write load runs — the concurrent read+write case
      // README §7 only ever tested in isolation. Needs an ADMIN_TOKEN (a real
      // admin JWT); if it's absent the exec no-ops so main.js still runs for
      // anyone who only seeded user/driver tokens.
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.ADMIN_POLL_RATE || 30), // dashboard polls per minute
      timeUnit: '1m',
      duration: __ENV.BOOKING_DURATION || '20m',
      preAllocatedVUs: 10,
      maxVUs: 30,
      exec: 'adminDashboardPoll',
    },
```

### Step 4.2 — Add the env var + exec function to `main.js`

Add near the other `__ENV` reads (after the `CITY_ID` line):

```javascript
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || ''
```

Add this exec function (place it after `riderIdleWatch`, before `durationToMs`):

```javascript
// ── admin_dashboard (ops reads during the write load) ────────────────────
// Polls the real admin read endpoints (admin.routes.ts, mounted at /api/v1/admin)
// that back the ops dashboard: ride stats, the rides list, the active-sessions
// live map, and one driver's ride history. These are the analytics-style reads
// README §7 says to run against seeded volume — here they run CONCURRENTLY with
// booking_flow/live_tracking so their query plans compete with the write load.
export function adminDashboardPoll() {
  if (!ADMIN_TOKEN) {
    // No admin token seeded — skip cleanly so the other three scenarios run.
    return
  }
  const opts = { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }

  group('admin_dashboard', function () {
    const stats = http.get(`${BASE_URL}/api/v1/admin/rides/stats`, opts)
    check(stats, { 'admin ride stats 200': (r) => r.status === 200 })

    const list = http.get(`${BASE_URL}/api/v1/admin/rides?limit=20`, opts)
    check(list, { 'admin rides list 200': (r) => r.status === 200 })

    // Active sessions = the live-map data source (getAdminActiveSessions).
    const sessions = http.get(`${BASE_URL}/api/v1/admin/sessions/active`, opts)
    check(sessions, { 'admin active sessions 200': (r) => r.status === 200 })

    // Driver ride history for one real driver from the token pool.
    if (tokens.drivers.length > 0) {
      const driverId = randOf(tokens.drivers).id
      const history = http.get(`${BASE_URL}/api/v1/admin/drivers/${driverId}/rides`, opts)
      check(history, { 'admin driver history 200': (r) => r.status === 200 })
    }
  })
}
```

### Step 4.3 — Document `ADMIN_TOKEN` in README

Add to `load-tests/README.md` §2 (Prerequisites), as a new sub-point after the token-seeding step:

```markdown
7. **Admin token for the `admin_dashboard` scenario (optional but recommended).**
   `main.js` now includes a 4th scenario that polls the real admin read
   endpoints (`/admin/rides/stats`, `/admin/rides`, `/admin/sessions/active`,
   `/admin/drivers/:id/rides`) concurrently with the write load — the
   read+write contention §7 otherwise only tests in isolation. Pass a real admin
   JWT as `ADMIN_TOKEN=<jwt>` (mint one via the admin login flow on staging, or
   extend `seed/generate-test-tokens.js` to emit one). If `ADMIN_TOKEN` is
   unset, the scenario no-ops and the other three run unchanged. The driver
   history/ride-list endpoints require a `super_admin`/`ops_admin`-role token.
```

### Step 4.4 — Smoke the new scenario

```
cd load-tests/k6
BASE_URL=... WS_URL=... CATEGORY_ID=<real> CITY_ID=<real> ADMIN_TOKEN=<real> \
MAX_DRIVERS=5 MAX_RIDERS=20 BOOKING_RATE=5 ADMIN_POLL_RATE=10 HOLD_DURATION=1m BOOKING_DURATION=1m30s \
k6 run main.js
```
Expected: the `admin_dashboard` checks are green (200s) alongside the existing scenarios. With `ADMIN_TOKEN` unset, the run is identical to before (scenario no-ops).

**Acceptance:** `main.js` runs 4 scenarios with a valid `ADMIN_TOKEN`, and is unchanged in behavior without one.

---

## Task 5 — First-real-staging-execution runbook (checklist, no code)

Per README §2.1 the suite has never run against real staging (staging didn't exist). This is the operational checklist for the first live session — a runbook, not code. It references, and does not duplicate, README §2 (prereqs), §4 (ramp), §5 (monitoring), §6 (triage), §8 (correctness).

### Step 5.1 — Add §10 "First live execution runbook" to `load-tests/README.md`

```markdown
## 10. First live execution runbook

The first time this suite touches real staging. Do it in this order; do not
skip ahead. Each numbered item is a gate — if it isn't true, stop.

**T-1 week — make staging real (the actual blocker, §2.1):**
- [ ] Staging environment exists and is reachable at a stable `BASE_URL`/`WS_URL`
      (resolves the §2.1 blocker: `staging.tfvars`, variable-ized ASG sizing).
- [ ] `pg_stat_statements` enabled, `log_min_duration_statement=500`, DB URL uses
      the `-pooler` host (§2.4) — required for query-regression (Task 3) and the
      §5 "what strains first" analysis.
- [ ] Grafana dashboards from §5 exist and Alloy is shipping recent metrics
      (confirm live data, not just that panels exist).

**T-2 days — seed and dry-run (§2, §3):**
- [ ] `seed/generate-test-tokens.js --users 6000 --drivers 400 --expiry 3h` run;
      `tokens.json` present; driver-count warning resolved.
- [ ] Real `CATEGORY_ID`/`CITY_ID` confirmed from staging (don't trust `1`/`1`).
- [ ] `ADMIN_TOKEN` minted for the `admin_dashboard` scenario (Task 4, §2.7).
- [ ] `smoke.js` run alone and fully green (§3) — never let the live session be
      the script's first contact with staging.
- [ ] `accept-race.js` run once: all thresholds green, including
      `accept_race_unauthorized_accept_succeeded` (the hijack regression guard,
      §8) — proves the Plan A Task 0 fix holds on staging.

**T-0 — the live ramp (§4), client watching, dashboards open (§5):**
- [ ] Run the §4 ramp steps 1→4 in order (`MAX_DRIVERS`/`MAX_RIDERS`/`BOOKING_RATE`
      as tabulated), each looking boring before advancing.
- [ ] At the step-4 (target) run, also capture a query-regression baseline vs.
      the bulk-seeded volume (Task 3) if data-volume testing is in scope for the
      session.
- [ ] For issues that surface, use §6's three-bucket triage out loud; do not
      stop the run unless it's actively cascading.

**After each run:**
- [ ] `verify/reconcile.js --since-hours <window>` — data-correctness gate (§8);
      exits non-zero if anything drifted.
- [ ] `verify/query-regression.js --mode check` if a baseline was captured (Task 3).
- [ ] Clean up synthetic rows and stuck sessions (§6.4).

**Deliverable (§6.3):** the write-up comparing what strained first vs. the
report's §5 prediction — that comparison, cross-referenced against the Grafana
window, is the client deliverable, more than "it passed." Results and any
follow-up tickets go where §6 already defines; this runbook does not introduce a
separate location.
```

### Step 5.2 — Update the §9 Files list

In `load-tests/README.md` §9, add the two new k6/verify files to the tree:

```markdown
├── verify/
│   ├── reconcile.js                     — post-run DB correctness checks (§8)
│   └── query-regression.js              — pg_stat_statements p95 regression gate (§7, Task 3)
└── k6/
    ├── lib/
    │   └── socketio.js             — hand-rolled Engine.IO v4 / Socket.io v4 client for k6
    ├── smoke.js                    — 1-VU sanity check, run before every live session
    ├── main.js                     — the real test: booking_flow + live_tracking + rider_watch + admin_dashboard
    ├── spike.js                    — instant 0->N spike + recovery test (Task 1)
    └── accept-race.js              — concurrency-correctness test for the ride-accept race (§8)
```

**Acceptance:** README has §10 runbook and an updated §9 file tree covering `spike.js` and `query-regression.js`.

---

## Final verification

- `k6 run spike.js` at tiny scale: green thresholds, visible recovery in the tail (Task 1).
- `main.js` at tiny scale with and without `ADMIN_TOKEN`: 4 scenarios vs. 3, both clean (Task 4).
- `node verify/query-regression.js --mode baseline` then `--mode check` on an unchanged DB: exit 0; on an injected slow query: exit 1 (Task 3).
- README renders: §4a (soak), §7 (automation note), §10 (runbook), §9 (updated tree) all present and internally consistent (no "staging doesn't exist yet" contradiction with the runbook — the runbook's T-1-week gate owns that).

