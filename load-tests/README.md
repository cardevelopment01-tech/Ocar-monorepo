# Ocar — Pre-Campaign Load Test

Implements checklist step 13 from `docs/architecture/2026-08-04-production-scale-readiness-report.md`:

> Load test before launch — simulate 6,000 concurrent sockets + booking bursts (k6/artillery) against staging to confirm instance count, `t3.medium` CPU-credit behavior, and Redis tier hold up, rather than trusting the estimate.

This directory is meant to be run **live, with the client watching**, against the **staging** environment (not prod). Read this whole file before that session — most of the risk in a live load test is operational (wrong environment, expired tokens, a script bug you discover in front of the client), not the load itself.

---

## 1. What's being tested, and why these numbers

Straight from the report (§1, §5) — this test is not sized on round guesses:

| Load characteristic | Report's number | How this test simulates it |
|---|---|---|
| Concurrent users | 5,000–6,000 | Mostly `rider_watch` (idle Socket.io connections) + `live_tracking` (driver connections) |
| GPS pings | every 3–5s per active driver | `live_tracking` scenario, randomized 3–5s interval per driver |
| Ride bookings | 1,000–2,000/day (trivial rate) | `booking_flow` scenario, tunable req/min, deliberately in **bursts** not steady rate |
| What's expected to strain first | Redis pub/sub fan-out + Neon connection pool, **not app CPU** (§5) | Monitoring plan in §5 below watches those specifically |

Three scenarios run **concurrently** in one `k6 run main.js` — that overlap (bookings happening while thousands of sockets are already open) is itself part of what's being tested, not an implementation detail.

---

## 2. Prerequisites — do these before the day of the test

1. **Staging environment must exist.** As of this writing it does not — `infra/terraform/providers.tf`'s S3 backend is hardcoded to `key = "prod/terraform.tfstate"`, there is no `staging.tfvars`, and the staging Phase 1 (variable-izing ASG sizing) work referenced in `docs/TERRAFORM_INFRA_BRIEF.md` had not landed as of the last check. **This is the actual blocker — resolve it first.** Running this against production is not an option.
2. **Seed test data on staging:**
   ```bash
   DATABASE_URL=<staging Neon URL> JWT_ACCESS_SECRET=<staging secret> \
     node seed/generate-test-tokens.js --users 6000 --drivers 400 --expiry 3h
   ```
   Copy both values from staging's `api-env` SSM parameter (see `CLAUDE.md`'s Pending Ops Actions for the SSM pull/edit loop). This writes `k6/tokens.json`. Re-run any time — it's idempotent (upserts, reuses existing rows).
   - If it warns it found fewer than `--drivers` active drivers with an active vehicle: onboard more test drivers through the real driver app onboarding flow on staging once — these become reusable for every future load test, not a one-time cost.
3. **Confirm `CATEGORY_ID`/`CITY_ID`** actually exist on staging: `SELECT id, name FROM vehicle_categories; SELECT id, name FROM cities;` — pass the real IDs as env vars, don't trust the `1`/`1` defaults blind.
4. **Neon dashboard steps from `docs/superpowers/specs/2026-07-26-db-loadtest-readiness-design.md`** (still open per `CLAUDE.md`): enable `pg_stat_statements`, set `log_min_duration_statement=500`, confirm `DATABASE_URL` uses the `-pooler` host. Do this before the test — it's the only way to get the query-level data the "what actually strains first" analysis needs afterward.
5. **Grafana dashboards open and ready** — see monitoring plan below. Confirm Alloy is shipping metrics from the staging instances before starting (check for recent data, not just that the panel exists).
6. **Run `smoke.js` in private, alone, at least a day before the live session** (§3). Never let a live k6 run in front of a client be the first time the script has touched staging.

---

## 3. Dry run (do this privately first)

```bash
cd load-tests/k6
BASE_URL=https://staging.ocar.example.com \
WS_URL=wss://staging.ocar.example.com \
CATEGORY_ID=<real id> CITY_ID=<real id> \
k6 run --vus 1 --iterations 1 smoke.js
```

