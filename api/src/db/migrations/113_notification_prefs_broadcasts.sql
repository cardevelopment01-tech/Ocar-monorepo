-- Opt-outs for the two optional notification categories. A missing row means "on".
-- Everything else (ride updates, chat, payments, account alerts) is not stored and cannot be switched off.
CREATE TABLE notification_preferences (
  owner_type   TEXT NOT NULL CHECK (owner_type IN ('user', 'driver')),
  owner_id     BIGINT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('announcements', 'offers')),
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_type, owner_id, category)
);

-- One row per admin-sent broadcast: history, and the id the audit log points at.
CREATE TABLE notification_broadcasts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id        BIGINT NOT NULL REFERENCES admins(id),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('announcement', 'offer')),
  audience        JSONB NOT NULL,
  recipient_count INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
