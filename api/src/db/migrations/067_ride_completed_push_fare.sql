-- The ride_completed push template never carried the settled fare amount,
-- unlike its SMS sibling (which already has {{fareStr}}) — this is why the
-- rider's push/in-app notification never mentioned the billed amount.
UPDATE notification_templates
SET body = 'Your ride is complete.{{fareStr}} Thank you for riding with Ocar!',
    variables_schema = '{"required": [], "optional": ["fareStr"]}',
    version = version + 1
WHERE slug = 'ride_completed' AND channel = 'push' AND is_active;
