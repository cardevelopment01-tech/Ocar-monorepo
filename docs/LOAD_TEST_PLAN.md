# Ocar — Load Test Plan (for review & sign-off)

This document describes what will be tested, on what environment, with what
data, in what order, and what "pass" means — for review and approval before
any test run starts. Nothing in this plan gets executed until it's signed
off.

---

## 1. Environment

**All testing runs against a dedicated AWS staging environment — never
locally, never against production.** Staging is built to be
infrastructure-identical to production (same instance type, same
auto-scaling configuration, same cache tier), specifically so the numbers
this test produces are numbers you can trust when sizing production —
testing against anything else (a laptop, a scaled-down environment) would
make the results invalid for that purpose.

Staging is provisioned on demand for this test and torn down afterward — it
is not a permanent environment.

- **Region:** same AWS region as production (Mumbai / `ap-south-1`)
- **Compute:** same instance type and Auto Scaling Group configuration as
  production
- **Database / Cache:** a dedicated staging RDS instance restored from a
  production snapshot (same engine, same instance class as production),
  and a separate cache instance — isolated from production data, but the
  same underlying database technology production actually runs (an earlier
  draft of this plan referenced a Neon branch; production runs RDS, so
  staging is provisioned the RDS-native way — a snapshot restore, not a
  branch — to keep the "infrastructure-identical" guarantee below actually
  true for the database tier too)
- **Monitoring:** Grafana dashboards attached and confirmed receiving live
  metrics before any test begins (see §6)

---

## 2. What's being tested

Two different questions, tested separately:

| Question | How it's tested |
|---|---|
| Does the system handle the expected concurrent traffic? (5,000-6,000 simultaneous connections, GPS pings every 3-5s per active driver, booking bursts) | Simulated traffic against staging, ramped up in stages (§4) |
| Does query performance hold up once the database holds realistic data volume (not just a handful of test rows)? | Staging seeded with ~1,000,000 historical ride records first, then the same queries the admin/analytics pages actually run are measured before and after that volume exists (§5) |

These are independent — a system can handle live traffic fine but slow down
on a specific query once a table is large, or vice versa. Both get checked.

---

## 3. Test data — what gets created, and what doesn't

Before any traffic is simulated, staging is seeded with:

- **Synthetic rider accounts** (clearly marked test data, not real users) —
  enough to represent the concurrent-user target.
- **Reuses real, already-onboarded active drivers** already in the staging
  database (not fabricated) — this exercises the actual driver-matching and
  vehicle/category logic instead of fake shortcuts.
- **~1,000,000 historical ride records** (with associated status history,
  fare calculations, and payment records), dated across the past 12 months,
  to give query-performance testing realistic volume to run against.

**Amendment (driver count):** production currently has ~200 active drivers,
short of the 400-driver concurrent target in §4. That target is a live-traffic
*infrastructure capacity* test (can the ALB/ASG/Socket.io/connection pool
handle 400 concurrent sessions with GPS pings every 3-5s) — the accounts
generating that traffic don't need to be real for that specific question, so
the historical-data rule above still stands for the 1M-row seed, but is
**not** extended to the live ramp. For §4 only: staging's ~200 real drivers
are supplemented with ~200 additional synthetic driver accounts, built the
same way as the synthetic riders (clearly tagged, own reserved
identifier range, deleted in the same cleanup pass) so they're never
confused with real driver data and never appear in the historical-seed
query-performance results above. Flagging this explicitly since it revises
the "reuse real drivers" rule as originally written — please re-confirm
you're comfortable with the split before the live session (§9).

**Safety:**
- All synthetic data is clearly tagged (reserved phone-number range for test
  riders) so it can never be confused with real user data.
- Real driver accounts are reused for matching realism, but nothing about a
  real driver's actual account, documents, or history is altered.
- All test bookings created during the traffic simulation are automatically
  cancelled/cleaned up as part of the same test run — nothing is left in a
  stuck or ambiguous state.
- A full cleanup step runs after every test session, and a database
  consistency check (§6) confirms nothing was left inconsistent.

---

## 4. Traffic ramp plan

