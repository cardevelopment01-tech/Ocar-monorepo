-- Minimum / recommended app versions per app + platform, served by GET /api/v1/app/version-policy and
-- enforced (426 UPGRADE_REQUIRED) on driver go-online/resume and rider booking by requireSupportedApp.
-- '0.0.0' = never prompt or block, so this migration changes no behaviour until an admin raises a value
-- on the System config page. is_public: these are served unauthenticated. DO NOTHING keeps edited values.
INSERT INTO system_config (key, value, is_public, description) VALUES
  ('app_update_enabled', 'true', true,
   'Kill switch for app update prompts and the 426 upgrade gate. Off: the version-policy endpoint always answers none and no request is blocked.'),
  ('app_update_rider_android_min',         '0.0.0', true, 'Rider app (Android) versions below this must update before booking.'),
  ('app_update_rider_android_recommended', '0.0.0', true, 'Rider app (Android) versions below this are asked to update (can dismiss).'),
  ('app_update_driver_android_min',         '0.0.0', true, 'Driver app (Android) versions below this must update before going online.'),
  ('app_update_driver_android_recommended', '0.0.0', true, 'Driver app (Android) versions below this are asked to update (can dismiss).'),
  ('app_update_rider_ios_min',         '0.0.0', true, 'Rider app (iOS) versions below this must update before booking.'),
  ('app_update_rider_ios_recommended', '0.0.0', true, 'Rider app (iOS) versions below this are asked to update (can dismiss).'),
  ('app_update_driver_ios_min',         '0.0.0', true, 'Driver app (iOS) versions below this must update before going online.'),
  ('app_update_driver_ios_recommended', '0.0.0', true, 'Driver app (iOS) versions below this are asked to update (can dismiss).')
ON CONFLICT (key) DO NOTHING;
