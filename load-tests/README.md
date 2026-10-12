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

1. **Staging environment must exist and be running the deploy you want to test.** `infra/terraform/staging.tfvars`/`staging.backend.hcl` exist and staging's blue/green Terraform shape is already live (see `docs/superpowers/specs/2026-08-14-staging-runbook.md`) — provision it with `pnpm infra:staging:apply`, then get a real app version onto it with the `Deploy` GitHub Actions workflow (`workflow_dispatch`, `environment: staging`), not just `terraform apply` on its own (that only boots the ASGs, it doesn't deploy code).
2. **Seed test data on staging:**
   ```bash
   JWT_ACCESS_SECRET=<staging secret, from the api-env SSM param> \
     node seed/generate-test-tokens.js --users 6000 --drivers 400 --expiry 3h
   ```
   The DB connection is derived live from AWS (`seed/lib/staging-db.js`), not from `DATABASE_URL` — that SSM value still points at the pre-migration Neon database and must never be used for load-test tooling. This writes `k6/tokens.json`. Re-run any time — it's idempotent (upserts, reuses existing rows).
   - If it warns it found fewer than `--drivers` active drivers with an active vehicle: run `node seed/activate-restored-driver-vehicles.js` first if staging's drivers came from a prod-snapshot restore (their vehicles are commonly still `pending`), or onboard more test drivers through the real driver app onboarding flow on staging once — these become reusable for every future load test, not a one-time cost.
3. **Confirm `CATEGORY_ID`/`CITY_ID`** actually exist on staging: `SELECT id, name FROM vehicle_categories; SELECT id, name FROM cities;` — pass the real IDs as env vars, don't trust the `1`/`1` defaults blind.
4. **DB observability steps from `docs/superpowers/specs/2026-07-26-db-loadtest-readiness-design.md`** (still open per `CLAUDE.md` — note that doc predates the Neon→RDS migration, so read "Neon dashboard"/"`-pooler` host" as stale): confirm `pg_stat_statements` is enabled and `log_min_duration_statement=500` is set — on RDS this is `infra/terraform/rds.tf`'s `aws_db_parameter_group.main`, already applied for both environments, not a manual dashboard step. Do this before the test — it's the only way to get the query-level data the "what actually strains first" analysis needs afterward.
5. **Grafana dashboards open and ready** — see monitoring plan below. Confirm Alloy is shipping metrics from the staging instances before starting (check for recent data, not just that the panel exists).
6. **Run `smoke.js` in private, alone, at least a day before the live session** (§3). Never let a live k6 run in front of a client be the first time the script has touched staging.
7. **Admin token for the `admin_dashboard` scenario (optional but recommended).**
   `main.js` now includes a 4th scenario that polls the real admin read
   endpoints (`/admin/rides/stats`, `/admin/rides`, `/admin/sessions/active`,
   `/admin/drivers/:id/rides`) concurrently with the write load — the
   read+write contention §7 otherwise only tests in isolation. Pass a real admin
   JWT as `ADMIN_TOKEN=<jwt>` (mint one via the admin login flow on staging, or
   extend `seed/generate-test-tokens.js` to emit one). If `ADMIN_TOKEN` is
   unset, the scenario no-ops and the other three run unchanged. `/admin/rides/stats`
   and `/admin/rides` accept `super_admin`/`ops_admin`/`support_admin` tokens;
   `/admin/drivers/:id/rides` is narrower and needs `super_admin`/`ops_admin`
   (`support_admin` gets a 403 there); `/admin/sessions/active` accepts any
   admin role.

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
JWT_ACCESS_SECRET=<staging secret> \
  node seed/generate-test-tokens.js --users 6000 --drivers 400 --expiry 3h

