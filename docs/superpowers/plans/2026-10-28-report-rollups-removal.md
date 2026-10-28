# Report rollups removed

Migration 117 added seven `rpt_*` materialized views so the Reports / Analytics pages would not scan the raw tables. Postgres can
only refresh a materialized view by recomputing all history, and the hourly `refresh_report_rollups` job did exactly that.

Measured 2026-10-28 on a `db.t4g.medium` (2 vCPU, 4 GB) with 10M rides: six views x 28-54 s, about 13 GB read per view, 3.5 min per
run. DB CPU went from 7% to 22-39% and read IOPS from 0 to 1,700 once an hour, cache hit rate 77.8%, and it grows with the ride
count. The 10M rides are synthetic test data; real volume is far smaller, where the raw queries are fast.

## What changed
* The rollup-aware read path (`analytics.rollup.ts`, the second half of `analytics.repository.ts`) and the refresh job are deleted.
  The functions the pages call keep their names and now run the former `...Raw` queries, so the numbers are unchanged.
* `server.ts` removes the leftover hourly repeat from Redis on boot (a BullMQ repeat survives a code change).
* The views are NOT dropped in this release: the migration check enforces expand/contract (no `DROP TABLE` while the previous
  release may still read it). They stay, stale and unused (about 40 MB). **Follow-up release:** a migration with
  `DROP MATERIALIZED VIEW IF EXISTS rpt_completed, rpt_driver, rpt_requested, rpt_heat, rpt_cancel, rpt_driver_req, rpt_offers;`
  and `DROP TABLE IF EXISTS rpt_rollup_meta;`.

## If reports get slow at real volume
Bring back an incremental rollup, not a full refresh: plain tables, recompute only recent IST days hourly (about 2 days, not 45; a
45-day window still took 296 s here), and a nightly rebuild for late corrections. A prototype
(tables + a SQL function `rpt_refresh(from_date)` that deletes and re-inserts the days >= from_date) matched the old views exactly
in a rolled-back sandbox on the 10M-ride data, but was not merged because its 45-day window was too slow.
Other options at larger scale: a read replica, or an analytics store fed by change data capture.

## Rollout / rollback
No migration, so nothing to run before the cutover. The old code's hourly job keeps running until the new image takes over, and the
new code never reads or refreshes the views. Rollback: revert this PR (the views are still there, only stale; the first hourly
refresh of the old code brings them current).