Traffic is increased in stages — never straight to peak — so any issue
surfaces at a small, manageable scale first, not at the top.

| Step | Simulated drivers | Simulated riders | Bookings/min | What's being confirmed |
|---|---|---|---|---|
| 1 | 20 | 200 | 5 | Everything works end-to-end, no configuration issues |
| 2 | 100 | 1,000 | 10 | System handles moderate load without strain |
| 3 | 250 | 3,000 | 15 | Auto-scaling triggers correctly if it's going to |
| 4 (target) | 400 | 6,000 | 20 | The actual production target load |

Each step is run and observed before advancing to the next — ideally on
separate sessions, not all in one sitting. A short **dry run at 1 simulated
user** is run privately beforehand to confirm the scripts themselves work
correctly, before ever running at scale.

A separate **spike test** (instant surge from 0 to peak load in ~10 seconds,
then measuring recovery) is run after the ramp — this checks how the system
behaves under a sudden traffic spike, not just a gradual increase.

---

## 5. What's measured, and what counts as a pass

| Metric | Pass threshold |
|---|---|
| Request latency (95th percentile) | Under 500ms |
| Request error rate | Under 1% |
| WebSocket (live-tracking) connection failures | Below a fixed count, monitored throughout |
| Query performance after 1M-row seed vs. before | No more than 20% slower, and never past an absolute ceiling, on the 4 critical queries (admin rides list, driver ride history, ride creation, live driver matching) |

Additionally, a **data-correctness check** (not just speed) runs after every
test session — confirming no rides were left in a stuck state, no payment
records are inconsistent, and no driver was assigned a ride they were never
actually offered (a known past issue this specifically re-checks is not
reintroduced).

---

## 6. Reporting — what you receive after each test session

After every test run, before anything is called "passed," you will receive:

1. **The automated data-correctness check result** (pass/fail, with details
   on any violation found)
2. **A link/screenshot of the Grafana dashboard window** for that test's
   time range — showing what actually strained (or didn't): database
   connections, cache load, CPU credit balance, error rates
3. A short written comparison of what we expected to strain first vs. what
   actually did — this comparison, not just "it passed," is the real
   deliverable

Nothing is reported as "passed" without this evidence attached.

---

## 7. Your involvement

Operational sequencing for whoever runs the session (data seeding order,
same-day driver eligibility step, teardown) lives in
`docs/LOAD_TEST_EXECUTION_RUNBOOK.md` — this section covers what you'll
experience, not the internal steps.

Per our last call: **you will be present (live, watching) during the actual
test execution**, not just briefed on results afterward. This is by design —
the test is meant to be observed as it happens, not summarized after the
fact. We'll schedule the live session(s) once this plan is approved and
staging is confirmed ready.

Issues that surface *during* the live session are expected and are not a
sign of failure — they get classified out loud, in real time, into: a test
artifact (nothing to fix), a real but non-urgent bug (logged for later), or
a real capacity finding (exactly what this test exists to catch). Nothing
gets quietly re-run at a lower number to hide a problem.

---

## 8. Sequence of events (what happens, in order)

1. Staging environment provisioned in AWS (same region/shape as production)
2. Grafana dashboards confirmed receiving live metrics from staging
3. Test data seeded (§3)
4. Private dry run (1 simulated user) — confirms scripts work correctly
5. **This plan reviewed and approved by you** ← we are here
6. Live ramp session(s) with you present (§4, §7)
7. Spike test
8. Data-correctness check + Grafana evidence delivered after each session (§6)
9. Staging environment torn down once testing is complete

---

## 9. Sign-off

Please confirm:
- [ ] Environment approach (§1) — AWS staging (RDS snapshot restore),
      production-identical shape
- [ ] Test data approach (§3) — synthetic + reused real drivers, safety
      measures
- [ ] Driver-count amendment (§3) — ~200 real drivers topped up with ~200
      tagged synthetic drivers for the live ramp only, historical seed
      unaffected
- [ ] Ramp plan and thresholds (§4, §5)
- [ ] Reporting format (§6)
- [ ] Live session scheduling (§7)

Once approved, we'll confirm a date for the first live session.
