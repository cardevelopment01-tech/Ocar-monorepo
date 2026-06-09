-- ============================================================
-- M05: GEO & LOCATION TABLES
-- PostGIS 3.4 — geography type (WGS84 ellipsoid)
-- All spatial columns use geography not geometry
-- Reason: geography uses WGS84 — accurate in metres at
-- Indian latitudes. geometry flat-plane math drifts 1-5%.
-- ============================================================

-- ── ENUMS ────────────────────────────────────────────────────
-- city_status already in 002_enums.sql — do not recreate
-- zone_type already in 002_enums.sql — do not recreate

-- ── TABLE: cities ────────────────────────────────────────────
CREATE TABLE cities (
  id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                      VARCHAR(120) NOT NULL,
  slug                      VARCHAR(50)  UNIQUE NOT NULL,
  state                     VARCHAR(80)  NOT NULL,
  -- PostGIS geography column — city centre point
  -- Used for "nearest city" in return_cab destination selection
  centroid                  geography(Point, 4326) NOT NULL,
  -- Optional polygon for rental boundary
  -- NULL until admin draws it
  -- ST_Covers check fires when driver exits during rental
  rental_boundary           geography(Polygon, 4326) NULL,
  -- Speed limit fallback when no city_zone matches
  default_speed_limit_kmph  SMALLINT NOT NULL DEFAULT 50,
  status                    city_status NOT NULL DEFAULT 'draft',
  is_rental_enabled         BOOLEAN NOT NULL DEFAULT false,
  is_return_cab_enabled     BOOLEAN NOT NULL DEFAULT false,
  created_by                BIGINT NULL REFERENCES admins(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GiST index on centroid — powers "find nearest city"
-- Partial: only active cities
CREATE INDEX cities_centroid_gix
  ON cities USING gist (centroid)
  WHERE status = 'active';

-- GiST index on rental_boundary — powers ST_Covers check
CREATE INDEX cities_rental_boundary_gix
  ON cities USING gist (rental_boundary)
  WHERE rental_boundary IS NOT NULL AND status = 'active';

-- B-tree index for admin listing by status
CREATE INDEX cities_status_idx ON cities (status, name);

-- updated_at trigger
CREATE TRIGGER trg_cities_updated_at
  BEFORE UPDATE ON cities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── TABLE: city_zones (COMMENTED OUT — Phase 2) ──────────────
-- Speed-limit sub-polygons inside a city.
-- Phase 1 uses cities.default_speed_limit_kmph as fallback.
-- Uncomment in Phase 2 when per-road speed zones are needed.
-- CREATE TABLE city_zones (
--   id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--   city_id           BIGINT NOT NULL REFERENCES cities(id),
--   name              VARCHAR(80) NOT NULL,
--   zone_type         zone_type NOT NULL,
--   boundary          geography(Polygon, 4326) NOT NULL,
--   speed_limit_kmph  SMALLINT NOT NULL,
--   priority          SMALLINT NOT NULL DEFAULT 0,
--   is_active         BOOLEAN NOT NULL DEFAULT true,
--   created_by        BIGINT NULL REFERENCES admins(id),
--   created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
--   updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
-- );
-- CREATE INDEX city_zones_boundary_gix
--   ON city_zones USING gist (boundary) WHERE is_active;

-- ── TABLE: gps_tracks ────────────────────────────────────────
-- Per-trip breadcrumb trail.
-- RANGE PARTITIONED BY recorded_at (monthly).
-- WHY partitioned?
--   ~450k rows/day at 500 trips × 30s interval
--   = 13.5M rows/month
--   Without partitioning: VACUUM struggles, DELETE is catastrophic
--   With partitions: DROP TABLE gps_tracks_2026_01 = instant
-- WHY no FK on ride_id?
--   PG FK checks on partitioned parent require full-table lock
--   on each insert. At 450k/day that contention is unacceptable.
--   Application enforces integrity (only valid ride_ids written).
CREATE TABLE gps_tracks (
  id              BIGINT GENERATED ALWAYS AS IDENTITY,
  ride_id         BIGINT       NOT NULL,
  driver_id       BIGINT       NOT NULL REFERENCES drivers(id),
  session_id      BIGINT       NOT NULL,
  -- PostGIS geography point — WGS84 GPS coordinates
  location        geography(Point, 4326) NOT NULL,
  heading         DECIMAL(5,2) NULL,     -- compass 0.00-359.99
  speed_kmph      DECIMAL(5,2) NULL,     -- from GPS device
  accuracy_metres DECIMAL(6,1) NULL,     -- GPS accuracy
  -- GPS DEVICE timestamp — partition key
  -- App rejects out-of-order pings using this
  recorded_at     TIMESTAMPTZ  NOT NULL,
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Helper function to create monthly partition
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

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I
       PARTITION OF gps_tracks
       FOR VALUES FROM (%L) TO (%L)',
    partition_name, start_date, end_date
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I USING gist (location)',
    partition_name || '_location_gix', partition_name
  );

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (ride_id, recorded_at)',
    partition_name || '_ride_idx', partition_name
  );

  RAISE NOTICE 'Created partition: %', partition_name;
END;
$$ LANGUAGE plpgsql;

-- Create partitions for current month + next 3 months
DO $$
DECLARE
  base_date DATE := date_trunc('month', now())::DATE;
  i         INT;
BEGIN
  FOR i IN 0..3 LOOP
    PERFORM create_gps_partition(
      EXTRACT(YEAR  FROM base_date + (i || ' months')::INTERVAL)::INT,
      EXTRACT(MONTH FROM base_date + (i || ' months')::INTERVAL)::INT
    );
  END LOOP;
END;
$$;

-- ── TABLE: place_geocode_cache ────────────────────────────────
-- Caches Maps API geocoding responses.
-- WHY: Google Geocoding ≈ $5/1,000 requests.
-- At 5,000 trips/day = ~$50/day ($1,500/month) if uncached.
-- Cache TTL = 90 days. Popular pickup points hit cache always.
CREATE TABLE place_geocode_cache (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  normalized_address  TEXT UNIQUE NOT NULL,
  raw_address         TEXT NULL,
  -- Geocoded coordinates as PostGIS geography
  location            geography(Point, 4326) NOT NULL,
  -- Also store as plain numbers for quick access
  latitude            DECIMAL(10, 7) NOT NULL,
  longitude           DECIMAL(10, 7) NOT NULL,
  provider            VARCHAR(30) NOT NULL DEFAULT 'google',
  raw_response        JSONB NULL,
  hit_count           INTEGER NOT NULL DEFAULT 1,
  last_hit_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '90 days'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary cache lookup index
CREATE UNIQUE INDEX geocode_cache_address_idx
  ON place_geocode_cache (normalized_address);

-- GiST for reverse geocoding (pin-drop on map)
CREATE INDEX geocode_cache_location_gix
  ON place_geocode_cache USING gist (location);

-- Cleanup job target — plain index, no predicate (now() is STABLE not IMMUTABLE)
CREATE INDEX geocode_cache_expiry_idx
  ON place_geocode_cache (expires_at);

-- ── DEFERRED FK: driver_sessions.destination_city_id → cities ─
-- Added here because cities didn't exist when driver_sessions
-- was created. Skipped if table doesn't exist yet (M07).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'driver_sessions'
  ) THEN
    ALTER TABLE driver_sessions
      ADD CONSTRAINT fk_driver_sessions_destination_city
      FOREIGN KEY (destination_city_id)
      REFERENCES cities(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- ── DEFERRED FK: rides origin/destination city → cities ───────
-- Same pattern — rides table is created in M07.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'rides'
  ) THEN
    ALTER TABLE rides
      ADD CONSTRAINT fk_rides_origin_city
      FOREIGN KEY (origin_city_id)
      REFERENCES cities(id)
      ON DELETE SET NULL;

    ALTER TABLE rides
      ADD CONSTRAINT fk_rides_destination_city
      FOREIGN KEY (destination_city_id)
      REFERENCES cities(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;
