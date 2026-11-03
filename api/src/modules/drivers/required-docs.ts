// Documents a driver must have approved. Constants only (never user input), so they are safe to inline into SQL.
// Kept in their own module so the admin queue and the driver go-online gate share one list.
export const REQUIRED_IDENTITY_DOCS = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
export const REQUIRED_VEHICLE_DOCS  = ['vehicle_rc_front', 'vehicle_rc_back', 'insurance', 'permit']
export const sqlList = (types: string[]) => types.map((t) => `'${t}'`).join(', ')
