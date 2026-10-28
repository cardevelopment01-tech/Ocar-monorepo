-- Removes the report rollups added in 117. Their hourly REFRESH MATERIALIZED VIEW recomputed all rides every hour: at 10M rides on a
-- db.t4g.medium that was ~3.5 min of heavy reads (13 GB per view), DB CPU 7% -> 22-39% once an hour (measured 2026-10-28), growing with
-- the ride count. The Reports / Analytics pages now always read the raw tables (the same queries the rollup path fell back to, so the
-- numbers are identical). If admin reports get slow at real volume, bring back an INCREMENTAL rollup (see
-- docs/superpowers/plans/2026-10-28-report-rollups-removal.md), not a full refresh.
--
-- ROLLBACK: re-run the CREATE statements from 117_report_rollups.sql (data is rebuilt by the CREATE), and revert the code change.
-- Until the new image takes over, the OLD code may still read these views; its rollup path falls back to the raw queries on any error.
DROP MATERIALIZED VIEW IF EXISTS rpt_completed, rpt_driver, rpt_requested, rpt_heat, rpt_cancel, rpt_driver_req, rpt_offers;
DROP TABLE IF EXISTS rpt_rollup_meta;
