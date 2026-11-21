-- 150_airport_toll.sql
-- Airport toll (client request): a flat charge added to the rider's fare once per ride when the trip enters an airport zone, paid on to the
-- driver (a pass-through: the platform takes its usual commission on the fare without the toll). The amount differs by vehicle category.
--
-- Zones are polygons drawn by an admin (never written by a migration, same rule as city boundaries). A zone has one amount per vehicle
-- category; a category with no row, or 0, pays nothing there. The rates in force are copied onto the ride at booking (toll_terms), so an
-- admin edit never reprices a ride in flight; NULL toll_terms = no toll applies (also every ride booked before this migration).
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS airport_zones (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(80) NOT NULL,
  boundary    geography(Polygon, 4326) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  BIGINT NULL REFERENCES admins(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS airport_zones_boundary_idx ON airport_zones USING GIST (boundary);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_airport_zones_updated_at') THEN
    CREATE TRIGGER trg_airport_zones_updated_at BEFORE UPDATE ON airport_zones
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS airport_toll_rates (
  zone_id      BIGINT NOT NULL REFERENCES airport_zones(id) ON DELETE CASCADE,
  category_id  BIGINT NOT NULL REFERENCES vehicle_categories(id),
  amount       NUMERIC(8,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (zone_id, category_id)
);

ALTER TABLE fare_snapshots
  ADD COLUMN IF NOT EXISTS toll_terms  JSONB        NULL,
  ADD COLUMN IF NOT EXISTS toll_charge NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS toll_detail JSONB        NULL;

COMMENT ON COLUMN fare_snapshots.toll_terms IS 'Airport toll rates copied at booking: [{zone_id, name, amount}] for the ride''s vehicle category. NULL = none apply.';
COMMENT ON COLUMN fare_snapshots.toll_charge IS 'Rupees of airport toll charged, recorded at settlement; added to the final fare and paid on to the driver.';
COMMENT ON COLUMN fare_snapshots.toll_detail IS 'The zones that were entered and what each charged: [{zone, amount}].';

-- Audit trail: every change to a zone or its tolls, with who made it and the reason they gave. zone_id is not a foreign key so the
-- history of a deleted zone survives it.
CREATE TABLE IF NOT EXISTS airport_zone_changes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zone_id     BIGINT NOT NULL,
  zone_name   VARCHAR(80) NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  changed_by  BIGINT NULL REFERENCES admins(id),
  reason      TEXT NOT NULL,
  summary     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS airport_zone_changes_created_idx ON airport_zone_changes (created_at DESC);
