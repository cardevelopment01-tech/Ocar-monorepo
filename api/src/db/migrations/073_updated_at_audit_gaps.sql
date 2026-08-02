-- Audit gap fix: these tables are mutated after creation (confirmed by grepping every
-- UPDATE against them in api/src) but never got an updated_at column + trigger.
-- Tables considered and excluded because no UPDATE path exists anywhere in the codebase
-- (INSERT-only / append-only, created_at is already sufficient):
--   permissions, role_permissions   — seed data, no runtime writer
--   tax_deductions                  — one INSERT per ride, ON CONFLICT DO NOTHING, never updated
--   driver_verifications            — one INSERT per day, ON CONFLICT DO NOTHING, never updated
--
-- Tables below DO have a real UPDATE path and were missing the column:
--   return_cab_routes    — deactivated on driver reconnect/offline (rides.service.ts)
--   ride_assignments     — offered -> accepted/cancelled (rides.repository.ts)
--   vehicle_categories   — admin edit (admin.repository.ts updateCategory)
--   vehicle_brands       — admin edit (admin.repository.ts updateBrand)
--   vehicle_models       — admin edit (admin.repository.ts updateModel)
--   notification_logs    — read_at set on read, status set on send/fail
--   driver_payout_holds  — active flag released (settlements.service.ts)

ALTER TABLE return_cab_routes   ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ride_assignments    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE vehicle_categories  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE vehicle_brands      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE vehicle_models      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE notification_logs   ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE driver_payout_holds ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- set_updated_at() already exists (014_triggers.sql) — reuse it, no app-code changes needed.
CREATE TRIGGER return_cab_routes_updated_at
  BEFORE UPDATE ON return_cab_routes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER ride_assignments_updated_at
  BEFORE UPDATE ON ride_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER vehicle_categories_updated_at
  BEFORE UPDATE ON vehicle_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER vehicle_brands_updated_at
  BEFORE UPDATE ON vehicle_brands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER vehicle_models_updated_at
  BEFORE UPDATE ON vehicle_models
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER notification_logs_updated_at
  BEFORE UPDATE ON notification_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER driver_payout_holds_updated_at
  BEFORE UPDATE ON driver_payout_holds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
