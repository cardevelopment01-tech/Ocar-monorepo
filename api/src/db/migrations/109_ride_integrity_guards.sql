-- Ride integrity guards (analysis items B-01, B-08, B-09).
--
-- 1. Status transitions: the app moves a ride between statuses with compare-and-swap updates, but nothing at the
--    database level stopped an unconditional write from re-opening a finished ride or sliding it backwards (e.g.
--    POST /rides/:id/arrived on a completed ride). This trigger is the backstop: only the edges below are legal.
-- 2. One live ride per driver, and one live immediate ride per rider.

CREATE OR REPLACE FUNCTION enforce_ride_status_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status::text, NEW.status::text) IN (
    ('scheduled',      'requested'),
    ('scheduled',      'cancelled'),
    ('requested',      'accepted'),
    ('requested',      'cancelled'),
    ('requested',      'no_drivers'),
    ('no_drivers',     'requested'),   -- admin re-opens for manual assignment
    ('no_drivers',     'cancelled'),
    ('accepted',       'driver_arrived'),
    ('accepted',       'cancelled'),
    ('accepted',       'requested'),   -- force-assign grace revert / stale-accept sweep
    ('driver_arrived', 'in_progress'),
    ('driver_arrived', 'cancelled'),
    ('driver_arrived', 'requested'),
    ('in_progress',    'returning'),
    ('in_progress',    'completed'),
    ('in_progress',    'cancelled'),
    ('returning',      'completed'),
    ('returning',      'cancelled')
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'illegal ride status transition % -> % (ride %)', OLD.status, NEW.status, OLD.id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rides_status_transition_guard ON rides;
CREATE TRIGGER rides_status_transition_guard
  BEFORE UPDATE OF status ON rides
  FOR EACH ROW EXECUTE FUNCTION enforce_ride_status_transition();

-- A unique index fails to build if production already holds duplicates (typically orphaned rides the stale-ride
-- sweep has not resolved yet). Build each index only when it is safe, and WARN loudly otherwise so the migration
-- never blocks a deploy; the application-level checks still apply either way.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM rides
    WHERE driver_id IS NOT NULL AND status IN ('accepted', 'driver_arrived', 'in_progress', 'returning')
    GROUP BY driver_id HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'rides_one_live_per_driver_idx NOT created: drivers with more than one live ride exist. Resolve them, then create the index manually.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS rides_one_live_per_driver_idx
      ON rides (driver_id)
      WHERE driver_id IS NOT NULL AND status IN ('accepted', 'driver_arrived', 'in_progress', 'returning');
  END IF;

  -- Scheduled bookings stack on top of a live ride by design (see createBooking), so they are excluded.
  IF EXISTS (
    SELECT 1 FROM rides
    WHERE scheduled_for IS NULL AND status IN ('requested', 'accepted', 'driver_arrived', 'in_progress', 'returning')
    GROUP BY user_id HAVING COUNT(*) > 1
  ) THEN
    RAISE WARNING 'rides_one_live_per_user_idx NOT created: riders with more than one live immediate ride exist. Resolve them, then create the index manually.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS rides_one_live_per_user_idx
      ON rides (user_id)
      WHERE scheduled_for IS NULL AND status IN ('requested', 'accepted', 'driver_arrived', 'in_progress', 'returning');
  END IF;
END $$;
