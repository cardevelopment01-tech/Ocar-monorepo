-- 069_add_angul_jajpur_paradip.sql seeded this row as name='Paradip',
-- slug='paradip'. The display name was later corrected to 'Paradeep' (the
-- official spelling — Paradeep Port, Paradeep Municipality) via the admin
-- panel, but the slug was left behind, so name and slug now disagree.
-- No route currently resolves cities by slug, so this is safe to align.

UPDATE cities
SET slug = 'paradeep'
WHERE slug = 'paradip';
