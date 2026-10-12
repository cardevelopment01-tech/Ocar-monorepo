-- Batch 4 (analysis items P-02, P-04).
--
-- 1. gps_tracks had no DEFAULT partition, so any breadcrumb dated outside the pre-created months failed the whole
--    INSERT ("no partition of relation found"). That includes a missed monthly partition job at month rollover.
--    A default partition turns that hard failure into "rows land here until the partition exists".
--
--    The catch with a default partition: PostgreSQL refuses to CREATE a new month's partition while the default
--    still holds rows that belong to it. create_gps_partition() is therefore replaced so it first moves any such
--    rows out of the default partition, then creates the partition, then puts the rows back in the right place.
-- 2. Indexes for the new daily purge of refresh_tokens / otp_requests (both grew without bound).

CREATE TABLE IF NOT EXISTS gps_tracks_default PARTITION OF gps_tracks DEFAULT;

CREATE OR REPLACE FUNCTION create_gps_partition(
  year_val  INT,
  month_val INT
) RETURNS void AS $$
DECLARE
  partition_name TEXT;
  start_date     DATE;
  end_date       DATE;
BEGIN
  partition_name := format('gps_tracks_%s_%s',
    year_val,
    lpad(month_val::TEXT, 2, '0')
  );
  start_date := make_date(year_val, month_val, 1);
  end_date   := start_date + INTERVAL '1 month';

  -- Park any rows that already landed in the default partition for this month, so the CREATE below is allowed.
  CREATE TEMP TABLE IF NOT EXISTS _gps_default_rows (LIKE gps_tracks INCLUDING DEFAULTS) ON COMMIT DROP;
  TRUNCATE _gps_default_rows;
  WITH moved AS (
    DELETE FROM gps_tracks_default
    WHERE recorded_at >= start_date AND recorded_at < end_date
    RETURNING *
  )
  INSERT INTO _gps_default_rows SELECT * FROM moved;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I
       PARTITION OF gps_tracks
       FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );

  -- The location GiST index is intentionally NOT created for new partitions: nothing queries breadcrumbs
  -- spatially (billing reads them by ride_id + time), and a GiST insert is the most expensive part of every
  -- ping. Existing partitions keep theirs until they age out.
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (ride_id, recorded_at)',
    partition_name || '_ride_idx', partition_name
  );

  INSERT INTO gps_tracks OVERRIDING SYSTEM VALUE SELECT * FROM _gps_default_rows;

  RAISE NOTICE 'Created partition: %', partition_name;
END;
$$ LANGUAGE plpgsql;

CREATE INDEX IF NOT EXISTS refresh_tokens_expires_idx ON refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS refresh_tokens_revoked_idx ON refresh_tokens (revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS otp_requests_created_idx   ON otp_requests (created_at);
