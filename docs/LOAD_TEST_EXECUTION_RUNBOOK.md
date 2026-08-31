# Load Test — Execution Runbook

Operational, step-by-step. For *what* is being tested and *why* (scope,
thresholds, safety rules, client sign-off), see `LOAD_TEST_PLAN.md` — that
document is what the client approves; this one is what whoever runs the test
actually follows, in order, so no step gets skipped or forgotten.

Related: `docs/superpowers/specs/2026-08-14-staging-runbook.md` (how staging
itself gets provisioned — a prerequisite to everything below, not part of it).

---

## 0. Before you start — one-time prerequisites

Confirm all of these are true before running anything in this doc:

- [ ] Staging environment is up (`docs/superpowers/specs/2026-08-14-staging-runbook.md`
      steps 0-6 complete) — including the staging RDS instance restored from
      a production snapshot (same doc, step 3).
- [ ] `DATABASE_URL` you're about to use points at **staging**, not
      production. Double check this every single time — there is no
      programmatic safety net in these scripts that stops them from running
      against the wrong database.
- [ ] Grafana dashboards are confirmed receiving live metrics from staging
      (`LOAD_TEST_PLAN.md` §1/§6).
- [ ] `LOAD_TEST_PLAN.md` has been reviewed and approved by the client
      (§9 sign-off, including the driver-count amendment).
- [ ] Reserved-tag collision check — run against staging and confirm both
      return 0 before seeding anything:
      ```sql
      SELECT count(*) FROM users   WHERE phone LIKE '+919999%';
      SELECT count(*) FROM drivers WHERE phone LIKE '+918888%';
      ```
      If either is non-zero, stop — pick a different reserved block in the
      relevant script before proceeding (do not run against a colliding range).

---

## 1. One-time setup (run once, before the first live session)

Run in this order — each one has real dependencies on the one before it.

### 1a. Seed 1M historical rides

```bash
psql "$DATABASE_URL" -f api/scripts/seed-load-test-data.sql
```

- Requires at least one real active driver with an active primary vehicle
  already in the DB (true automatically on staging — it's a production
  snapshot). Aborts on its own preflight check if not.
- Takes ~3 minutes at full scale (verified locally). Expected final counts:
  1,000,000 rides / fare_snapshots, ~720,000 payments, ~180,000
  cancellations, ~4.28M status-history rows, ~1.1M ratings.
- Uses only **real** drivers — does not touch the driver-count gap below.

### 1b. Seed the synthetic driver top-up

```bash
psql "$DATABASE_URL" -f api/scripts/seed-load-test-drivers.sql
```

- Computes the gap itself at runtime (`400 - <real active driver count>`,
  target overridable with `-v target_concurrent_drivers=N`) — safe to run
  regardless of exactly how many real active drivers staging has.
- Creates driver + driver_vehicles + driver_wallets rows only. Does **not**
  create driver_sessions — going online happens live, during the ramp.

**Stop and verify before continuing:**
```sql
SELECT count(*) FROM drivers WHERE status = 'active';  -- should be >= 400 (or your target)
```

---

## 2. Same-day steps (run every live-test day, right before the session)

This step is not part of the one-time setup — **it expires daily** and must
be re-run on the actual calendar day of each live ramp session, shortly
before it starts.

```bash
psql "$DATABASE_URL" -f api/scripts/seed-load-test-daily-verification.sql
```

- Grants every active driver (real + synthetic) today's
  `driver_verifications` rows (`daily_selfie` + `daily_plate`,
  `auto_passed`) — without this, `goOnline()` rejects every single driver on
  the first call of the ramp, real ones included.
- Safe to re-run any number of times same day (`ON CONFLICT DO NOTHING`,
  mirrors the app's own idempotency).
- **Does not carry over to the next day.** If a live session is postponed or
  split across multiple days, re-run this each day before starting.

Confirm before going live:
```sql
SELECT count(*) FROM driver_verifications
WHERE verified_for = (now() AT TIME ZONE 'Asia/Kolkata')::date
  AND status = 'auto_passed';
-- expect 2x the active driver count (one selfie row + one plate row each)
```

---

## 3. Run the live session

Proceed to `LOAD_TEST_PLAN.md` §4 (ramp plan) and §7 (client involvement).
Nothing further from this runbook is needed until teardown.

---

## 4. Teardown (after testing is fully complete — not between individual sessions)

Each seed script prints its own cleanup SQL at the end of its run. In
dependency order (children before parents):

```sql
-- ride-seed cleanup (from seed-load-test-data.sql's own output)
DELETE FROM ratings WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '+919999%'));
DELETE FROM ride_cancellations WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '+919999%'));
DELETE FROM payments WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '+919999%'));
DELETE FROM ride_status_history WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '+919999%'));
DELETE FROM fare_snapshots WHERE ride_id IN (SELECT id FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '+919999%'));
DELETE FROM rides WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '+919999%');
DELETE FROM users WHERE phone LIKE '+919999%';

-- driver-seed cleanup (from seed-load-test-drivers.sql's own output)
-- driver_verifications rows age out naturally (date-scoped, never reused
-- past their day) — no explicit cleanup needed for those.
DELETE FROM driver_wallets WHERE driver_id IN (SELECT id FROM drivers WHERE phone LIKE '+918888%');
DELETE FROM driver_package_wallets WHERE driver_id IN (SELECT id FROM drivers WHERE phone LIKE '+918888%');
DELETE FROM driver_vehicles WHERE driver_id IN (SELECT id FROM drivers WHERE phone LIKE '+918888%');
DELETE FROM drivers WHERE phone LIKE '+918888%';
```

Then tear down the staging environment itself per
`docs/superpowers/specs/2026-08-14-staging-runbook.md` step 7 — staging is
provisioned on demand, not left running.

---

## Quick reference — what runs when

| Step | Script | Frequency |
|---|---|---|
| 1a | `seed-load-test-data.sql` | Once |
| 1b | `seed-load-test-drivers.sql` | Once |
| 2 | `seed-load-test-daily-verification.sql` | **Every test day**, right before the session |
| 4 | cleanup SQL above | Once, after all testing is done |
