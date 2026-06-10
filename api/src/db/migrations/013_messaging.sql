CREATE TABLE IF NOT EXISTS notification_logs (
  id                BIGSERIAL PRIMARY KEY,
  job_name          TEXT NOT NULL,
  recipient_phone   TEXT,
  channel           TEXT NOT NULL DEFAULT 'sms',
  status            TEXT NOT NULL DEFAULT 'pending',
  template_key      TEXT,
  payload           JSONB NOT NULL DEFAULT '{}',
  provider_response JSONB,
  error_message     TEXT,
  attempt_count     SMALLINT NOT NULL DEFAULT 1,
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_job_name
  ON notification_logs (job_name);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status
  ON notification_logs (status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
  ON notification_logs (created_at DESC);
