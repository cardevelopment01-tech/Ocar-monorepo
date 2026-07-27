-- The ride_accepted SMS embedded the driver's raw phone number in plain text
-- (via {{driverPhoneSuffix}}), leaking it to the rider independent of the
-- app/socket masking fixed elsewhere in this plan.
UPDATE notification_templates
SET body = 'Ocar: {{driverName}} has accepted your ride and is on the way to pick you up.',
    variables_schema = '{"required": ["driverName"], "optional": []}',
    version = version + 1
WHERE slug = 'ride_accepted' AND channel = 'sms' AND is_active;
