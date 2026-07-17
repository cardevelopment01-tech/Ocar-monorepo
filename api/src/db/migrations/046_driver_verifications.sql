-- ── TABLE: driver_verifications ──────────────────────────────────
-- Daily selfie + plate photo, required before a driver can go online
-- each day. verification_kind/verification_status enums already
-- exist (002_enums.sql) but were never wired to a table until now.
-- MVP: no ML/OCR service exists yet, so submissions are inserted
-- directly as 'auto_passed' — see driver-verification.service.ts.
-- override_by/override_note/overridden_at exist for a future admin
-- review flow; unused for now (no endpoint reads/writes them yet).
CREATE TABLE driver_verifications (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id      BIGINT NOT NULL REFERENCES drivers(id),
  vehicle_id     BIGINT NULL REFERENCES driver_vehicles(id),
  kind           verification_kind NOT NULL,
  verified_for   DATE NOT NULL,
  image_url      TEXT NOT NULL,
  status         verification_status NOT NULL DEFAULT 'pending',
  override_by    BIGINT NULL REFERENCES admins(id),
  override_note  TEXT NULL,
  overridden_at  TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind != 'daily_plate' OR vehicle_id IS NOT NULL)
);

-- One selfie per driver per day
CREATE UNIQUE INDEX driver_verif_selfie_daily_uniq
  ON driver_verifications (driver_id, verified_for)
  WHERE kind = 'daily_selfie';

-- One plate photo per VEHICLE per day (not per driver — a driver could
-- in principle operate different vehicles on different days)
CREATE UNIQUE INDEX driver_verif_plate_daily_uniq
  ON driver_verifications (vehicle_id, verified_for)
  WHERE kind = 'daily_plate';

-- "Has today's verification passed?" lookup — the hot query this feature runs
-- on every go-online attempt
CREATE INDEX driver_verif_today_idx
  ON driver_verifications (driver_id, verified_for, kind)
  WHERE status IN ('passed', 'auto_passed');

-- Admin review queue for any row left pending (should be empty in MVP —
-- monitoring/future-proofing, not an active queue yet)
CREATE INDEX driver_verif_pending_idx
  ON driver_verifications (created_at)
  WHERE status = 'pending';
