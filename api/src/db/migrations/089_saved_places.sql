-- Passenger "Saved Places": Home + Work (at most one each) plus unlimited
-- custom "other" places. Feeds address+lat/lng into booking and surfaces as
-- quick-picks in destination search. No spatial query runs against this table,
-- so coordinates are plain DECIMAL, not PostGIS geography.

CREATE TABLE saved_places (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        VARCHAR(10) NOT NULL CHECK (kind IN ('home','work','other')),
  label       TEXT NOT NULL,
  address     TEXT NOT NULL,
  latitude    DECIMAL(10,7) NOT NULL,
  longitude   DECIMAL(10,7) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX saved_places_user_idx ON saved_places (user_id, created_at);

-- At most one Home and one Work per user; unlimited 'other'.
CREATE UNIQUE INDEX saved_places_one_home_idx ON saved_places (user_id) WHERE kind = 'home';
CREATE UNIQUE INDEX saved_places_one_work_idx ON saved_places (user_id) WHERE kind = 'work';

CREATE TRIGGER saved_places_updated_at BEFORE UPDATE ON saved_places
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
