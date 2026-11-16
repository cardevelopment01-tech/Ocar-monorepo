-- A model's category comes from the model (vehicle_models.typical_category_id), seats from that category's max_passengers,
-- and now the fuel types the model is sold with. NULL = not restricted (every fuel allowed), so no existing model changes
-- behaviour until an admin fills it in.
ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS fuel_types text[];

-- Fuel type now decides which documents apply (an electric vehicle needs no permit/PUC), so a model whose name says it is
-- electric can only be electric. Everything else is left open for ops to fill in from the admin Brands & Models tab.
UPDATE vehicle_models
   SET fuel_types = ARRAY['electric']
 WHERE fuel_types IS NULL
   AND (name ~* '(^|\s)ev[0-9]*(\s|$)' OR name ILIKE '%electric%');

-- A driver who could not find their model in the list registers without one: an admin confirms the model and category.
ALTER TABLE driver_vehicles ADD COLUMN IF NOT EXISTS needs_model_review boolean NOT NULL DEFAULT false;
