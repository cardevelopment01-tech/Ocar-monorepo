-- Exotel call masking: a small rented pool of virtual numbers (ExoPhones),
-- reused across rides via allocate-on-accept / release-on-end, plus a
-- self-tracked spend ledger so we never depend on an unconfirmed Exotel
-- balance API to know when to stop.

CREATE TABLE exotel_number_pool (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  virtual_number  VARCHAR(20) UNIQUE NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'allocated', 'disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exotel_number_pool_status_idx ON exotel_number_pool (status);
CREATE TRIGGER exotel_number_pool_updated_at BEFORE UPDATE ON exotel_number_pool
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ride_call_masks (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id           BIGINT NOT NULL REFERENCES rides(id),
  pool_number_id    BIGINT NOT NULL REFERENCES exotel_number_pool(id),
  virtual_number    VARCHAR(20) NOT NULL,
  driver_phone      VARCHAR(20) NOT NULL,
  rider_phone       VARCHAR(20) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'released')),
  call_count        SMALLINT NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ NOT NULL,
  released_at       TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One active mask per ride at a time.
CREATE UNIQUE INDEX ride_call_masks_active_ride_idx ON ride_call_masks (ride_id) WHERE status = 'active';
CREATE INDEX ride_call_masks_expires_idx ON ride_call_masks (expires_at) WHERE status = 'active';
CREATE TRIGGER ride_call_masks_updated_at BEFORE UPDATE ON ride_call_masks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE exotel_call_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_call_mask_id BIGINT NOT NULL REFERENCES ride_call_masks(id),
  call_sid      VARCHAR(64) UNIQUE NOT NULL,
  call_status   VARCHAR(20) NULL,
  duration_sec  INTEGER NULL,
  price_inr     NUMERIC(8,2) NULL,
  raw_payload   JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exotel_call_events_created_idx ON exotel_call_events (created_at);
CREATE INDEX exotel_call_events_mask_idx ON exotel_call_events (ride_call_mask_id);

INSERT INTO system_config (key, value, value_type, description, is_public) VALUES
  ('exotel_masking_enabled', 'false', 'boolean', 'Kill switch for masked calling — off until Exotel credits are loaded and verified end-to-end', false),
  ('exotel_call_time_limit_seconds', '600', 'integer', 'Hard cap on a single masked call''s duration (Connect API TimeLimit)', false),
  ('exotel_max_calls_per_ride', '5', 'integer', 'Max masked-call attempts allowed per ride, to blunt repeat-dial abuse', false),
  ('exotel_daily_budget_inr', '500', 'integer', 'Daily masked-call spend ceiling in INR — crossing it disables masking until an admin re-enables it', false);