This exercises every code path `main.js` uses — auth headers, the real booking flow, and the hand-rolled Socket.io handshake — with 1 VU. If something is wrong (wrong secret, expired token, a staging config difference), it fails here loudly instead of silently during the real run. Fix everything until every `check()` in the smoke test output is green.

**Why a hand-rolled Socket.io client at all:** k6 runs in its own JS runtime, not Node — the real `socket.io-client` package doesn't work inside it. `k6/lib/socketio.js` speaks the Engine.IO v4 + Socket.io v4 wire protocol directly over k6's native WebSocket support. This is the standard way to load-test Socket.io with k6 (not a shortcut specific to this project), but it's exactly the kind of thing that can be subtly wrong — hence step 3 being mandatory, not optional.

**Fallback if `smoke.js` can't get the socket handshake working:** Artillery has a purpose-built `artillery-engine-socketio-v3` plugin that speaks real Socket.io instead of a hand-rolled client — more robust, but a second tool to install/learn under time pressure. Keep this as Plan B; don't reach for it unless the k6 socket client proves unreliable in the dry run.

---

## 4. The ramp plan — do not go straight to 6,000

Run in this order, on **separate days if possible**, watching the dashboards in §5 at each step:

| Step | `MAX_DRIVERS` | `MAX_RIDERS` | `BOOKING_RATE` | What you're checking |
|---|---|---|---|---|
| 1 | 20 | 200 | 5/min | Everything works at all; no config mistakes |
| 2 | 100 | 1,000 | 10/min | Redis/Neon pool graphs move but stay flat |
| 3 | 250 | 3,000 | 15/min | ASG scaling triggers if it's going to |
| 4 (the live one) | 400 | 6,000 | 20/min | The actual report number — §1/§5 |

```bash
BASE_URL=... WS_URL=... CATEGORY_ID=... CITY_ID=... \
MAX_DRIVERS=100 MAX_RIDERS=1000 BOOKING_RATE=10 HOLD_DURATION=10m \
k6 run main.js
```

Each step should look boring — steady latency, no error spikes. The first time something breaks, that's real information; don't paper over it by immediately re-running at a lower number and calling it done. See §6.

---

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

---

## 5. What to watch during the run (per the report's own §5 analysis)

The report explicitly names what should strain first — **not app CPU**:

- **Redis (pub/sub fan-out)** — ops/sec against the plan's cap, connected-clients count. This is what the `@socket.io/redis-adapter` fans every `driver:location` broadcast through across instances.
- **Neon connection pool** — concurrent pooled connections across all ASG instances vs. the pool ceiling. This is why `pg_stat_statements` + the `-pooler` endpoint (§2.4) need to be on before the test, not after.
- **`t3.medium` CPU credit balance** (`CPUCreditBalance` CloudWatch metric per instance) — the actual question behind "should this be `m5.large` instead." Watch it drain, don't assume from the estimate.
- **cAdvisor per-container panel** (`ocar-overview.json`'s "Per-Container Resource Usage" row, per `CLAUDE.md`'s Pending Ops Actions) — needs its `terraform apply` + dashboard re-import done first if that's still outstanding.
- **ALB target group health + 5xx rate, p95 latency** — matches this script's own `http_req_duration` threshold (`p(95)<500ms`), which mirrors the ASG's own secondary scaling trigger.
- **GPS ping -> broadcast latency** — the script's `gps_ping_latency_ms` metric only measures the client-side `emit()` call, not true end-to-end latency (Socket.io events are fire-and-forget, no ack). For real ping-to-broadcast latency, pull it from the OpenTelemetry trace in Tempo instead — that's what tracing was built for.

Open all of these in Grafana **before** starting step 4, in tabs, so nobody is hunting for a dashboard mid-run in front of the client.

---

## 6. Bug triage process for issues that surface live

Things *will* surface — that's the point of the test, and worth saying to the client up front so it lands as "the test is working," not "something is broken." When something does:

