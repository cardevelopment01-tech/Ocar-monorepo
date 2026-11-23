-- Internal notes on a ride, written by admins and never shown to riders or drivers.
-- Append-only on purpose: a note is a record of what the team knew and said, so there is no edit or delete.
CREATE TABLE ride_admin_notes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id     BIGINT NOT NULL REFERENCES rides(id),
  admin_id    BIGINT NOT NULL REFERENCES admins(id),
  note        TEXT   NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ride_admin_notes_ride_idx ON ride_admin_notes (ride_id, created_at);
