-- ============================================================
-- M07: BOOKING & RIDES TABLES
-- Central module — references all previous modules
-- ============================================================

-- ── DRIVER SESSIONS ──────────────────────────────────────────
-- One row = one online period for a driver.
-- Mode locked at session creation.
-- To change mode: go offline, create new session.
CREATE TABLE driver_sessions (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id             BIGINT NOT NULL REFERENCES drivers(id),
  vehicle_id            BIGINT NOT NULL REFERENCES driver_vehicles(id),
  category_id           BIGINT NOT NULL REFERENCES vehicle_categories(id),
  mode                  drive_mode NOT NULL,
  status                session_state NOT NULL DEFAULT 'online',
  -- Return cab mode only — NULL for standard
  destination_city_id   BIGINT NULL REFERENCES cities(id),
  -- GPS at go-online time
  origin_lat            DECIMAL(10,7) NULL,
  origin_lng            DECIMAL(10,7) NULL,
  went_online_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  went_on_trip_at       TIMESTAMPTZ NULL,
  went_offline_at       TIMESTAMPTZ NULL,
  -- driver_choice | admin_forced | timeout | system
  offline_reason        VARCHAR(40) NULL,
  trips_completed       SMALLINT NOT NULL DEFAULT 0,
  earnings_this_session DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active session per driver at a time
CREATE UNIQUE INDEX driver_sessions_one_active_idx
  ON driver_sessions (driver_id)
  WHERE status IN ('online', 'on_trip');

-- Hottest index — hit on every user search
CREATE INDEX driver_sessions_live_mode_idx
  ON driver_sessions (mode, status, category_id)
  WHERE status = 'online';

-- Return cab matching index
CREATE INDEX driver_sessions_return_city_idx
  ON driver_sessions (destination_city_id, category_id)
  WHERE mode = 'return_cab' AND status = 'online';

CREATE TRIGGER trg_driver_sessions_updated_at
  BEFORE UPDATE ON driver_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── DRIVER SESSION HISTORY ────────────────────────────────────
CREATE TABLE driver_session_history (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id    BIGINT NOT NULL REFERENCES driver_sessions(id),
  driver_id     BIGINT NOT NULL REFERENCES drivers(id),
  from_state    session_state NULL,
  to_state      session_state NOT NULL,
  -- driver | system | admin | ride_completion
  triggered_by  VARCHAR(20) NOT NULL,
  ride_id       BIGINT NULL,
  -- FK to rides added after rides table created below
  note          TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_session_history_session_idx
  ON driver_session_history (session_id, created_at DESC);

CREATE INDEX driver_session_history_driver_idx
  ON driver_session_history (driver_id, created_at DESC);

-- ── DRIVER LOCATION SNAPSHOTS ─────────────────────────────────
-- ONE ROW PER DRIVER — upserted every 30s from Redis flush.
-- Not append-only. Always current location only.
-- GPS history = gps_tracks (M05). This = current position.
CREATE TABLE driver_location_snapshots (
  -- PK = driver_id (one row per driver, always)
  driver_id     BIGINT PRIMARY KEY REFERENCES drivers(id),
  session_id    BIGINT NULL REFERENCES driver_sessions(id),
  -- PostGIS geography point
  location      geography(Point, 4326) NOT NULL,
  heading       DECIMAL(5,2) NULL,
  speed_kmph    DECIMAL(5,2) NULL,
  -- GPS device timestamp — used for out-of-order rejection
  recorded_at   TIMESTAMPTZ NOT NULL,
  is_available  BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GiST spatial index — powers ST_DWithin matching
-- Partial: only available drivers — THE CORE MATCHING INDEX
CREATE INDEX driver_location_snapshots_gix
  ON driver_location_snapshots USING gist (location)
  WHERE is_available = true;

CREATE INDEX driver_location_snapshots_session_idx
  ON driver_location_snapshots (session_id)
  WHERE session_id IS NOT NULL;

-- ── RETURN CAB ROUTES ─────────────────────────────────────────
-- PostGIS LineString corridor per return_cab session.
-- Partial GiST keeps index bounded by online fleet only.
CREATE TABLE return_cab_routes (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id            BIGINT NOT NULL REFERENCES driver_sessions(id),
  driver_id             BIGINT NOT NULL REFERENCES drivers(id),
  origin_lat            DECIMAL(10,7) NOT NULL,
  origin_lng            DECIMAL(10,7) NOT NULL,
  destination_lat       DECIMAL(10,7) NOT NULL,
  destination_lng       DECIMAL(10,7) NOT NULL,
  -- PostGIS LineString from origin to destination
  corridor              geography(LineString, 4326) NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT true,
  deactivated_at        TIMESTAMPTZ NULL,
  -- session_ended | trip_completed | admin
  deactivation_reason   VARCHAR(40) NULL,
  match_radius_metres   INTEGER NOT NULL DEFAULT 2000,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GiST on corridor — powers ST_DWithin corridor matching
CREATE INDEX return_cab_routes_corridor_gix
  ON return_cab_routes USING gist (corridor)
  WHERE is_active = true;

CREATE UNIQUE INDEX return_cab_routes_session_active_idx
  ON return_cab_routes (session_id)
  WHERE is_active = true;

-- ── RIDES ─────────────────────────────────────────────────────
-- THE central table. 7-state lifecycle.
CREATE TABLE rides (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id               BIGINT NOT NULL REFERENCES users(id),
  driver_id             BIGINT NULL REFERENCES drivers(id),
  session_id            BIGINT NULL REFERENCES driver_sessions(id),
  vehicle_id            BIGINT NULL REFERENCES driver_vehicles(id),
  category_id           BIGINT NOT NULL REFERENCES vehicle_categories(id),
  ride_type             ride_type NOT NULL,
  is_return_cab         BOOLEAN NOT NULL DEFAULT false,
  status                ride_status NOT NULL DEFAULT 'requested',
  -- PostGIS geography points
  origin                geography(Point, 4326) NOT NULL,
  destination           geography(Point, 4326) NULL,
  origin_address        TEXT NULL,
  destination_address   TEXT NULL,
  origin_city_id        BIGINT NULL REFERENCES cities(id),
  destination_city_id   BIGINT NULL REFERENCES cities(id),
  -- Book for someone else
  rider_phone           VARCHAR(20) NULL,
  rider_name            VARCHAR(50) NULL,
  -- Ride-type specific
  trip_hours            SMALLINT NULL,
  rental_package_id     BIGINT NULL REFERENCES rental_packages(id),
  scheduled_for         TIMESTAMPTZ NULL,
  -- OTP hashes (raw OTP never stored)
  start_otp_hash        TEXT NULL,
  end_otp_hash          TEXT NULL,
  -- State transition timestamps
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at           TIMESTAMPTZ NULL,
  driver_arrived_at     TIMESTAMPTZ NULL,
  started_at            TIMESTAMPTZ NULL,
  completed_at          TIMESTAMPTZ NULL,
  cancelled_at          TIMESTAMPTZ NULL,
  -- GPS actuals (set at trip end)
  actual_distance_km    NUMERIC(8,2) NULL,
  actual_duration_min   NUMERIC(8,2) NULL,
  -- SOS
  sos_triggered         BOOLEAN NOT NULL DEFAULT false,
  sos_triggered_at      TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User ride history
CREATE INDEX rides_user_idx
  ON rides (user_id, requested_at DESC);

-- Driver ride history
CREATE INDEX rides_driver_idx
  ON rides (driver_id, requested_at DESC)
  WHERE driver_id IS NOT NULL;

-- HOTTEST operational index — dispatch queries
CREATE INDEX rides_active_idx
  ON rides (status, requested_at)
  WHERE status IN ('requested','accepted','driver_arrived','in_progress');

-- Advance booking scheduler
CREATE INDEX rides_scheduled_idx
  ON rides (scheduled_for)
  WHERE scheduled_for IS NOT NULL AND status = 'requested';

-- SOS monitoring
CREATE INDEX rides_sos_idx
  ON rides (sos_triggered_at)
  WHERE sos_triggered = true;

-- GiST on origin for geo analytics
CREATE INDEX rides_origin_gix
  ON rides USING gist (origin);

CREATE TRIGGER trg_rides_updated_at
  BEFORE UPDATE ON rides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Wire deferred FKs now that rides exists
ALTER TABLE fare_snapshots
  ADD CONSTRAINT fk_fare_snapshots_ride
  FOREIGN KEY (ride_id) REFERENCES rides(id);

ALTER TABLE driver_session_history
  ADD CONSTRAINT fk_session_history_ride
  FOREIGN KEY (ride_id) REFERENCES rides(id)
  ON DELETE SET NULL;

-- ── RIDE STATUS HISTORY ───────────────────────────────────────
CREATE TABLE ride_status_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id     BIGINT NOT NULL REFERENCES rides(id),
  from_status ride_status NULL,
  to_status   ride_status NOT NULL,
  actor       transition_actor NOT NULL,
  actor_id    BIGINT NULL,
  note        TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ride_status_history_ride_idx
  ON ride_status_history (ride_id, created_at);

CREATE INDEX ride_status_history_actor_idx
  ON ride_status_history (actor, actor_id, created_at)
  WHERE actor IN ('driver','admin');

-- ── RIDE ASSIGNMENTS ──────────────────────────────────────────
-- Broadcast fan-out. One row per driver offer per ride.
-- First to accept wins. All others → cancelled.
CREATE TABLE ride_assignments (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id         BIGINT NOT NULL REFERENCES rides(id),
  driver_id       BIGINT NOT NULL REFERENCES drivers(id),
  session_id      BIGINT NOT NULL REFERENCES driver_sessions(id),
  status          assignment_status NOT NULL DEFAULT 'offered',
  offered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  responded_at    TIMESTAMPTZ NULL,
  cancelled_at    TIMESTAMPTZ NULL,
  broadcast_round SMALLINT NOT NULL DEFAULT 1,
  driver_lat      DECIMAL(10,7) NULL,
  driver_lng      DECIMAL(10,7) NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Driver's incoming request (hottest query on this table)
CREATE INDEX ride_assignments_driver_open_idx
  ON ride_assignments (driver_id, offered_at)
  WHERE status = 'offered';

-- Cancel all open offers when driver accepts
CREATE INDEX ride_assignments_ride_open_idx
  ON ride_assignments (ride_id, status)
  WHERE status = 'offered';

-- Analytics
CREATE INDEX ride_assignments_ride_idx
  ON ride_assignments (ride_id, broadcast_round);

-- ── RIDE STOPS ────────────────────────────────────────────────
CREATE TABLE ride_stops (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id               BIGINT NOT NULL REFERENCES rides(id),
  sequence              SMALLINT NOT NULL CHECK (sequence > 0),
  location              geography(Point, 4326) NOT NULL,
  address               TEXT NULL,
  status                stop_status NOT NULL DEFAULT 'pending',
  reached_at            TIMESTAMPTZ NULL,
  stop_charge_applied   NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ride_id, sequence)
);

CREATE INDEX ride_stops_ride_seq_idx
  ON ride_stops (ride_id, sequence);

-- ── RIDE OTP EVENTS ───────────────────────────────────────────
CREATE TABLE ride_otp_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id         BIGINT NOT NULL REFERENCES rides(id),
  otp_type        ride_otp_type NOT NULL,
  -- generated | verified | failed | expired
  event           VARCHAR(20) NOT NULL,
  actor_ip        VARCHAR(45) NULL,
  actor_role      VARCHAR(10) NULL,
  attempt_number  SMALLINT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ride_otp_events_ride_idx
  ON ride_otp_events (ride_id, otp_type, created_at);

CREATE INDEX ride_otp_events_failed_idx
  ON ride_otp_events (created_at)
  WHERE event = 'failed';

-- ── RIDE CANCELLATIONS ────────────────────────────────────────
CREATE TABLE ride_cancellations (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id                 BIGINT NOT NULL UNIQUE REFERENCES rides(id),
  actor                   cancel_actor NOT NULL,
  stage                   cancel_stage NOT NULL,
  cancelled_by_user_id    BIGINT NULL REFERENCES users(id),
  cancelled_by_driver_id  BIGINT NULL REFERENCES drivers(id),
  cancelled_by_admin_id   BIGINT NULL REFERENCES admins(id),
  reason                  TEXT NULL,
  reason_code             VARCHAR(40) NULL,
  fee_applicable          BOOLEAN NOT NULL DEFAULT false,
  fee_amount              NUMERIC(8,2) NOT NULL DEFAULT 0.00,
  fee_waived              BOOLEAN NOT NULL DEFAULT false,
  fee_waived_by           BIGINT NULL REFERENCES admins(id),
  fee_waived_reason       TEXT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ride_cancellations_actor_stage_idx
  ON ride_cancellations (actor, stage, created_at DESC);

CREATE INDEX ride_cancellations_driver_idx
  ON ride_cancellations (cancelled_by_driver_id, created_at)
  WHERE cancelled_by_driver_id IS NOT NULL;

-- ── SPEED ALERT LOG ───────────────────────────────────────────
CREATE TABLE speed_alert_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id     BIGINT NOT NULL REFERENCES rides(id),
  driver_id   BIGINT NOT NULL REFERENCES drivers(id),
  speed_kmph  NUMERIC(5,2) NOT NULL CHECK (speed_kmph > 0),
  limit_kmph  SMALLINT NOT NULL CHECK (limit_kmph > 0),
  excess_kmph NUMERIC(5,2) GENERATED ALWAYS AS (speed_kmph - limit_kmph) STORED,
  location    geography(Point, 4326) NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX speed_alert_log_ride_idx
  ON speed_alert_log (ride_id, created_at);

CREATE INDEX speed_alert_log_driver_idx
  ON speed_alert_log (driver_id, created_at DESC);

CREATE INDEX speed_alert_log_excess_idx
  ON speed_alert_log (excess_kmph, created_at)
  WHERE excess_kmph > 20;
