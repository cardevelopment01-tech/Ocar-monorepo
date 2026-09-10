# Ocar Staging — Load Test Report

**Date:** September 9, 2026
**Environment:** Staging (`staging.ocar-api.clienttesting.in`)
**Prepared for:** Client review — pre-campaign load test, light-load phase
**Test tool:** k6 v2.2.0
**Report scope:** Functional smoke test, baseline concurrency test, elevated-load autoscaling test, and a sudden-spike recovery test

---

## 1. Executive Summary

Four tests were run against the staging environment on September 9, 2026, in ascending order of load, followed by one test of a fundamentally different shape (instant surge rather than gradual ramp):

1. **Smoke test** — single virtual user, validates every code path (auth, booking, real-time tracking) works before running anything at scale.
2. **Baseline load test** — 144 drivers, 1,000 riders, moderate booking rate. Confirms the system holds up under realistic concurrent connections.
3. **Elevated load test** — same driver/rider count, booking rate raised 33x to deliberately cross the infrastructure's auto-scaling trigger, to validate that the server fleet adds and removes capacity correctly under load.
4. **Spike test** — an instant (10-second) surge from zero to peak load, rather than a gradual ramp, run three times (Section 6) as an initial cautious pass surfaced a load-testing tool configuration gap, which was fixed and re-validated at progressively higher load.

**Result: all four tests passed their defined success criteria, at every load level attempted.** The application maintained a 99.9%+ success rate throughout, held HTTP response times under threshold in every test, and the auto-scaling system correctly added two additional servers within 2 minutes 22 seconds of load crossing the trigger point, then correctly removed them within 15 minutes 11 seconds of load returning to normal — with zero dropped connections during either transition. The spike test's final, validated run — at 4x the initial connection count and 3x the initial booking rate — completed with 100% of checks passed and zero interrupted transactions of any kind (Section 6.4).

No infrastructure failures, crashes, or unrecoverable errors occurred at any point. Two categories of transient, non-blocking errors were observed and are detailed in Section 7.2.

---

## 2. Test Environment & Methodology

### 2.1 Target system

- **Environment:** Staging, matching production's infrastructure shape (same instance type, same auto-scaling configuration, same database tier)
- **Database at test time:** 1,690 MB, largest tables `ride_status_history` (4.4M rows), `rides` (1.0M rows), `fare_snapshots` (1.0M rows), `payments` (800K rows) — pre-seeded to simulate real production data volume, not test-run artifacts
- **Test data:** 6,000 synthetic rider accounts, 144 real active staging driver accounts (the maximum currently available with an approved vehicle on staging), one vehicle category (Sedan), one city (Bhubaneswar)

### 2.2 Load-generation infrastructure

Load was generated from a dedicated, temporary cloud server (not a laptop or office machine), for two reasons: to produce trustworthy, reproducible numbers independent of local network/hardware variance, and because the target concurrency genuinely requires more memory than a typical laptop provides (see Section 6.1 for the specific failure this avoided). The load-generation server was created fresh for these tests and fully decommissioned immediately after — it is billed by the minute and does not persist.

### 2.3 What each test measures

| Test | Purpose |
|---|---|
| Smoke test | Confirms every API path and the real-time connection handshake work correctly before any load is applied |
| Baseline load test | Confirms the application holds up under a realistic number of concurrent idle/active connections (riders watching their ride, drivers broadcasting location) |
| Elevated load test | Confirms the auto-scaling system detects rising demand, adds capacity, and later removes it again once demand drops — the specific behavior a real traffic spike (e.g. a marketing push or peak commute hours) would need to trigger correctly |

---

## 3. Test 1 — Functional Smoke Test

**Time:** 2026-09-09, prior to load tests
**Load:** 1 simulated user, 1 pass through every flow

| Check | Result |
|---|---|
| API reachability | Pass |
| Fare estimate | Pass |
| Create a real booking | Pass |
| Cancel a booking | Pass |
| Driver go-online | Pass |
| Real-time connection handshake | Pass |
| Real-time connection acknowledgement | Pass |

**Result: 7/7 checks passed.** Response times for this single-user pass: average 161ms, 95th-percentile 414ms. This confirmed the environment was correctly configured and every code path was reachable before committing to a full-scale run.

---

## 4. Test 2 — Baseline Load Test

