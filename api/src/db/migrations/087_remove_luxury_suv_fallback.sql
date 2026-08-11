-- The fallback ladder was originally modeled as a uniform chain
-- (hatchback→sedan→suv→luxury), but the client's spec makes Luxury a hard
-- boundary: Hatchback, Luxury, and Van never participate in fallback, in
-- either direction. Only sedan←hatchback and suv←sedan should remain.
DELETE FROM category_fallback_rules
WHERE category_id = (SELECT id FROM vehicle_categories WHERE slug = 'luxury')
  AND accepts_category_id = (SELECT id FROM vehicle_categories WHERE slug = 'suv');