1. **Don't stop the run to investigate** unless it's actively making things worse (e.g. staging DB connections exhausted, cascading 500s). A single failing check or an error-rate blip is data — screenshot/note it and keep going; k6's own summary at the end has the full picture.
2. **Classify fast, out loud, in three buckets:**
   - **Load-test artifact** — e.g. token expiry mid-run, a staging-only data quirk (missing category), a rate limit that's specifically test-traffic-shaped. Say so, note the fix for the *next* run, move on.
   - **Real bug, not urgent** — reproducible, but not what determines the sign-off (e.g. a slow non-critical endpoint). Log it as a follow-up ticket.
   - **Real capacity problem** — the thing this whole test exists to catch: CPU credits draining, Redis ops/sec pinned at the cap, Neon pool exhausted, ASG not scaling when it should. This is exactly the useful outcome — it's what the mitigation paths in the report (§2: Unlimited burst mode -> `m5.large`; §4 step 9: bump Redis tier) already anticipated. Frame it that way to the client: the report said "confirm via load test rather than trusting the estimate," and this is that confirmation working as designed.
3. **After the run:** pull the k6 summary (or `--out json=results.json` for a saved run), cross-reference against the Grafana dashboards from §5 for the same time window, and write up what strained first vs. what the report predicted (§5's table) — that comparison is the actual deliverable for the client, more than "it passed."
4. **Clean up staging after every run:** `DELETE FROM users WHERE phone LIKE '99999%';` (synthetic riders). Driver rows are real/reused — nothing to delete there, but confirm no drivers were left stuck `status='on_trip'` from an interrupted run (`UPDATE driver_sessions SET status='offline' WHERE ...` if so).

---

## 7. Data-volume query-performance seeding (separate from the k6 tests above)

Everything above tests **concurrent connections**. It does not test what happens to query
plans once `rides`/`ride_status_history`/`payments`/`gps_tracks` hold real volume — that's
what `seed/generate-bulk-ride-history.js` is for. It's the tool that produces the data
CLAUDE.md's Pending Ops Actions section says the keyset-pagination and
`ride_status_history`/`ride_messages` partitioning decisions are waiting on.

```bash
cd load-tests
npm install   # pg + jsonwebtoken, only needed for the seed/ scripts, not k6

# 1. run this first — the bulk seeder reuses its synthetic users/drivers
DATABASE_URL=<staging Neon URL> JWT_ACCESS_SECRET=<staging secret> \
  node seed/generate-test-tokens.js --users 6000 --drivers 400 --expiry 3h

# 2. seed 1M historical rides (+ status history + fare snapshots + payments)
#    spread over the last 12 months, skewed toward recent dates
DATABASE_URL=<staging Neon URL> \
  node seed/generate-bulk-ride-history.js --rides 1000000 --months 12
```

Flags: `--rides` (default 1,000,000), `--months` (default 12, date range to spread rows
over), `--batch-size` (default 1000), `--completed-pct`/`--cancelled-pct` (default 80/15,
remainder lands as `no_drivers`), `--gps-per-ride` (default **0** — off; turning this on
multiplies row count fast: N rides × this number, see the script's own comment before raising
it past a small sample).

The script is **additive, not idempotent** — it refuses to run twice without
`--i-know-what-im-doing` once it detects previously seeded rows, to avoid silently doubling
your dataset. Clean up with `node seed/generate-bulk-ride-history.js --cleanup` (prints the
raw SQL too, for a dedicated load-test DB branch a `TRUNCATE ... CASCADE` is faster — the
script's cleanup output notes this).

**After seeding:** this is where §2.4's `pg_stat_statements`/`log_min_duration_statement`
setup and `api/scripts/index-usage-audit.sql` earn their keep — run real admin/analytics
queries (rides list, driver history, live-map bounding-box queries) against the seeded volume
and check `EXPLAIN ANALYZE` output before drawing conclusions about pagination or partitioning.

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

---

## 8. Catching real bugs, not just capacity limits

Everything above (§1-7) answers "does it stay fast/up under load." It does **not** answer
"does the data it leaves behind stay correct under load" — a 200 status code doesn't mean
the ride/payment/session rows it touched ended up consistent. Two more tools close that gap:

### `k6/accept-race.js` — the ride-accept race condition

`main.js`'s `booking_flow` only exercises create → read → cancel. It never touches the one
genuinely concurrency-sensitive endpoint in the whole system: `POST /rides/:id/accept`, where
multiple drivers can be offered the same ride by `broadcast.processor.ts` and race to take it.
This script fires N drivers' accept calls at the **same ride, truly concurrently** (`k6
http.batch`, real parallel HTTP connections from one VU — no cross-VU timing games needed)
and asserts exactly one wins and the rest get a clean `409`, never a `500` or a double-assign.

It also includes one "outsider" driver per race who is deliberately never brought online and
never sent a location ping — i.e. definitely never offered this ride. **This surfaced a real
bug while building it** (fixed in commit `de01ffa`): `POST /rides/:id/accept`
(`api/src/modules/rides/rides.repository.ts`'s `acceptAssignment`) used to gate its
`UPDATE rides SET status='accepted', driver_id=$2 ...` only on `status = 'requested'` — it never
checked `ride_assignments` for whether `driver_id` was ever offered the ride. Any authenticated
driver could accept any `requested` ride by ID (ride IDs are sequential bigints), regardless of
city, category, or online status. `acceptAssignment` now requires an `EXISTS` match against an
`offered` `ride_assignments` row, so the threshold `accept_race_unauthorized_accept_succeeded:
['count<1']` in this script now **passes** — it's a regression guard against that bug reappearing,
not an open bug anymore. See `verify/reconcile.js` below for confirming this from real DB data too.

```bash
cd load-tests
BASE_URL=https://staging.ocar.example.com WS_URL=wss://staging.ocar.example.com CITY_ID=1 \
  k6 run k6/accept-race.js
```

Needs at least `(RACE_SIZE + 1) * ACCEPT_RACE_ITERATIONS` drivers sharing a category in
`tokens.json` (defaults: `RACE_SIZE=5` matching `BROADCAST_MAX_DRIVERS`, `ACCEPT_RACE_ITERATIONS=5`)
— re-run `generate-test-tokens.js --drivers 400` if it complains about too few.

### `verify/reconcile.js` — post-run data correctness

Run this after any k6 session (`main.js`, `accept-race.js`, or both). It's read-only, scoped to
synthetic rows (`users.phone LIKE '99999%'`) plus a time window, so it's safe against a staging
DB that also has real historical data. Checks: rides stuck non-terminal (an interrupted VU),
rides whose final status has no matching `ride_status_history` row, payment ledger drift
(`amount != commission_amount + driver_earning`), `driver_sessions` stuck `on_trip` with no
active ride, orphaned `gps_tracks` rows, and — the same hijack check as above, but from real DB
state instead of an HTTP status code — rides accepted by a driver with no `ride_assignments` row.

```bash
DATABASE_URL=<staging Neon URL> node verify/reconcile.js --since-hours 24
```

Exits 1 if any check finds violations, so it can gate a "this session passed" decision rather
than being eyeballed.

---

## 9. Files

```
load-tests/
├── README.md                            — this file
├── package.json                         — pg + jsonwebtoken, used by seed/ and verify/ scripts
├── seed/
│   ├── generate-test-tokens.js          — run first; produces k6/tokens.json
│   └── generate-bulk-ride-history.js    — run second; seeds ~1M historical rides for
│                                           query-performance testing (§7)
├── verify/
│   ├── reconcile.js                     — post-run DB correctness checks (§8)
│   └── query-regression.js              — pg_stat_statements p95 regression gate (§7)
└── k6/
    ├── lib/
    │   └── socketio.js             — hand-rolled Engine.IO v4 / Socket.io v4 client for k6
    ├── smoke.js                    — 1-VU sanity check, run before every live session
    ├── main.js                     — the real test: booking_flow + live_tracking + rider_watch
    └── accept-race.js              — concurrency-correctness test for the ride-accept race (§8)
```
