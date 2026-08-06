-- Lets a driver's vehicle category also serve ride requests one tier below
-- it, raising eligible driver supply per ride when the exact category is
-- scarce. category_id = the driver's own vehicle category;
-- accepts_category_id = an additional rider-booked category that driver
-- category is eligible for. A category's own tier is always implicitly
-- eligible (enforced in application code, not stored here) — this table
-- only holds the extra accepted tier. `van` is intentionally excluded: it
-- doesn't sit on the hatchback→sedan→suv→luxury price ladder (016_seed.sql
-- prices van below both suv and luxury).

CREATE TABLE category_fallback_rules (
  category_id BIGINT NOT NULL REFERENCES vehicle_categories(id),
  accepts_category_id BIGINT NOT NULL REFERENCES vehicle_categories(id),
  PRIMARY KEY (category_id, accepts_category_id)
);

INSERT INTO category_fallback_rules (category_id, accepts_category_id)
SELECT s.id, h.id FROM vehicle_categories s, vehicle_categories h
WHERE s.slug = 'sedan' AND h.slug = 'hatchback';

INSERT INTO category_fallback_rules (category_id, accepts_category_id)
SELECT suv.id, sd.id FROM vehicle_categories suv, vehicle_categories sd
WHERE suv.slug = 'suv' AND sd.slug = 'sedan';

INSERT INTO category_fallback_rules (category_id, accepts_category_id)
SELECT l.id, suv.id FROM vehicle_categories l, vehicle_categories suv
WHERE l.slug = 'luxury' AND suv.slug = 'suv';
