-- rating_sum: running SUM(score) of all ratings received, so rating_avg can be
-- maintained incrementally (O(1) per new rating) instead of re-AVG-ing every
-- rating on each write. bigint holds SUM of SMALLINT scores without overflow.
ALTER TABLE drivers ADD COLUMN rating_sum bigint NOT NULL DEFAULT 0;
ALTER TABLE users   ADD COLUMN rating_sum bigint NOT NULL DEFAULT 0;

-- Backfill from existing ratings so rating_sum / total_ratings / rating_avg stay
-- consistent for rows that already have ratings.
UPDATE drivers d
SET rating_sum = COALESCE((SELECT SUM(score) FROM ratings WHERE to_driver_id = d.id), 0);
UPDATE users u
SET rating_sum = COALESCE((SELECT SUM(score) FROM ratings WHERE to_user_id = u.id), 0);
