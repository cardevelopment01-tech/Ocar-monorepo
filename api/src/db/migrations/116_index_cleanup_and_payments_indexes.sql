-- Index cleanup + the two missing payments-list indexes.
-- Evidence: load-tests/LARGE_DATA_QUERY_REPORT.xlsx (sheets "Problems & Fixes" F6, "Cleanup audit"); measured on a
-- 1,000,000-ride dataset. Tested on a local copy and re-checked read-only on production.
--
-- 1. ADD (payments list, 0.44 s -> ~1.5 ms; channel filter 0.14 s -> ~1.5 ms). The admin payments list orders by
--    created_at DESC and no index served it, so every page sorted all payments.
--    Plain CREATE INDEX (not CONCURRENTLY): migrate.ts wraps each file in BEGIN/COMMIT, which CONCURRENTLY cannot run
--    inside (same precedent as 057 and 100). Brief write lock on `payments` while each builds (a few seconds at
--    ~770k rows); deploy in a quiet window.
-- 2. DROP indexes that duplicate or are fully covered by another index on the same table, and two that no query reads.
--    Every drop of a "covered by" index is guarded: it only runs if the covering index exists and is valid, so a
--    partially-migrated database can never be left without an index it needs.
--    lock_timeout makes the migration fail fast (and the deploy retry) instead of queueing behind a long query.

SET LOCAL lock_timeout = '10s';

CREATE INDEX IF NOT EXISTS payments_created_idx
  ON payments (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS payments_channel_created_idx
  ON payments (channel, created_at DESC, id DESC);

DO $$
DECLARE
  d RECORD;
BEGIN
  FOR d IN
    SELECT * FROM (VALUES
      -- dropped index                       , index that fully covers it
      ('payments_ride_idx',                    'payments_ride_id_key'),                      -- duplicate of UNIQUE (ride_id)
      ('fare_snapshots_ride_idx',              'fare_snapshots_ride_id_key'),                -- subset of UNIQUE (ride_id)
      ('ratings_ride_idx',                     'ratings_ride_id_direction_key'),             -- prefix of UNIQUE (ride_id, direction)
      ('users_phone_idx',                      'users_phone_key'),                           -- duplicate of UNIQUE (phone)
      ('drivers_phone_idx',                    'drivers_phone_key'),                         -- duplicate of UNIQUE (phone)
      ('refresh_tokens_hash_idx',              'refresh_tokens_token_hash_key'),             -- subset of UNIQUE (token_hash)
      ('ride_stops_ride_seq_idx',              'ride_stops_ride_id_sequence_key'),           -- duplicate of UNIQUE (ride_id, sequence)
      ('driver_docs_driver_idx',               'driver_documents_driver_id_doc_type_key'),   -- prefix of UNIQUE (driver_id, doc_type)
      ('rating_tags_rating_idx',               'rating_tags_rating_id_tag_id_key'),          -- prefix of UNIQUE (rating_id, tag_id)
      ('idx_ride_eta_snapshots_ride_id',       'ride_eta_snapshots_ride_id_leg_key'),        -- prefix of UNIQUE (ride_id, leg)
      ('role_permissions_role_idx',            'role_permissions_pkey'),                     -- prefix of PRIMARY KEY (role, permission_id)
      ('vehicle_models_brand_idx',             'vehicle_models_brand_id_name_key'),          -- prefix of UNIQUE (brand_id, name)
      ('system_config_key_idx',                'system_config_key_key')                      -- subset of UNIQUE (key)
    ) AS t(dropped, covering)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
       WHERE c.relnamespace = 'public'::regnamespace AND c.relname = d.covering AND x.indisvalid
    ) THEN
      EXECUTE format('DROP INDEX IF EXISTS public.%I', d.dropped);
    END IF;
  END LOOP;
END $$;

-- Created in 007 and never read by any query (verified in the code and the migrations):
--  * ride_status_history_actor_idx: no query filters this table by actor without ride_id; the one that mentions actor
--    (rides.repository.ts, resolved_by) filters by ride_id and by admin/timeout, which this driver/admin-only partial
--    index could not serve anyway. ~126 MB at 4.4M rows and maintained on every ride status change.
--  * rides_origin_gix (GiST): "geo analytics" that was never built; nothing runs a spatial predicate on rides.origin.
--    ~62 MB and the costliest kind of index to maintain on insert.
DROP INDEX IF EXISTS public.ride_status_history_actor_idx;
DROP INDEX IF EXISTS public.rides_origin_gix;

-- ROLLBACK (run each statement on its own; plain CREATE INDEX also works):
--   DROP INDEX IF EXISTS payments_created_idx, payments_channel_created_idx;
--   CREATE INDEX payments_ride_idx ON payments (ride_id);
--   CREATE INDEX fare_snapshots_ride_idx ON fare_snapshots (ride_id) WHERE ride_id IS NOT NULL;
--   CREATE INDEX ratings_ride_idx ON ratings (ride_id);
--   CREATE INDEX users_phone_idx ON users (phone);
--   CREATE INDEX drivers_phone_idx ON drivers (phone);
--   CREATE INDEX refresh_tokens_hash_idx ON refresh_tokens (token_hash) WHERE revoked_at IS NULL;
--   CREATE INDEX ride_stops_ride_seq_idx ON ride_stops (ride_id, sequence);
--   CREATE INDEX driver_docs_driver_idx ON driver_documents (driver_id);
--   CREATE INDEX rating_tags_rating_idx ON rating_tags (rating_id);
--   CREATE INDEX idx_ride_eta_snapshots_ride_id ON ride_eta_snapshots (ride_id);
--   CREATE INDEX role_permissions_role_idx ON role_permissions (role);
--   CREATE INDEX vehicle_models_brand_idx ON vehicle_models (brand_id);
--   CREATE INDEX system_config_key_idx ON system_config (key) WHERE status = 'active';
--   CREATE INDEX ride_status_history_actor_idx ON ride_status_history (actor, actor_id, created_at) WHERE actor IN ('driver','admin');
--   CREATE INDEX rides_origin_gix ON rides USING gist (origin);
