-- A device whose app build created the loud 'ride_requests_v3' notification channel (custom long ring on the alarm
-- stream). Older builds only have 'ride_requests_v2'; a push naming a channel the app does not have falls to Android's
-- quiet fallback channel, so the server must pick the channel per device, never globally.
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS ride_alert_v3 BOOLEAN NOT NULL DEFAULT FALSE;