# 2. seed 1M historical rides (+ status history + fare snapshots + payments)
#    spread over the last 12 months, skewed toward recent dates
node seed/generate-bulk-ride-history.js --rides 1000000 --months 12
```

Neither needs `DATABASE_URL` — both derive the staging RDS connection live from AWS
(`seed/lib/staging-db.js`). Never point load-test tooling at the `DATABASE_URL` SSM value;
it still points at the pre-migration Neon database.

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
# NOTE: --reset wipes pg_stat_statements for the ENTIRE database, not just
# these 4 tracked queries — anyone else profiling this DB loses their window too.
node verify/query-regression.js --reset
#   ...run a representative workload (e.g. one main.js step)...
node verify/query-regression.js --mode baseline --out baseline.json
node seed/generate-bulk-ride-history.js --rides 1000000 --months 12
#   ...re-run the same workload against the larger dataset...
node verify/query-regression.js --mode check --baseline baseline.json
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

`verify/lifecycle-checks.js` (loaded automatically) adds 21 checks (incl. 2 SOS/dispute safety checks) for the rides `k6/lifecycle.js`
creates: completed rides without a payment, a final fare snapshot, a matching `driver_earnings`
row or verified start/end OTP events; payment amount vs fare `total_final`; commission and
driver-earning arithmetic; cash payments not marked completed; double commission debits; driver
wallet balance vs its latest ledger row and a ledger-chain check (catches lost updates);
completed rides with pending stops or out-of-order timestamps; money moving on cancelled rides;
cancelled rides without a `ride_cancellations` row; a driver or rider holding two active rides; and
duplicate or misplaced ratings. Two are `WARN` only (commission-mode ride with no wallet debit,
which can be legitimate on an empty wallet; scheduled rides left uncancelled). It also prints the
ride mix in the window first, so a PASS on zero rides is not mistaken for a real pass. The SQL was
executed read-only against the local test DB to catch bad column/enum names; it has not yet been
run against lifecycle data.

```bash
node verify/reconcile.js --since-hours 24
```

Exits 1 if any check finds violations, so it can gate a "this session passed" decision rather
than being eyeballed.

---

## 8b. Full ride lifecycle and payment webhook (written, not yet run)

### `k6/lifecycle.js` — everything after matching
One VU = one rider + one driver, driven estimate -> book -> admin assign -> accept -> arrived -> start OTP -> (stop) -> (return leg) -> end OTP -> collect-cash -> chat -> ratings. Mix of one_way / round_trip / rental, plus scheduled bookings (book+cancel) and mid-flow cancellations. Pairing is via `POST /admin/rides/:id/assign` (mode `request`), so `ADMIN_TOKEN` (super_admin/ops_admin) is required. Broadcast contention stays in `main.js`/`accept-race.js`.

```bash
# dry run first, alone
BASE_URL=... CITY_ID=<real> ADMIN_TOKEN=<jwt> k6 run --vus 1 --iterations 1 lifecycle.js
# ramp (VUS must be <= drivers in CITY_ID and <= users in tokens.json)
BASE_URL=... CITY_ID=<real> ADMIN_TOKEN=<jwt> VUS=10 DURATION=10m k6 run lifecycle.js   # then 25, 50, 100
```
Knobs: `PCT_ROUND_TRIP`, `PCT_RENTAL`, `PCT_SCHEDULED`, `PCT_RIDER_CANCEL`, `PCT_DRIVER_CANCEL`, `PCT_MID_STOP`, `THINK_S`, `OVERRIDE_ELIGIBILITY`. Run alongside `main.js` (different terminal, smaller `MAX_*`) for the realistic overlap of GPS/sockets with ride completions. Afterwards run `verify/reconcile.js`.

Caveats: time is compressed (seconds between steps, not minutes); every one-way/round-trip booking makes a server-side Google Directions call (quota/cost); scheduled rides are cancelled, never dispatched.

### `k6/payments-webhook.js` — webhook ingest and idempotency
Synthetic HMAC-signed `payment.captured` events (70% unique, 20% one shared id, 10% bad signature). Needs `WEBHOOK_SECRET` = staging `RAZORPAY_WEBHOOK_SECRET`. No real payments are confirmed (unknown order ids). Clean up with `DELETE FROM payment_gateway_events WHERE razorpay_event_id LIKE 'pay_loadtest_%';`.

**Expected to fail the first time:** `payment_gateway_events.razorpay_event_id` is `UNIQUE`, and `handleWebhookEvent` does SELECT-then-INSERT with no `ON CONFLICT`, so concurrent deliveries of the same event id can raise a unique violation (500). Real gateways retry, so treat a failure of the `duplicate 200` check as a real bug, not a test problem.

### `k6/reads.js`, `k6/admin-ops.js`, `k6/auth.js` (written, not yet run)
- **`reads.js`** — rider and driver home/earnings/wallet/notification reads, one principal per VU. `RIDER_VUS`, `DRIVER_VUS`, `CATEGORY_ID`. Reads only.
- **`admin-ops.js`** — the ops dashboard: lists, SOS/disputes, and the heavy analytics aggregates, plus finance endpoints if `FINANCE_TOKEN` is set. Pass several admin tokens via `ADMIN_TOKENS=a,b,c`.
- **`auth.js`** — OTP request/verify/refresh/logout storm on synthetic `+919999` phones. Only works end to end where `NODE_ENV != production` (the OTP is echoed only then) and SMS is stubbed; never run against prod.

**Rate limits shape all of these** (`api/src/middleware/rateLimit.middleware.ts`): `generalLimiter` is 600 req/min per principal (per IP when unauthenticated), `authLimiter` is 10 req/min per IP on `/auth/*`, chat is 5/s per ride, masked calls 3/min. One generator IP therefore tops out at 10 unauthenticated req/s and 10 auth req/min. Authenticated scripts get a bucket per VU; admin scripts share one bucket per admin token. Count 429s as a finding about the limiter, not about the API.

**Production note from this review:** the Razorpay webhook is mounted behind `generalLimiter`, keyed by source IP. A burst of webhook deliveries from Razorpay's few IPs can exceed 600/min and get 429s; Razorpay retries, so payments should still land late rather than be lost, but consider exempting the webhook route from the limiter (signature verification already gates it).

### Seed prerequisites checklist (before `lifecycle.js`)
- [ ] `k6/tokens.json` regenerated (old file expired 2026-09-09) with `--drivers` >= planned `VUS`
- [ ] >= `VUS` active drivers with `cityId = CITY_ID` (today ~118 in city 1; the rest are spread over 5 cities)
- [ ] Current rate cards exist for `CITY_ID` (or global) for every driver category, for `one_way`, `round_trip` and `rental`
- [ ] At least one active rental package per driver category (`GET /pricing/rental-packages/:categoryId?city_id=`)
- [ ] Driver `daily_verification` rows for today (generate-test-tokens does this)
- [ ] Driver wallets exist; leave `OVERRIDE_ELIGIBILITY=true` unless funded
- [ ] City `CITY_ID` is `active` with a boundary that contains the Bhubaneswar/Cuttack test coordinates
- [ ] Staging Google Maps key present and its quota/budget acknowledged
- [ ] SMS/FCM are stubbed or sandboxed on staging (lifecycle triggers notifications at every step)

---

## 8c. Realtime, workers, driver verification, safety writes, PayU (written, not yet run)

All NOT RUN. Dry-run each at 1 VU first (the header of each script has the exact command).

| Script | What it covers | Needs |
|---|---|---|
| `k6/realtime.js` | GPS fan-out latency: driver `location:update` -> rider socket (`ride:{id}`) and -> admin sockets (`admin:ops`). Probe driver stamps send time in `heading`; receivers decode it (same k6 clock, no skew). Reports `driver_to_rider_ms`, `driver_to_admin_ms`, delivery ratio (`rt_rider_received / rt_pings_sent`) and admin fan-out volume | `ADMIN_TOKEN`, fresh tokens, `PAIRS` <= drivers/users in `CITY_ID`. Run beside `main.js` for a busy room. Server-side Google Roads snap sits inside the rider latency |
| `k6/queue-monitor.js` | Background-worker lag: samples `/metrics` for `bullmq_queue_job_counts` (waiting/active/delayed/failed per queue), `pg_pool_connections`, event-loop lag. Thresholds on max waiting, new failed jobs, pool waiters | `/metrics` reachable from the generator (may be VPC-only). One instance's pool/loop values, global queue counts |
| `k6/daily-verification.js` | Morning driver spike: status -> 2x upload-init -> 2x real S3 PUT -> submit -> status. Writes real S3 objects + 2 `driver_verifications` rows per driver | S3 reachable, active drivers with a vehicle. Idempotent per driver per day |
| `k6/safety-writes.js` | Profile PATCH, saved places CRUD, emergency contacts, SOS (+ dedup check), driver SOS, ride to completion, dispute. Masked call behind `CALLS=true` (real phone call, 3/min) | `ADMIN_TOKEN` unless `RIDES=false`. SOS hourly cap = 5/principal (429 counted as by design) |
| `k6/payu-collections.js` | `main`'s PayU collections: wallet top-up + package purchase order creation, and the webhook/return funnel (no-hash ack, bad-hash 400/303, valid-hash fake-txn which calls PayU's verify API) | `PAYU_KEY`/`PAYU_SALT` for the valid-hash mode. A real captured payment needs a browser at PayU and is checked by hand |

`k6/lib/pair.js` is the shared "book + admin-assign + driver accept" helper used by `safety-writes.js`.

**Which branch is staging on?** `main` now collects online payments through PayU (merged 2026-10-08); the Razorpay webhook remains for driver payouts. `payments-webhook.js` still targets that Razorpay route. Confirm what staging runs before reading any payment result.

---

## 8d. Single-user evidence run (request, response, time, DB + cache writes)

For the client's "1 user, 1 iteration" ask. One command snapshots the DB and Redis, runs `lifecycle.js` at 1 VU / 1 iteration with request/response capture, waits for workers, snapshots again and writes `evidence/out/<timestamp>/report.md`.

```bash
cd load-tests/evidence
BASE_URL=https://... CITY_ID=1 ADMIN_TOKEN=<jwt> DATABASE_URL=postgres://...  REDIS_URL=redis://... node run.js --type one_way            # or round_trip | rental ; --settle 15 (seconds)
```
- Needs `k6` on PATH, a fresh `k6/tokens.json`, and `ioredis` resolvable (`npm i ioredis` here, or it is borrowed from `../api/node_modules`). `DATABASE_URL` unset uses the staging RDS lookup (tunnel needed); `REDIS_URL` unset skips the Redis section.
- Report sections: (1) per-call table with status and response time plus collapsible request/response bodies, (2) DB rows inserted / updated / deleted per table, (3) Redis keys created / changed / removed per key pattern, split into application cache vs BullMQ vs rate limiter.
- Pieces: `k6/lib/evidence.js` (the `EVIDENCE=1` recorder used by `lifecycle.js`), `evidence/snapshot.js` (before/after), `evidence/report.js` (Markdown). Each can be run alone; see their headers.
- Caveats: counts include anyone else's writes on a shared environment; update counts rely on `updated_at`; `evidence.log` holds phone numbers and ride OTPs, keep it out of git (`evidence/out/` is ignored). Run `verify/reconcile.js` after as well.
- Tested: `snapshot.js` and `report.js` against local test Postgres/Redis and a hand-made log. The k6 side and `run.js` end to end have not been run.

### Production run (one real rider, one real driver)
Uses `--prod` mode: real accounts logged in with real OTPs, normal dispatch (no admin token), cash payment only, and **ID-scoped** DB/Redis deltas so other users' traffic is excluded.
```bash
cd load-tests/evidence
BASE_URL=https://api... node login.js --rider +91XXXXXXXXXX --driver +91YYYYYYYYYY   # types the two SMS codes; writes k6/prod-tokens.json
BASE_URL=https://api... DATABASE_URL=<read-only> REDIS_URL=<redis> \
PICKUP_LAT=.. PICKUP_LNG=.. DROP_LAT=.. DROP_LNG=.. DISTANCE_KM=.. DURATION_MIN=.. \
node run.js --prod --confirm-prod --type one_way
```
**Safety net and rollback (do this first; these are AWS actions in production, so you run them, not the tooling):**
```bash
# 1. Confirm automated backups / point-in-time recovery are on (retention > 0)
aws rds describe-db-instances --region ap-south-1 --query "DBInstances[].[DBInstanceIdentifier,BackupRetentionPeriod,LatestRestorableTime]" --output table
# 2. Manual snapshot right before the run
aws rds create-db-snapshot --region ap-south-1 --db-instance-identifier <prod-db-instance-id> --db-snapshot-identifier ocar-pre-evidence-$(date +%Y%m%d-%H%M)
aws rds wait db-snapshot-available --region ap-south-1 --db-snapshot-identifier <same-id>
```
- The snapshot is a disaster net only. Restoring it would create a separate instance and lose every real write made after it, so it is **not** the way to undo one test ride.
- The tooling's own rollback is `preflight.js` (refuses to start on an unsafe state, captures a baseline of the rider, driver, wallets and session) and `cleanup.js` (API-only: cancels a not-yet-started ride as the rider, takes the driver offline, confirms the final state). `run.js --prod` calls `cleanup.js` automatically if k6 fails or is interrupted. A ride already `in_progress` is deliberately NOT auto-ended: ops finishes it in the apps or with admin `force-resolve`.
- A **completed** ride cannot be cleanly undone: payment, commission debit, driver earnings and ledger rows are append-only. Agree with finance beforehand to leave it flagged as a test ride (rider and driver ids are in the report) or reverse the commission with their normal wallet adjustment. Do not delete rows by hand.
- Redis is cache and queues: no snapshot or restore is needed, and restoring it would drop live queue jobs.

Before you run it:
- [ ] RDS snapshot taken and `available` (above)
- [ ] `node preflight.js ...` passes (`run.js --prod` runs it for you and stops on any FAIL; WARNs need a human decision)
- [ ] Test driver: active, approved docs, **today's selfie + plate verification done**, wallet at or above the minimum (commission cities), no active ride; logging in here signs the driver out of their phone
- [ ] Driver's operating city is active and the pickup/drop lie inside its boundary; set `DISTANCE_KM`/`DURATION_MIN` to match the real route
- [ ] Nobody else is online near the pickup (the booking is broadcast to every eligible nearby driver); use a quiet hour
- [ ] Rider has no active ride; payment channel is cash, so no PayU involvement
- [ ] A read-only DB role and Redis reachable (tunnel). Queries run in `BEGIN READ ONLY` with a 15 s statement timeout; `NOISE=1` adds a scan per table and is off by default
- [ ] Tell finance/support: this creates one real completed ride, a cash payment row, a commission debit and a few SMS/push notifications
- After the run: delete `k6/prod-tokens.json` and `evidence/out/*/evidence.log` (phones, OTPs, live tokens)

How the scoped numbers work: DB rows count when a column links them to the rider, driver or ride id (and were created / updated after the before-timestamp); Redis keys count when an id appears as a `:`-separated segment of the key name. BullMQ queue job keys carry no user id, so queue writes are listed as "other activity", not as the test's. Tables with no linking column (reference data, config) are not counted. The scoped detection logic has run clean against an empty test DB and a local Redis, but not against real data yet.

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
    ├── main.js                     — the real test: booking_flow + live_tracking + rider_watch + admin_dashboard
    ├── spike.js                    — instant 0->N spike + recovery test (Task 1)
    ├── accept-race.js              — concurrency-correctness test for the ride-accept race (§8)
    ├── lifecycle.js                — full ride lifecycle, all ride types (§8b)
    ├── payments-webhook.js         — signed Razorpay webhook burst + idempotency (§8b)
    ├── reads.js                    — rider/driver home, earnings, wallet, notification reads (§8b)
    ├── admin-ops.js                — ops dashboard + analytics + finance reads (§8b)
    ├── auth.js                     — OTP login/refresh/logout storm, non-prod only (§8b)
    ├── realtime.js                 — GPS fan-out latency to rider + admin sockets (§8c)
    ├── queue-monitor.js            — BullMQ queue depth / pg pool / event-loop sampler (§8c)
    ├── daily-verification.js       — driver daily selfie + plate upload spike (§8c)
    ├── safety-writes.js            — profile, saved places, contacts, SOS, disputes (§8c)
    ├── payu-collections.js         — PayU order creation + webhook/return funnel (§8c)
    ├── lib/pair.js                 — shared book + assign + accept helper (§8c)
    └── lib/evidence.js             — EVIDENCE=1 request/response recorder (§8d)

evidence/                            — single-user evidence tooling (§8d): run.js, snapshot.js, report.js
```

---

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
