-- updated_at auto-maintenance triggers

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER admins_updated_at
  BEFORE UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER drivers_updated_at
  BEFORE UPDATE ON drivers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER driver_documents_updated_at
  BEFORE UPDATE ON driver_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER driver_vehicles_updated_at
  BEFORE UPDATE ON driver_vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER driver_vehicle_documents_updated_at
  BEFORE UPDATE ON driver_vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