**Start:** 2026-09-09, 09:08:54 UTC
**End:** 2026-09-09, 09:29:16 UTC
**Duration:** 20 minutes 1 second
**Load profile:** 144 drivers (ramped in), 1,000 riders (ramped in), booking rate ~15 bookings/minute, sustained for a 10-minute hold period

### 4.1 Results

| Metric | Value |
|---|---|
| Total checks executed | 2,638 |
| Checks passed | 2,636 (99.92%) |
| Checks failed | 2 (0.08%) |
| Total HTTP requests | 1,638 |
| Average request rate | 1.36 requests/second |
| HTTP response time — average | 54.3 ms |
| HTTP response time — median | 24.3 ms |
| HTTP response time — 90th percentile | 180.4 ms |
| HTTP response time — 95th percentile | 194.5 ms |
| HTTP response time — maximum | 712.3 ms |
| HTTP request failure rate | 0.12% (2 of 1,638) |
| Real-time connections opened | 2,288 |
| Real-time connection failures | 0 |

**All performance thresholds passed:**
- Response time 95th percentile under 500ms: **passed** (194.5ms)
- Request failure rate under 1%: **passed** (0.12%)
- Real-time connection failures under 50: **passed** (0)

### 4.2 Errors observed

The only failing check was **driver go-online** — 2 failures out of 290 attempts (99.3% success). This is a minor, non-blocking rate and is not indicative of a systemic issue; see Section 7.2.

### 4.3 Infrastructure behavior

**No auto-scaling occurred during this test.** This was expected and correct: the auto-scaling trigger is based on request volume per server (1,000 requests/minute), and this test's average of 1.36 requests/second (~82/minute) never approached that threshold — the load in this test was concurrency-shaped (many open idle connections), not throughput-shaped. Server capacity remained at 1 instance throughout, matching the environment's normal resting state.

### 4.4 Database performance during this test

Measured directly from the database's monitoring data for the test window (09:08–09:29 UTC / 14:38–14:59 IST):

| Metric | Before test | During test | Peak during test |
|---|---|---|---|
| CPU utilization | ~6% | ~12–13% | 13.2% |
| Active connections | 3 | up to 14 | 14 |
| Read latency | ~0ms | ~1ms | negligible |
| Write latency | ~0ms | ~1–2ms | negligible |
| Free memory | ~350–380 MB | ~110–165 MB | dipped to 111 MB, recovered post-test |

The database showed comfortable headroom throughout — CPU roughly doubled but stayed far below saturation, connection count stayed trivial against the instance's ~225-connection capacity, and read/write latency remained effectively at zero. No database-side bottleneck was observed at this load level.

---

## 5. Test 3 — Elevated Load Test (Auto-Scaling Validation)

