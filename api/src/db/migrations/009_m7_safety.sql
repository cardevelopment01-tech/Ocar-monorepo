-- Module M09: ratings, SOS, disputes, driver warnings
-- Enums (from 002_enums.sql):
--   rating_direction, tag_sentiment, tag_applies_to
--   sos_severity, sos_status, notification_channel, notification_delivery
--   dispute_type, dispute_initiator, dispute_status, dispute_outcome
--   evidence_type, evidence_upload_status, warning_category, warning_severity

-- ── ADD RATING COLUMNS TO DRIVERS + USERS ────────────────────────
ALTER TABLE drivers
  ADD COLUMN rating_avg    NUMERIC(3,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN total_ratings INTEGER      NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN rating_avg    NUMERIC(3,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN total_ratings INTEGER      NOT NULL DEFAULT 0;

-- ── RATING TAG DEFINITIONS ────────────────────────────────────────
CREATE TABLE rating_tag_definitions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tag_key     VARCHAR(50) UNIQUE NOT NULL,
  label       VARCHAR(80) NOT NULL,
  sentiment   tag_sentiment NOT NULL,
  applies_to  tag_applies_to NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RATINGS ──────────────────────────────────────────────────────
CREATE TABLE ratings (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id        BIGINT NOT NULL REFERENCES rides(id),
  direction      rating_direction NOT NULL,
  score          SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  from_user_id   BIGINT NULL REFERENCES users(id),
  from_driver_id BIGINT NULL REFERENCES drivers(id),
  to_user_id     BIGINT NULL REFERENCES users(id),
  to_driver_id   BIGINT NULL REFERENCES drivers(id),
  comment        TEXT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ride_id, direction)
);

CREATE INDEX ratings_ride_idx      ON ratings (ride_id);
CREATE INDEX ratings_to_driver_idx ON ratings (to_driver_id) WHERE to_driver_id IS NOT NULL;
CREATE INDEX ratings_to_user_idx   ON ratings (to_user_id)   WHERE to_user_id   IS NOT NULL;

-- ── RATING TAGS ───────────────────────────────────────────────────
CREATE TABLE rating_tags (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rating_id BIGINT NOT NULL REFERENCES ratings(id),
  tag_id    BIGINT NOT NULL REFERENCES rating_tag_definitions(id),
  UNIQUE (rating_id, tag_id)
);

CREATE INDEX rating_tags_rating_idx ON rating_tags (rating_id);

-- ── SOS ALERTS ────────────────────────────────────────────────────
CREATE TABLE sos_alerts (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id             BIGINT NOT NULL REFERENCES rides(id),
  triggered_by_user   BIGINT NULL REFERENCES users(id),
  triggered_by_driver BIGINT NULL REFERENCES drivers(id),
  severity            sos_severity NOT NULL DEFAULT 'medium',
  status              sos_status   NOT NULL DEFAULT 'triggered',
  location_lat        NUMERIC(10,7) NULL,
  location_lng        NUMERIC(10,7) NULL,
  notes               TEXT NULL,
  acknowledged_by     BIGINT NULL REFERENCES admins(id),
  acknowledged_at     TIMESTAMPTZ NULL,
  resolved_by         BIGINT NULL REFERENCES admins(id),
  resolved_at         TIMESTAMPTZ NULL,
  resolution_note     TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sos_alerts_ride_idx   ON sos_alerts (ride_id);
CREATE INDEX sos_alerts_status_idx ON sos_alerts (status, created_at DESC)
  WHERE status IN ('triggered', 'acknowledged', 'responding');

CREATE TRIGGER trg_sos_alerts_updated_at
  BEFORE UPDATE ON sos_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── SOS NOTIFICATIONS ─────────────────────────────────────────────
CREATE TABLE sos_notifications (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sos_alert_id BIGINT NOT NULL REFERENCES sos_alerts(id),
  channel      notification_channel NOT NULL,
  recipient    TEXT NOT NULL,
  delivery     notification_delivery NOT NULL DEFAULT 'sent',
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sos_notifications_alert_idx ON sos_notifications (sos_alert_id);

-- ── DISPUTES ──────────────────────────────────────────────────────
CREATE TABLE disputes (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id             BIGINT NOT NULL REFERENCES rides(id),
  initiator           dispute_initiator NOT NULL,
  initiated_by_user   BIGINT NULL REFERENCES users(id),
  initiated_by_driver BIGINT NULL REFERENCES drivers(id),
  type                dispute_type NOT NULL,
  description         TEXT NOT NULL,
  status              dispute_status NOT NULL DEFAULT 'open',
  priority            SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 5),
  assigned_to         BIGINT NULL REFERENCES admins(id),
  outcome             dispute_outcome NULL,
  outcome_note        TEXT NULL,
  sla_hours           SMALLINT NOT NULL DEFAULT 48,
  sla_due_at          TIMESTAMPTZ NOT NULL,
  resolved_at         TIMESTAMPTZ NULL,
  resolved_by         BIGINT NULL REFERENCES admins(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX disputes_ride_idx     ON disputes (ride_id);
CREATE INDEX disputes_status_idx   ON disputes (status, created_at DESC)
  WHERE status IN ('open', 'under_review', 'pending_info', 'escalated');
CREATE INDEX disputes_assigned_idx ON disputes (assigned_to)
  WHERE assigned_to IS NOT NULL;

CREATE TRIGGER trg_disputes_updated_at
  BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── DISPUTE EVIDENCE ──────────────────────────────────────────────
CREATE TABLE dispute_evidence (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispute_id         BIGINT NOT NULL REFERENCES disputes(id),
  uploaded_by_user   BIGINT NULL REFERENCES users(id),
  uploaded_by_driver BIGINT NULL REFERENCES drivers(id),
  uploaded_by_admin  BIGINT NULL REFERENCES admins(id),
  evidence_type      evidence_type NOT NULL,
  file_url           TEXT NOT NULL,
  status             evidence_upload_status NOT NULL DEFAULT 'available',
  description        TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dispute_evidence_dispute_idx ON dispute_evidence (dispute_id);

-- ── DISPUTE ACTIONS ───────────────────────────────────────────────
CREATE TABLE dispute_actions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispute_id  BIGINT NOT NULL REFERENCES disputes(id),
  admin_id    BIGINT NOT NULL REFERENCES admins(id),
  action_type VARCHAR(30) NOT NULL,
  note        TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dispute_actions_dispute_idx ON dispute_actions (dispute_id);

-- ── DRIVER WARNINGS ───────────────────────────────────────────────
CREATE TABLE driver_warnings (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id       BIGINT NOT NULL REFERENCES drivers(id),
  issued_by       BIGINT NOT NULL REFERENCES admins(id),
  category        warning_category NOT NULL,
  severity        warning_severity NOT NULL,
  description     TEXT NOT NULL,
  ride_id         BIGINT NULL REFERENCES rides(id),
  dispute_id      BIGINT NULL REFERENCES disputes(id),
  acknowledged_at TIMESTAMPTZ NULL,
  expires_at      TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_warnings_driver_idx ON driver_warnings (driver_id, created_at DESC);

-- ── FK: refunds.dispute_id → disputes ─────────────────────────────
ALTER TABLE refunds
  ADD CONSTRAINT fk_refunds_dispute
  FOREIGN KEY (dispute_id) REFERENCES disputes(id);

-- ── SEED: RATING TAG DEFINITIONS (17 tags) ────────────────────────
INSERT INTO rating_tag_definitions (tag_key, label, sentiment, applies_to, sort_order) VALUES
  ('safe_driving',     'Safe driving',     'positive', 'driver', 1),
  ('on_time',          'On time',          'positive', 'driver', 2),
  ('clean_vehicle',    'Clean vehicle',    'positive', 'driver', 3),
  ('friendly',         'Friendly',         'positive', 'both',   4),
  ('professional',     'Professional',     'positive', 'driver', 5),
  ('knew_route',       'Knew the route',   'positive', 'driver', 6),
  ('good_passenger',   'Good passenger',   'positive', 'user',   7),
  ('speeding',         'Speeding',         'negative', 'driver', 8),
  ('rude',             'Rude behaviour',   'negative', 'both',   9),
  ('dirty_vehicle',    'Dirty vehicle',    'negative', 'driver', 10),
  ('wrong_route',      'Took wrong route', 'negative', 'driver', 11),
  ('phone_distracted', 'Phone distracted', 'negative', 'driver', 12),
  ('late_arrival',     'Arrived late',     'negative', 'driver', 13),
  ('no_show',          'No show',          'negative', 'both',   14),
  ('overcharged',      'Overcharged',      'negative', 'driver', 15),
  ('polite',           'Polite',           'positive', 'user',   16),
  ('waited_patiently', 'Waited patiently', 'positive', 'driver', 17);
