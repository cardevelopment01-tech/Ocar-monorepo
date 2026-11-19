-- Links the notification rows that broadcasts sent before 145 created, so the history can count them. Row locks only (no table lock).
-- Repeatable: a row already linked is skipped. Separate from 145 so its slow join does not run inside the ALTER TABLE's transaction.

-- Link the rows those earlier broadcasts created: same owner kind, type, title and body, written within 2 hours of the broadcast.
-- One row per broadcast and person (the lowest id), so the unique index below can never fail on a duplicate.
WITH match AS (
  SELECT DISTINCT ON (b.id, l.owner_id) l.id AS log_id, b.id AS broadcast_id
    FROM notification_broadcasts b
    JOIN notification_logs l
      ON l.channel = 'in_app'
     AND l.owner_type = CASE WHEN b.audience->>'role' = 'driver' THEN 'driver' ELSE 'user' END
     AND l.type = b.category
     AND l.title = b.title
     AND l.body = b.body
     AND l.created_at >= b.created_at
     AND l.created_at < b.created_at + interval '2 hours'
   WHERE l.broadcast_id IS NULL
     -- a row for this person is already linked (a repeat of this migration, or a duplicate row): leave the rest alone
     AND NOT EXISTS (SELECT 1 FROM notification_logs x WHERE x.broadcast_id = b.id AND x.owner_type = l.owner_type AND x.owner_id = l.owner_id)
   ORDER BY b.id, l.owner_id, l.id
)
UPDATE notification_logs l SET broadcast_id = match.broadcast_id FROM match WHERE l.id = match.log_id;
