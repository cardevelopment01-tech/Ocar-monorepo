# ADR-003: Monthly Range Partitioning for High-Volume Tables

**Status:** Accepted

## Context

Four tables accumulate rows at rates that make full-table operations (vacuums, index rebuilds, bulk deletes) increasingly slow over time:

| Table | Write rate | Monthly volume |
|---|---|---|
| `gps_tracks` | ~5 rows/second per active ride, ~90 rides/hour at scale | ~13.5M rows/month |
| `notification_logs` | ~8 notifications/ride, ~720 rides/day | ~175k rows/month |
| `user_activity_log` | ~20 events/session | ~600k rows/month |
| `driver_activity_log` | ~15 events/session | ~450k rows/month |

Without partitioning, a 2-year-old `gps_tracks` table would hold ~324M rows. `DELETE WHERE created_at < '2024-01-01'` on an unpartitioned table with that volume would lock rows, bloat dead tuples, require hours of autovacuum to reclaim space, and spike I/O for the entire duration.

## Decision

Use PostgreSQL's declarative range partitioning by `created_at` with monthly boundaries. Pre-create the next month's partition in the last week of each month via the `partition-creator` BullMQ processor job.

```sql
-- Example: gps_tracks partitioned by month
CREATE TABLE gps_tracks (
    id          BIGSERIAL,
    ride_id     BIGINT NOT NULL,
    driver_id   BIGINT NOT NULL,
    location    GEOGRAPHY(POINT, 4326) NOT NULL,
    speed_kmph  NUMERIC(5,2),
    accuracy_m  NUMERIC(7,2),
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE TABLE gps_tracks_2026_01
    PARTITION OF gps_tracks
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

## Why monthly, not daily or hash

**Not daily.** 365 partitions per year. PostgreSQL's partition pruning overhead scales with partition count. At 365 partitions, query planning cost for range scans that span multiple days becomes noticeable. Monthly gives 12 partitions/year, with negligible planning overhead.

**Not hash.** Hash partitioning distributes rows evenly but does not support range pruning. A query like `WHERE created_at BETWEEN '2026-01-01' AND '2026-01-31'` cannot prune hash partitions; it scans all of them. Range partitioning prunes to exactly the relevant month partition(s).

**Monthly is aligned with data retention.** The platform's data retention policy will archive/delete GPS data older than 12 months. Monthly partitions make this `DROP TABLE gps_tracks_2024_12`, a metadata-only operation that completes in milliseconds, reclaims space instantly, and requires no vacuum. A `DELETE` on an equivalent unpartitioned slice would take minutes and leave dead tuple bloat.

## DROP TABLE vs DELETE performance

| Operation | 13.5M rows | Time | Vacuum needed |
|---|---|---|---|
| `DROP TABLE gps_tracks_2025_01` | Full partition | <10ms | No |
| `DELETE FROM gps_tracks WHERE created_at < '2025-02-01'` | Same 13.5M rows | 5–20 min | Yes, then autovacuum |

The DROP approach is ~100,000× faster and has zero I/O impact on the live table.

## Partial indexes per partition

Each monthly partition gets its own GIST spatial index:

```sql
CREATE INDEX gps_tracks_2026_01_location_idx
    ON gps_tracks_2026_01 USING GIST (location);
```

PostgreSQL applies partition pruning before index lookup. A live-tracking query for `ride_id = 12345` in January 2026 only touches `gps_tracks_2026_01` and its index; it never reads February's partition or its index. This keeps spatial index size bounded to one month of data (~13.5M rows) regardless of total historical volume.

## Partition pre-creation

The `partition-creator` BullMQ processor runs on the 25th of each month and creates the following month's partition for each of the four tables. If the partition already exists (idempotent DDL), the job logs "skipped" and exits cleanly. This ensures the partition exists before the month starts, avoiding the ~5ms partition auto-creation overhead on the first write of the month.
