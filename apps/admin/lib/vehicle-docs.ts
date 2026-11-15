// Which vehicle documents are required. Mirrors api/src/modules/drivers/required-docs.ts (the server is the real
// guard; this only drives what the admin screens count and flag).
export const REQUIRED_VEHICLE_DOCS = ['vehicle_rc_front', 'vehicle_rc_back', 'insurance', 'permit']

// A battery-electric vehicle needs no commercial permit and has no PUC: neither is required for it.
export const requiredVehicleDocs = (fuelType?: string | null): string[] =>
  fuelType === 'electric' ? REQUIRED_VEHICLE_DOCS.filter(d => d !== 'permit') : REQUIRED_VEHICLE_DOCS
