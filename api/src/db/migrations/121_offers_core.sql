-- 121_offers_core.sql
-- Offers & coupons core (docs/superpowers/plans/2026-11-03-offers-and-coupons.md, Task 1).
-- Additive only. Nothing reads these tables until offers_enabled is switched on (migration 123 seeds it 'false').
-- Statuses/kinds are TEXT + CHECK so a new value is one constraint swap, not an enum ALTER.

CREATE TABLE offers (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code               CITEXT NULL UNIQUE,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL CONSTRAINT offers_kind_check CHECK (kind IN ('code', 'auto', 'assigned')),
  status             TEXT NOT NULL DEFAULT 'draft'
                       CONSTRAINT offers_status_check CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  current_version_id BIGINT NULL,
  budget_total       NUMERIC(12,2) NULL CONSTRAINT offers_budget_total_nonneg CHECK (budget_total IS NULL OR budget_total >= 0),
  budget_spent       NUMERIC(12,2) NOT NULL DEFAULT 0,
  global_limit       INT NULL CONSTRAINT offers_global_limit_nonneg CHECK (global_limit IS NULL OR global_limit >= 0),
  redemption_count   INT NOT NULL DEFAULT 0,
  starts_at          TIMESTAMPTZ NULL,
  ends_at            TIMESTAMPTZ NULL,
  created_by         BIGINT NULL REFERENCES admins(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX offers_status_idx ON offers (status);

-- Economic fields live here and are never updated: a change inserts version N+1 (same principle as rate cards).
CREATE TABLE offer_versions (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id         BIGINT NOT NULL REFERENCES offers(id),
  version          INT NOT NULL,
  rules            JSONB NOT NULL DEFAULT '[]'::jsonb,
  benefit          JSONB NOT NULL,
  per_user_limit   INT NULL CONSTRAINT offer_versions_per_user_limit_pos CHECK (per_user_limit IS NULL OR per_user_limit > 0),
  stacking         TEXT NOT NULL DEFAULT 'exclusive' CONSTRAINT offer_versions_stacking_check CHECK (stacking IN ('exclusive', 'stackable')),
  funded_by        TEXT NOT NULL DEFAULT 'driver',
  display          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by       BIGINT NULL REFERENCES admins(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT offer_versions_offer_version_key UNIQUE (offer_id, version)
);

-- Deferred FK: offers is created before offer_versions.
ALTER TABLE offers
  ADD CONSTRAINT offers_current_version_fk FOREIGN KEY (current_version_id) REFERENCES offer_versions(id);

CREATE TABLE offer_redemptions (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  offer_id         BIGINT NOT NULL REFERENCES offers(id),
  offer_version_id BIGINT NOT NULL REFERENCES offer_versions(id),
  user_id          BIGINT NOT NULL REFERENCES users(id),
  ride_id          BIGINT NOT NULL REFERENCES rides(id),
  status           TEXT NOT NULL DEFAULT 'reserved'
                     CONSTRAINT offer_redemptions_status_check CHECK (status IN ('reserved', 'consumed', 'released', 'reversed')),
  discount_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  cashback_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  reserved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at      TIMESTAMPTZ NULL,
  released_at      TIMESTAMPTZ NULL,
  reason           TEXT NULL
);
-- One live redemption per ride. Enum-style equality, so the predicate is immutable.
CREATE UNIQUE INDEX offer_redemptions_ride_live_uniq ON offer_redemptions (ride_id) WHERE status IN ('reserved', 'consumed');
CREATE INDEX offer_redemptions_offer_status_idx ON offer_redemptions (offer_id, status);
CREATE INDEX offer_redemptions_reserved_idx ON offer_redemptions (reserved_at) WHERE status = 'reserved';

CREATE TABLE offer_user_usage (
  offer_id BIGINT NOT NULL REFERENCES offers(id),
  user_id  BIGINT NOT NULL REFERENCES users(id),
  count    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (offer_id, user_id)
);

-- Granted offers (welcome, referral, win-back). Created now; granting arrives in Phase 2.
CREATE TABLE user_offers (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  offer_id   BIGINT NOT NULL REFERENCES offers(id),
  source     TEXT NOT NULL CONSTRAINT user_offers_source_check CHECK (source IN ('signup', 'referral', 'admin', 'broadcast')),
  status     TEXT NOT NULL DEFAULT 'available' CONSTRAINT user_offers_status_check CHECK (status IN ('available', 'used', 'expired')),
  expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_offers_user_status_idx ON user_offers (user_id, status);

CREATE TRIGGER offers_set_updated_at BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
