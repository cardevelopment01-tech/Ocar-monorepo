-- Rourkela (Sundargarh district) — steel city (SAIL Rourkela Steel Plant),
-- ~340km NW of Bhubaneswar near the Jharkhand/Chhattisgarh border. Was only
-- ever a free-text label in apps/driver/src/lib/india-geo.ts's address
-- picker, never an actual serviceable city (no row in `cities` at all).
-- Adding it the same way as 069_add_angul_jajpur_paradip.sql: outstation
-- destination only, no rental boundary, matching how Puri originally shipped.

INSERT INTO cities (
  name, slug, state,
  centroid,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled
) VALUES (
  'Rourkela', 'rourkela', 'Odisha',
  ST_GeogFromText('SRID=4326;POINT(84.8536 22.2604)'),
  45, 'active', false, false
)
ON CONFLICT (slug) DO NOTHING;
