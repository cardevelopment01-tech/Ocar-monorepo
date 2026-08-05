-- The 'rourkela' row was originally created through the admin Cities form
-- (before 070_add_rourkela.sql ran) with name/state in all caps. 070's
-- ON CONFLICT (slug) DO NOTHING left it untouched, and 072 only fixed the
-- centroid. Normalize the remaining bad casing here.

UPDATE cities
SET name = 'Rourkela', state = 'Odisha'
WHERE slug = 'rourkela';
