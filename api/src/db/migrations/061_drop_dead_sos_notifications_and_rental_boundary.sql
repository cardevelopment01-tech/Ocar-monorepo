-- Two confirmed-dead pieces of schema, verified empty on the live dev DB
-- before writing this migration:
--
-- sos_notifications: scaffolded in 009_m7_safety.sql alongside sos_alerts,
-- but never wired to an INSERT anywhere in app code. SOS notifications
-- actually flow through the generic notificationsQueue -> notifications
-- worker -> notification_logs, same path every other notification type
-- uses. notification_channel/notification_delivery (its only two
-- consumers) are dropped with it.
--
-- cities.rental_boundary: the original geography boundary column from
-- 005_m3_geo.sql. Superseded by cities.boundary (geometry), which is the
-- column geo.repository.ts's findContainingCity() actually queries and
-- which rides.service.ts's trip classification depends on. rental_boundary
-- and its GiST index were never read anywhere.

DROP TABLE sos_notifications;
DROP TYPE notification_channel;
DROP TYPE notification_delivery;

DROP INDEX IF EXISTS cities_rental_boundary_gix;
ALTER TABLE cities DROP COLUMN rental_boundary;
