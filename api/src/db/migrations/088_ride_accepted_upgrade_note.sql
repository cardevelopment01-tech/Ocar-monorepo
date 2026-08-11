-- Appends an optional {{upgradeNote}} placeholder to the ride_accepted push
-- body. The worker always supplies upgradeNote (empty string when the
-- assigned vehicle matches the booked category, or a one-line note when it
-- doesn't) — see notifications.worker.ts's ride_accepted handler.
UPDATE notification_templates
SET body = '{{driverName}} has accepted your ride and is on the way.{{upgradeNote}}',
    variables_schema = '{"required": ["driverName"], "optional": ["upgradeNote"]}',
    version = version + 1
WHERE slug = 'ride_accepted' AND channel = 'push' AND is_active;
