-- ============================================================
-- M06: PRICING & FARE TABLES
-- Versioned rate cards — never UPDATE, always INSERT new row
-- Reason: every fare_snapshot references the exact rate_card
-- row active at booking time. Updating destroys traceability.
-- ============================================================

-- ── TABLE: rate_cards ────────────────────────────────────────
-- One row per (category, ride_type) = active rate.
-- New rate = new row. Old row gets effective_to set.
-- Current rate = WHERE effective_to IS NULL
CREATE TABLE rate_cards (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id         BIGINT NOT NULL REFERENCES vehicle_categories(id),
  ride_type           ride_type NOT NULL,
  rate_per_km         NUMERIC(8,2) NOT NULL CHECK (rate_per_km > 0),
  rate_per_min        NUMERIC(8,2) NOT NULL CHECK (rate_per_min >= 0),
  min_fare            NUMERIC(8,2) NOT NULL CHECK (min_fare > 0),
  -- Return cab discounted rate (one_way only, NULL for others)
  return_rate_per_km  NUMERIC(8,2) NULL
    CHECK (return_rate_per_km IS NULL OR return_rate_per_km < rate_per_km),
  -- Hourly surcharge for round_trip (NULL for others)
  hour_rate           NUMERIC(8,2) NULL,
  effective_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to        TIMESTAMPTZ NULL,
  notes               TEXT NULL,
  -- NULL for system-seeded rates; set for admin-created rates
  created_by          BIGINT NULL REFERENCES admins(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Current rate lookup — max 15 rows (5 categories × 3 types)
CREATE UNIQUE INDEX rate_cards_current_idx
  ON rate_cards (category_id, ride_type)
  WHERE effective_to IS NULL;

-- Historical lookup for receipt reconstruction
CREATE INDEX rate_cards_history_idx
  ON rate_cards (category_id, ride_type, effective_from DESC);

-- ── TABLE: rate_card_history ──────────────────────────────────
-- Immutable audit log of every pricing change.
CREATE TABLE rate_card_history (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_card_id        BIGINT NOT NULL REFERENCES rate_cards(id),
  rate_per_km         NUMERIC(8,2) NOT NULL,
  rate_per_min        NUMERIC(8,2) NOT NULL,
  min_fare            NUMERIC(8,2) NOT NULL,
  return_rate_per_km  NUMERIC(8,2) NULL,
  hour_rate           NUMERIC(8,2) NULL,
  changed_by          BIGINT NULL REFERENCES admins(id),
  change_reason       TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rate_card_history_card_idx
  ON rate_card_history (rate_card_id, created_at DESC);

CREATE INDEX rate_card_history_admin_idx
  ON rate_card_history (changed_by, created_at DESC);

-- ── TABLE: stop_charges ───────────────────────────────────────
-- Per-stop fee per vehicle category.
CREATE TABLE stop_charges (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id           BIGINT NOT NULL UNIQUE REFERENCES vehicle_categories(id),
  charge_per_stop       NUMERIC(8,2) NOT NULL DEFAULT 0.00
    CHECK (charge_per_stop >= 0),
  applies_to_return_cab BOOLEAN NOT NULL DEFAULT false,
  updated_by            BIGINT NULL REFERENCES admins(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_stop_charges_updated_at
  BEFORE UPDATE ON stop_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── TABLE: rental_packages ────────────────────────────────────
-- Fixed packages at 10 km/hour ratio.
-- km_limit = duration_hours × 10 (enforced by CHECK)
CREATE TABLE rental_packages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id     BIGINT NOT NULL REFERENCES vehicle_categories(id),
  duration_hours  SMALLINT NOT NULL CHECK (duration_hours IN (1,2,4,6,8,10)),
  km_limit        INTEGER NOT NULL CHECK (km_limit = duration_hours * 10),
  package_fare    NUMERIC(10,2) NOT NULL CHECK (package_fare > 0),
  extra_per_km    NUMERIC(8,2)  NOT NULL CHECK (extra_per_km > 0),
  extra_per_min   NUMERIC(8,2)  NOT NULL CHECK (extra_per_min >= 0),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  updated_by      BIGINT NULL REFERENCES admins(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, duration_hours)
);

CREATE INDEX rental_packages_category_idx
  ON rental_packages (category_id)
  WHERE is_active;

CREATE TRIGGER trg_rental_packages_updated_at
  BEFORE UPDATE ON rental_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── TABLE: surge_events ───────────────────────────────────────
-- Time-bounded demand multiplier per city.
-- NULL category_id = applies to ALL categories in this city.
CREATE TABLE surge_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city_id       BIGINT NOT NULL REFERENCES cities(id),
  category_id   BIGINT NULL REFERENCES vehicle_categories(id),
  multiplier    NUMERIC(4,2) NOT NULL CHECK (multiplier BETWEEN 1.00 AND 5.00),
  reason        VARCHAR(120) NULL,
  status        surge_status NOT NULL DEFAULT 'scheduled',
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  CHECK (starts_at < ends_at),
  created_by    BIGINT NULL REFERENCES admins(id),
  cancelled_by  BIGINT NULL REFERENCES admins(id),
  cancelled_at  TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Is there surge in city X for category Y now?"
CREATE INDEX surge_events_active_city_idx
  ON surge_events (city_id, category_id, starts_at, ends_at)
  WHERE status = 'active';

-- Background job scanner: activate/expire scheduled events
CREATE INDEX surge_events_scheduled_idx
  ON surge_events (starts_at, ends_at)
  WHERE status IN ('scheduled', 'active');

CREATE TRIGGER trg_surge_events_updated_at
  BEFORE UPDATE ON surge_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── TABLE: fare_snapshots ─────────────────────────────────────
-- Frozen fare per ride. Populated by M07 when ride is booked.
-- ride_id FK added in M07 via ALTER TABLE (rides doesn't exist yet).
CREATE TABLE fare_snapshots (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id           BIGINT UNIQUE NULL,
  rate_card_id      BIGINT NULL REFERENCES rate_cards(id),
  rental_package_id BIGINT NULL REFERENCES rental_packages(id),
  ride_type         ride_type NOT NULL,
  is_return_cab     BOOLEAN NOT NULL DEFAULT false,
  surge_event_id    BIGINT NULL REFERENCES surge_events(id),
  surge_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.00
    CHECK (surge_multiplier BETWEEN 1.00 AND 5.00),
  -- Inputs (frozen at booking)
  estimated_km      NUMERIC(8,2) NOT NULL DEFAULT 0,
  estimated_min     NUMERIC(8,2) NOT NULL DEFAULT 0,
  stop_count        SMALLINT NOT NULL DEFAULT 0,
  trip_hours        SMALLINT NOT NULL DEFAULT 0,
  -- Actuals (set at trip end)
  actual_km         NUMERIC(8,2) NULL,
  actual_min        NUMERIC(8,2) NULL,
  overage_km        NUMERIC(8,2) NOT NULL DEFAULT 0,
  overage_min       NUMERIC(8,2) NOT NULL DEFAULT 0,
  -- Fare components
  base_fare         NUMERIC(10,2) NOT NULL DEFAULT 0,
  distance_fare     NUMERIC(10,2) NOT NULL DEFAULT 0,
  time_fare         NUMERIC(10,2) NOT NULL DEFAULT 0,
  stop_fare         NUMERIC(10,2) NOT NULL DEFAULT 0,
  hour_surcharge    NUMERIC(10,2) NOT NULL DEFAULT 0,
  overage_fare      NUMERIC(10,2) NOT NULL DEFAULT 0,
  surge_fare        NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Totals
  total_estimated   NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_final       NUMERIC(10,2) NULL,
  status            fare_status NOT NULL DEFAULT 'estimate',
  finalised_at      TIMESTAMPTZ NULL,
  disputed_at       TIMESTAMPTZ NULL,
  refund_amount     NUMERIC(10,2) NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX fare_snapshots_ride_idx
  ON fare_snapshots (ride_id)
  WHERE ride_id IS NOT NULL;

CREATE INDEX fare_snapshots_disputed_idx
  ON fare_snapshots (disputed_at)
  WHERE status = 'disputed';

CREATE TRIGGER trg_fare_snapshots_updated_at
  BEFORE UPDATE ON fare_snapshots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
