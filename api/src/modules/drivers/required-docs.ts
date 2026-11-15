// Documents a driver must have approved. Constants only (never user input), so they are safe to inline into SQL.
// Kept in their own module so the admin queue and the driver go-online gate share one list.
export const REQUIRED_IDENTITY_DOCS = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
export const REQUIRED_VEHICLE_DOCS  = ['vehicle_rc_front', 'vehicle_rc_back', 'insurance', 'permit']
export const sqlList = (types: string[]) => types.map((t) => `'${t}'`).join(', ')

// A battery-electric vehicle needs no commercial permit (exempt from permits) and has no exhaust to test (PUC). For an
// electric vehicle these are never required, never block going online, and never get expiry reminders. They can still be
// uploaded (the permit is shown as optional); they are just ignored. Fuel type 'electric' is the only trigger.
export const EV_IGNORED_VEHICLE_DOCS = ['permit', 'pollution_cert']
export const isIgnoredVehicleDoc = (fuelType: string | null | undefined, docType: string) =>
  fuelType === 'electric' && EV_IGNORED_VEHICLE_DOCS.includes(docType)
export const requiredVehicleDocs = (fuelType?: string | null): string[] =>
  REQUIRED_VEHICLE_DOCS.filter((d) => !isIgnoredVehicleDoc(fuelType, d))
/** SQL: true unless the document is one that does not apply to this vehicle's fuel type. Aliases are hardcoded tokens. */
export const sqlVehicleDocApplies = (vehicleAlias: string, docAlias: string) =>
  // COALESCE: fuel_type is nullable, and NOT (NULL AND x) is NULL, which would silently drop the row for a vehicle with no fuel type
  `NOT (COALESCE(${vehicleAlias}.fuel_type, '') = 'electric' AND ${docAlias}.doc_type::text IN (${sqlList(EV_IGNORED_VEHICLE_DOCS)}))`
