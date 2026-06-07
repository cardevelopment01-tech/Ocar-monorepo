-- M03/M04: Vehicle lookup tables, driver_vehicles, driver_vehicle_documents

-- ─── Vehicle categories ───────────────────────────────────────────────────────
CREATE TABLE vehicle_categories (
  id              BIGSERIAL PRIMARY KEY,
  slug            VARCHAR(40) UNIQUE NOT NULL,
  display_name    VARCHAR(80) NOT NULL,
  max_passengers  SMALLINT NOT NULL DEFAULT 4,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Vehicle brands ──────────────────────────────────────────────────────────
CREATE TABLE vehicle_brands (
  id         BIGSERIAL PRIMARY KEY,
  name       VARCHAR(80) UNIQUE NOT NULL,
  logo_url   TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Vehicle models ──────────────────────────────────────────────────────────
CREATE TABLE vehicle_models (
  id                  BIGSERIAL PRIMARY KEY,
  brand_id            BIGINT NOT NULL REFERENCES vehicle_brands(id),
  name                VARCHAR(80) NOT NULL,
  typical_category_id BIGINT REFERENCES vehicle_categories(id),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand_id, name)
);

CREATE INDEX vehicle_models_brand_idx ON vehicle_models (brand_id);

-- ─── Driver vehicles ─────────────────────────────────────────────────────────
CREATE TABLE driver_vehicles (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id         BIGINT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  category_id       BIGINT REFERENCES vehicle_categories(id),
  brand_id          BIGINT REFERENCES vehicle_brands(id),
  model_id          BIGINT REFERENCES vehicle_models(id),
  vehicle_name      VARCHAR(100),
  model_year        SMALLINT,
  number_plate      VARCHAR(20) UNIQUE,
  color             VARCHAR(40),
  fuel_type         VARCHAR(20),
  seating_capacity  SMALLINT NOT NULL DEFAULT 4,
  luggage_capacity  SMALLINT NOT NULL DEFAULT 1,
  ac_availability   BOOLEAN NOT NULL DEFAULT true,
  status            vehicle_state NOT NULL DEFAULT 'pending',
  is_primary        BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_vehicles_driver_idx ON driver_vehicles (driver_id);
-- One primary (non-blacklisted) vehicle per driver
CREATE UNIQUE INDEX driver_vehicles_one_primary_idx
  ON driver_vehicles (driver_id)
  WHERE is_primary = true AND status != 'blacklisted';

-- ─── Driver vehicle documents ─────────────────────────────────────────────────
CREATE TABLE driver_vehicle_documents (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id      BIGINT NOT NULL REFERENCES driver_vehicles(id) ON DELETE CASCADE,
  doc_type        VARCHAR(30) NOT NULL,
  file_url        TEXT NOT NULL,
  doc_number      VARCHAR(80),
  status          doc_status NOT NULL DEFAULT 'pending',
  rejection_note  TEXT,
  valid_from      DATE,
  valid_until     DATE,
  reviewed_by     BIGINT REFERENCES admins(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, doc_type)
);

CREATE INDEX dvd_vehicle_doc_idx
  ON driver_vehicle_documents (vehicle_id, doc_type, created_at DESC);
CREATE INDEX dvd_pending_idx
  ON driver_vehicle_documents (created_at)
  WHERE status = 'pending';