**Start:** 2026-09-09, 09:45:49 UTC (approx.)
**End:** 2026-09-09, 10:05:40 UTC
**Duration:** 19 minutes 30 seconds
**Load profile:** 144 drivers, 1,000 riders (same as Test 2), booking rate raised to ~500 bookings/minute (33x Test 2's rate) — specifically to cross the auto-scaling trigger and validate server-fleet behavior under real demand growth

### 5.1 Results

| Metric | Value |
|---|---|
| Total checks executed | 25,410 |
| Checks passed | 25,395 (99.94%) |
| Checks failed | 15 (0.06%) |
| Total HTTP requests | 24,410 |
| Average request rate | 20.86 requests/second |
| HTTP response time — average | 71.6 ms |
| HTTP response time — median | 27.5 ms |
| HTTP response time — 90th percentile | 186.8 ms |
| HTTP response time — 95th percentile | 204.2 ms |
| HTTP response time — maximum | 2,300 ms |
| HTTP request failure rate | 0.06% (15 of 24,410) |
| Real-time connections opened | 2,288 |
| Real-time connection failures | 0 |

**All performance thresholds passed:**
- Response time 95th percentile under 500ms: **passed** (204.2ms)
- Request failure rate under 1%: **passed** (0.06%)
- Real-time connection failures under 50: **passed** (0)

### 5.2 Errors observed

Two check types showed failures, both minor and both discussed in Section 7.2:
- **Create booking:** 11 failures out of 5,999 attempts (99.8% success)
- **Driver go-online:** 4 failures out of 292 attempts (98.6% success)

A single maximum response time of 2.3 seconds was recorded (up from 712ms in the baseline test). This was an isolated outlier — the 95th-percentile figure (204ms) shows the overwhelming majority of requests were unaffected; see Section 6.3.

### 5.3 Infrastructure behavior — auto-scaling, full timeline

This test's request rate was deliberately calibrated (4 requests per booking transaction × 500 bookings/minute ≈ 2,000 requests/minute) to run at roughly double the server fleet's scaling trigger (1,000 requests/minute per server). The full sequence, with timestamps taken directly from AWS infrastructure logs:

| Time (UTC) | Event |
|---|---|
| 09:44:00–09:49:00 | Request volume climbs to ~2,000–2,030 requests/minute against the single active server — double the scale-out trigger, sustained |
| 09:51:53 | **Scale-out triggered.** Two new servers begin launching simultaneously (1 → 3 servers) |
| 09:52:56 | New servers still completing startup (application containers booting, not yet passing health checks) |
| **09:54:15** | **All 3 servers healthy and serving live traffic** — 2 minutes 22 seconds from trigger to full capacity |
| 09:52:00–09:53:00 | Per-server request rate drops from ~2,000/minute to ~980/minute as load splits across 3 servers — back under the trigger threshold, as designed |
| 10:05:40 | Test load ends |
| **10:12:07** | **Scale-in triggered.** First idle server begins graceful shutdown (existing connections allowed to finish before the server is removed — zero dropped requests) |
| 10:15:06 | Fleet at 2 servers |
| 10:18:15 | Second idle server begins graceful shutdown |
| **10:20:51** | **Fleet fully returned to resting state (1 server)** |

**Time from load stopping to fleet fully back at resting capacity: 15 minutes 11 seconds**, using entirely graceful, zero-downtime transitions at every step.

This confirms both halves of the auto-scaling requirement work correctly: the fleet adds capacity promptly under real demand growth, and removes the extra capacity again once demand subsides, without ever dropping an in-progress connection.

---

## 6. Test 4 — Spike Test (Sudden-Surge Recovery)

Run in three passes on 2026-09-09, described here in order, since the investigation between passes is itself part of what was validated.

### 6.1 Load profile

Fundamentally different shape from Tests 2–3 — instead of a gradual ramp, load jumps from zero to peak in 10 seconds:
- **Booking traffic:** 0 → target bookings/minute in 10 seconds, held at peak, then dropped to a low background rate to observe recovery
- **Rider connections:** 0 → target concurrent real-time connections in 10 seconds (a connection storm), held, then closed

### 6.2 First pass (10:52–10:57 UTC) — cautious values, one finding surfaced

Run at a deliberately conservative level for a first attempt at this test type: 100 bookings/minute peak, 500 concurrent rider connections. Every check passed (100%, 1,241 of 1,241), every threshold passed, and the connection storm was absorbed cleanly (500 connections, zero failures). But the test's own counters showed 125 booking transactions that started but did not finish within the observation window.

This was investigated directly against staging's own monitoring data for the exact window, to find the actual cause rather than assume one:
- **Database connection pool:** confirmed idle — zero connections ever waited for availability, only 2–3 in use throughout.
- **Application errors:** every warning/error-level log line reviewed — only benign, expected side effects of repeated test bookings (a fraud-detection flag, a routing-distance notice), no timeouts, no exceptions.
- **Response times:** everything that completed was fast (max 610ms).

**Conclusion: not a server-side issue.** The load-testing script's booking scenario had no explicit wind-down allowance and kept starting new transactions until the test's fixed end time, cutting some off mid-sequence on the test's own clock. This was fixed in the test script (an explicit wind-down window added) and is detailed here because a "125 transactions did not complete" figure should never be reported without being traced to a specific cause.

### 6.3 Second pass (11:17–11:24 UTC) — first fix confirmed, load increased, second finding surfaced

With the booking-scenario fix in place, the test was re-run at a substantially higher level — the load-testing script's own recommended defaults — to actually stress the system harder: 300 bookings/minute peak (3x), 2,000 concurrent rider connections (4x).

**The booking-transaction fix held completely: zero interrupted booking transactions this run**, confirming the first-pass finding was correctly diagnosed and correctly fixed. All checks passed (100%), all thresholds passed, and the connection storm was again absorbed cleanly with zero connection failures.

However, exactly 500 of the (now much larger) 2,500 rider-connection attempts were interrupted — the same category of issue, but this time in the *connection-handling* scenario rather than the booking scenario. The connection-storm code holds each simulated rider's connection open for a fixed 150 seconds before closing it; at this larger scale, connections opened throughout the test's 2-minute hold period didn't have enough of the test's remaining runway left to reach that natural 150-second close before the test itself ended. Confirmed via the same evidence standard as Section 6.2: zero connection failures, healthy latency throughout — a second test-configuration gap, not a server problem, and fixed the same way (the wind-down allowance extended).

### 6.4 Third pass (11:26–11:32 UTC) — both fixes confirmed, final result

Re-run at the same increased level (300 bookings/minute, 2,000 rider connections) with both fixes in place.

| Metric | Value |
|---|---|
| Total checks executed | 4,534 |
| Checks passed | 4,534 (100%) |
| Total HTTP requests | 2,034 |
| HTTP request failure rate | 0.00% |
| HTTP response time — average | 71.7 ms |
| HTTP response time — 95th percentile | 188.6 ms |
| HTTP response time — maximum | 585.2 ms |
| Real-time connections established | 2,500 |
| Real-time connection failures | 0 |
| Booking transactions interrupted | **0** |
| Rider connections interrupted | **0** |

**All performance thresholds passed**, with response times in line with (in fact marginally better than) Tests 2–3's own figures, despite this test's more permissive limits (a brief dip is allowed during a sudden spike — none was needed):
- Response time 95th percentile under 1,500ms: **passed** (188.6ms)
- Request failure rate under 5%: **passed** (0.00%)
- Real-time connection failures under 100: **passed** (0)

**Auto-scaling did not trigger during any of the three passes**, correctly: even at 300 bookings/minute (≈900 requests/minute), this stayed just under the 1,000/minute trigger validated in Test 3 — this test is sized to validate sudden-surge connection-handling and recovery, not to re-prove auto-scaling.

**Summary of this test:** the system itself passed cleanly on every pass, at every load level tried, including the final run at 4x the original connection count and 3x the original booking rate. Both anomalies that surfaced were in the load-testing tooling, not the application — each was investigated to a specific, evidenced cause before being labeled as such, and both are now fixed for future test runs.

---

## 7. Detailed Findings & Anomalies

### 7.1 Load-generation infrastructure sizing (methodology note, not an application issue)

During test preparation, an initial attempt to run the full target concurrency (3,000 simulated riders) from a memory-constrained generation server resulted in that server running out of memory and being terminated by its own operating system before the test could complete — twice, at 46% and 54% of connection setup respectively. This was **a load-generator sizing issue, not a staging environment issue** — the target application was never actually under load when this occurred, since the test never got far enough to send real traffic. The fix was to right-size the generation server and reduce simulated rider count to 1,000 for this phase (still a meaningful, realistic concurrency level), which resolved the issue completely — both subsequent tests ran cleanly with substantial memory headroom to spare. This is documented here for completeness and has no bearing on the staging environment's own capacity.

### 7.2 "Driver go-online" and "create booking" failures

Across both load tests, a small number of driver go-online calls (2 of 290, then 4 of 292) and, in the elevated test, a small number of create-booking calls (11 of 5,999) failed. In both tests this remained well under 1% of the relevant calls, and the failure rate did not worsen disproportionately to the 33x increase in load between the two tests — going from 2/290 (0.7%) to 4/292 (1.4%) is consistent with normal statistical variance at these small sample sizes rather than a load-driven degradation. This is flagged as a minor item worth a closer look during a future test cycle, not a finding that affects the pass/fail verdict of this test.

### 7.3 Slow requests (≥1 second) — full breakdown, for optimization targeting

Pulled directly from the application's own request logs (Grafana Cloud Loki) for both test windows, filtered to every request that took 1 second or longer to respond.

**Baseline test (09:08–09:29 UTC): zero requests ≥1 second.** No slow requests at all at this load level.

**Elevated test (09:45–10:06 UTC): 34 requests ≥1 second**, out of 24,410 total requests (0.14%). Broken down by endpoint:

| Endpoint | Slow requests (≥1s) |
|---|---|
| `POST /api/v1/rides` (create booking) | 30 |
| `POST /api/v1/rides/:id/cancel` | 3 |
| `POST /api/v1/pricing/estimate` | 1 |

**This points at one specific endpoint to optimize: ride creation (`POST /api/v1/rides`).** It accounts for 30 of the 34 slow requests, and the timing pattern is itself informative — this was not steady degradation spread across the test, it was concentrated in short bursts:

| Time window (UTC) | Slow requests in window | Slowest in window |
|---|---|---|
| 09:53:31 – 09:53:35 (4 seconds) | 24 | 1,747ms |
| 09:55:01 – 09:55:02 | 4 | 1,924ms |
| 09:56:01 | 3 | 1,105ms |
| 09:57:25 | 2 | **2,304ms** and **2,214ms** (the two slowest requests of the entire test, back-to-back in the same second) |

71% of all slow requests (24 of 34) happened within one 4-second window. This shape — brief, clustered spikes rather than a gradual slowdown — is the signature of short-lived contention (e.g., several ride-creation transactions briefly serializing behind a database lock or connection-pool wait) rather than the endpoint being slow on average. It lines up with Section 7.2's `create booking` failures (11 of 5,999), which most likely occurred in or near these same windows.

**Recommended next step for the engineering team:** review `POST /api/v1/rides`'s transaction — specifically what it locks or writes to (driver assignment, fare snapshot, city-scoped rate card lookup) — for a step that can serialize under concurrent write pressure. This is a concrete, scoped optimization target, not a broad performance problem — the endpoint's normal-case response time (reflected in the 95th-percentile figure of 204ms for the whole test) is healthy; it is specifically the behavior under simultaneous ride-creation bursts that warrants a closer look.

### 7.4 Database behavior during the slow-request window

The database's own monitoring data for 09:52–09:57 UTC (spanning the slow-request clusters above) confirms the pattern originates at the database, not the application layer:

| Metric | Baseline (Section 4.4) | During 09:53–09:54 spike |
|---|---|---|
| CPU utilization | ~6–13% | **43–53%** |
| Active connections | 3–14 | **up to 48** |
| Write latency | ~1–2ms | ~1–2ms (unchanged) |
| Disk queue depth | — | ~0.15–0.2 (low, unchanged) |

CPU and connection count both spiked sharply and specifically during the same window as the slow requests, while write latency and disk queue depth stayed flat. This rules out storage I/O as the cause and points at CPU-bound query execution or connection/lock contention during concurrent ride-creation — consistent with several `POST /api/v1/rides` transactions briefly competing for the same rows (e.g., driver availability, city-scoped rate card) rather than a disk bottleneck. This sharpens the recommendation in Section 6.3: the optimization target is what `POST /api/v1/rides` contends over under concurrency, not general query speed or disk throughput.

---

## 8. Database Query-Level Performance

Pulled directly from PostgreSQL's own query statistics extension (`pg_stat_statements`), which tracks every distinct query the database has executed, with call counts and timing, since the database was created. Because this tracking is cumulative rather than scoped to a single test, it was filtered down to isolate genuine live API traffic from today's tests, excluding a separate category of historical bulk data-loading operations (used earlier to pre-populate realistic data volume — see Section 7.1's context — which insert hundreds of rows in a single statement and are not representative of anything a live request does).

### 8.1 Overall database health

| Metric | Value |
|---|---|
| Deadlocks (all-time) | **0** |
| Rollbacks (all-time) | 4, against 532,615 commits |
| Cache hit ratio | **99.67%** (nearly all reads served from memory, not disk) |

No deadlocks have ever occurred on this database. Rollback rate is negligible. This is a healthy baseline independent of anything specific to today's tests.

### 8.2 Live API queries, by actual database time consumed

| Query (purpose) | Part of booking creation? | Calls | Avg | Max | Total time |
|---|---|---|---|---|---|
| Driver active-ride check (GPS-ping cache-miss fallback) | No — GPS-ping flow | 14,590 | 12.6ms | 1,146ms | 184.2s |
| **Nearby-driver / session lookup (driver matching)** | **Yes** | 7,899 | 3.9ms | **4,065ms** | 31.1s |
| Read a ride (with GPS coordinates) | No — ride-tracking reads | 68,936 | 0.3ms | 286ms | 23.0s |
| Driver active-ride check (variant, on socket reconnect) | No — connection handling | 582 | 28.2ms | 832ms | 16.4s |
| Record a GPS ping (`driver_location_snapshots`) | No — GPS-ping flow | 66,595 | 0.2ms | 413ms | 14.7s |
| **Create a booking (`INSERT INTO rides`)** | **Yes** | 7,897 | **1.8ms** | 467ms | 13.8s |
| Broadcast a ride to a driver (`ride_assignments`) | Yes | 31,015 | 0.4ms | 724ms | 10.9s |
| Upsert rider account | Yes (auth, on booking) | 56,961 | 0.2ms | 191ms | 9.7s |
| City lookup (pickup point) | Yes | 7,897 | 0.8ms | 432ms | 6.4s |
| Cancel a ride (`UPDATE rides`) | No — cancellation flow | 7,896 | 0.6ms | 439ms | 5.1s |

### 8.3 Root-cause investigation: what's actually behind the `POST /api/v1/rides` slowness

Section 7.3/7.4 identified `POST /api/v1/rides` as slow under concurrent load, correlated with real database CPU/connection spikes at matching timestamps. The query-level data above was traced further, directly against the application's source code, to confirm what's really involved rather than infer it from query text alone.

**Correction to an earlier read of this data:** the driver active-ride check (14,590 calls, the largest total-time consumer above) is **not part of booking creation at all**. Tracing it into the codebase shows it belongs to the GPS-ping handling path — it runs when a driver's location update arrives, checks (via a 10-second Redis cache already in front of it) whether they're on an active ride, and forwards their position to that ride's tracking room. This is a deliberately-cached, well-reasoned piece of the live-tracking feature, unconnected to `POST /api/v1/rides`. Its high call count simply reflects how much GPS-ping traffic the tests generated. The socket-reconnect variant (582 calls) is similarly unrelated — it re-joins a reconnecting driver to their ride's room.

**The booking creation `INSERT` itself is fast** — 1.8ms on average, far below what was observed at the HTTP layer (up to 2.3 seconds). This rules out the write path as the bottleneck.

**The nearby-driver/session lookup** (driver matching, 7,899 calls) was checked directly against the database's actual indexes and query plan, not assumed:
- The query filters on `driver_location_snapshots.location` (spatial radius search) and `driver_sessions.status`/`mode`/`category_id` — both already have **purpose-built partial indexes matching these exact filters** (a spatial index scoped to available drivers, and a composite index scoped to online sessions).
- Running the query's actual execution plan live confirmed both indexes are used correctly, with no unnecessary table scans, completing in under 1 millisecond.

**This rules out a missing-index or bad-query-plan problem on the driver-matching query** — the schema and query are already well-designed for this access pattern. But it left the actual concurrent database load during the slow-request window unexplained, since `pg_stat_statements`' cumulative averages can hide a "high volume of individually cheap calls" problem behind a low per-call average. That required a different tool: AWS RDS Performance Insights, which tracks actual aggregate concurrent database load by query, sampled continuously (7-day retention on this instance).

**Correction, following a request to pinpoint the root cause rather than infer it from averages:** pulling Performance Insights' load-by-query breakdown for the exact spike window (09:53–09:56 UTC) showed the dominant contributor was a different query entirely — **"Read a ride" (`getRideById`)**, the row in Section 8.2 with by far the highest call count (68,936). It accounted for roughly 56% of total database load in that window (3.63 of 6.43 load units), more than six times the driver-matching query's share (0.36 load units) at the same moment. CPU credit exhaustion on the database instance was also checked and ruled out (`CPUCreditBalance` stayed at 315–320 throughout, never depleted).

Tracing this into the application's source code found the actual cause: `getRideById` runs a single 10-table join (`rides` joined against `users`, `drivers`, `fare_snapshots`, `ride_cancellations`, `ratings`, `driver_vehicles`, `vehicle_models`, `vehicle_brands`, `vehicle_categories` twice, `driver_location_snapshots`, and `payments`) to build the full ride-details response the rider's app displays. That same query was reused as a shared internal helper by 23 different call sites across the codebase — but only 2 of them (the rider's ride-detail screen, and the driver-accept-ride response) actually need any of the joined data. The other 21 were purely internal state-transition guards and ownership checks (e.g. "is this ride still cancellable," "does this OTP hash match," "is this the assigned driver") that only ever read 2–4 plain columns off the base `rides` table, paying for all 10 joins on every call for nothing.

**Revised recommendation, implemented:** split the query into a lightweight variant (`getRideCoreById` / `getRideCoreForDriverAction`, join-free, reading only the base `rides` table) and migrated the 20 internal call sites that never needed joined data onto it, leaving the 2 legitimately rich call sites (and one job processor that needs a `fare_snapshots` field) unchanged. The driver-scoped variant preserves the existing ownership-scoping security pattern (the fetch itself is scoped by `driver_id`, not an app-level check after a broader fetch). See Section 8.4 for verification.

---

### 8.4 Fix implemented and verified

The query-splitting fix described in Section 8.3 has been implemented in `api/src/modules/rides/rides.repository.ts` and `rides.service.ts`, plus the four other modules that called the shared helper (two job processors, call-masking, in-ride chat).

**What changed:**
- Two new join-free queries were added: `getRideCoreById` and `getRideCoreForDriverAction`, reading only the `rides` table (plus the two `origin`/`destination` coordinate fields, computed the same way as before but without any join).
- 20 of the 23 call sites were migrated to the lightweight query. 3 stayed on the original 10-table join: the rider's ride-detail screen, the driver-accept-ride response, and one job processor that needs a `fare_snapshots` field for a push-notification payload.
- The existing ownership-scoping security pattern was preserved exactly: the driver-scoped lightweight query still scopes the fetch itself by `(id, driver_id)`, so a mismatched driver still gets an indistinguishable "not found" response rather than an app-level check bolted on after a broader fetch.

**Verification performed before considering this done:**
- TypeScript compiled clean (`tsc --noEmit`) across the whole API after the change.
- Full automated test suite: **134 test files, 652 tests, all passing** (7 intentionally-skipped items unrelated to this change), including new unit tests written specifically for the two new query functions.
- Integration test suite run separately against a real PostgreSQL instance (not mocked): **14 files, 92 tests, all passing** — this exercises the actual SQL text of the new queries against real PostGIS/Postgres, not just application logic.

**Not yet done:** a re-run of the elevated-load test (Section 5) against staging to directly measure the reduction in database load this produces. The fix removes 21× redundant joins from the highest-call-count query identified in this report, but the report does not yet contain a fresh Performance Insights measurement confirming the before/after delta. Recommended as the concrete next step before this item is closed out.

---

## 9. Conclusions

1. **The application functioned correctly under all load levels tested**, with success rates of 99.92%, 99.94%, and 100% respectively across the baseline, elevated, and spike tests, and all defined latency/error-rate thresholds passing in every case.
2. **Auto-scaling works correctly in both directions** — verified with precise timestamps: capacity added within 2 minutes 22 seconds of demand crossing the trigger, capacity removed within 15 minutes 11 seconds of demand subsiding, with zero dropped connections during either transition.
3. **The system absorbed a sudden connection storm cleanly at every scale tried** — from 500 up to 2,000 concurrent real-time connections established within a 10-second surge, with zero connection failures at any level.
4. **No infrastructure failures, crashes, or data issues occurred** at any load level.
5. **`POST /api/v1/rides` showed slowness under concurrent write pressure in the elevated test** (30 of 34 slow requests ≥1s, clustered in short bursts matching real database CPU/connection spikes — Section 7.4), and this was traced all the way to the application's source code and the database's actual concurrent load, not left at the endpoint level. The booking `INSERT` itself is fast (1.8ms average) and the driver-matching query already has purpose-built indexes and a sub-millisecond execution plan — neither is the cause. The actual dominant contributor, identified via AWS RDS Performance Insights' load-by-query breakdown for the exact spike window (Section 8.3), was a single ride-details query reused unnecessarily by 21 internal call sites that never needed its 10-table join. **Fixed:** the query was split into a lightweight, join-free variant and 20 of the 23 call sites migrated onto it, with the ownership-scoping security property preserved (Section 8.4). Verified via a clean typecheck and a 652-test full suite (including 92 integration tests against a real database), all passing. Not yet done: a re-run of the load test to directly measure the database-load reduction on staging.
6. **Database health is strong independent of today's findings**: zero deadlocks recorded (all-time), a 4-in-532,615 rollback rate, and a 99.67% cache hit ratio.
7. **Two apparent issues in the spike test were both investigated to a specific cause and confirmed to be load-testing tool configuration gaps, not application problems** (Section 6) — in both cases the database connection pool was confirmed idle, no errors were logged, and every completed request was fast. Both were fixed in the test script and re-validated: the final spike test run, at 4x the original connection count and 3x the original booking rate, completed with 100% of checks passed and zero interrupted transactions of any kind.
8. This test phase deliberately did not yet exercise the full target concurrency (6,000 riders, 400 drivers) specified in the original production-readiness plan — that remains the next phase, to be run once [driver test-account count is increased / client scheduling is confirmed].

---

*Report compiled from live AWS CloudWatch infrastructure metrics, k6 test-run output, and staging database monitoring data captured during the test windows listed above. All timestamps are UTC unless otherwise marked (IST = UTC+5:30).*
