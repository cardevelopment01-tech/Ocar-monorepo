// Ported from apps/driver/src/lib/india-geo.ts and the onboarding pages' own
// hardcoded arrays -- same lists on both platforms.
export const INDIA_STATES: string[] = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
]

export const INDIAN_LANGUAGES: string[] = [
  'Hindi', 'English', 'Odia', 'Bengali', 'Tamil', 'Telugu',
  'Kannada', 'Malayalam', 'Marathi', 'Gujarati', 'Punjabi',
  'Urdu', 'Assamese', 'Maithili', 'Santali', 'Kashmiri',
  'Nepali', 'Sindhi', 'Dogri', 'Konkani', 'Manipuri', 'Bodo',
]

export const VEHICLE_COLORS = ['White', 'Black', 'Silver', 'Grey', 'Red', 'Blue', 'Brown', 'Green', 'Yellow', 'Orange', 'Other'] as const

export const FUEL_TYPES = [
  { value: 'petrol', label: 'Petrol' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'cng', label: 'CNG' },
  { value: 'electric', label: 'EV' },
] as const

/** The fuel types a driver may pick for a model: only the ones it is sold with (no list = any). */
export function fuelOptionsFor(model: { fuel_types?: string[] | null } | undefined): ReadonlyArray<{ value: string; label: string }> {
  const allowed = model?.fuel_types
  return allowed && allowed.length ? FUEL_TYPES.filter((f) => allowed.includes(f.value)) : FUEL_TYPES
}

export const DRIVER_DOC_GROUPS = [
  { groupKey: 'driving_license', label: 'Driving Licence', hasExpiry: true, expiryRequired: true, required: true, slots: [
    { key: 'driving_license_front', slotLabel: 'Front' },
    { key: 'driving_license_back', slotLabel: 'Back' },
  ] },
  { groupKey: 'aadhaar', label: 'Aadhaar Card', hasExpiry: false, expiryRequired: false, required: true, slots: [
    { key: 'aadhaar_front', slotLabel: 'Front' },
    { key: 'aadhaar_back', slotLabel: 'Back' },
  ] },
] as const

export const VEHICLE_DOC_GROUPS = [
  { groupKey: 'vehicle_rc', label: 'Registration Certificate (RC)', hasExpiry: false, expiryRequired: false, required: true, slots: [{ key: 'vehicle_rc_front', slotLabel: 'Front' }, { key: 'vehicle_rc_back', slotLabel: 'Back' }] },
  { groupKey: 'insurance', label: 'Insurance', hasExpiry: true, expiryRequired: true, required: true, slots: [{ key: 'insurance', slotLabel: '' }] },
  { groupKey: 'permit', label: 'Commercial Permit', hasExpiry: true, expiryRequired: true, required: true, slots: [{ key: 'permit', slotLabel: '' }] },
  { groupKey: 'pollution_cert', label: 'PUC Certificate', hasExpiry: true, expiryRequired: false, required: false, slots: [{ key: 'pollution_cert', slotLabel: '' }] },
  { groupKey: 'fitness_cert', label: 'Fitness Certificate', hasExpiry: true, expiryRequired: false, required: false, slots: [{ key: 'fitness_cert', slotLabel: '' }] },
] as const

type VehicleDocGroup = {
  groupKey: string; label: string; hasExpiry: boolean; expiryRequired: boolean; required: boolean
  slots: ReadonlyArray<{ key: string; slotLabel: string }>
}

// An electric vehicle needs no commercial permit (shown as optional) and has no PUC (hidden). Mirrors the server's
// required-docs.ts, which is the real guard; the server also tells this app the fuel type (vehicle_fuel_type).
export const EV_IGNORED_DOC_KEYS: ReadonlySet<string> = new Set(['permit', 'pollution_cert'])
export function vehicleDocGroupsFor(fuelType: string | null | undefined): ReadonlyArray<VehicleDocGroup> {
  if (fuelType !== 'electric') return VEHICLE_DOC_GROUPS
  return VEHICLE_DOC_GROUPS.filter((g) => g.groupKey !== 'pollution_cert')
    .map((g) => (g.groupKey === 'permit' ? { ...g, required: false, expiryRequired: false } : g))
}

export const REQUIRED_VEHICLE_DOC_KEYS = VEHICLE_DOC_GROUPS.filter((g) => g.required).flatMap((g) => g.slots.map((s) => s.key))
export const REQUIRED_DRIVER_DOC_KEYS = DRIVER_DOC_GROUPS.flatMap((g) => g.slots.map((s) => s.key))
// Collected by the onboarding selfie step, so it is NOT in DRIVER_DOC_GROUPS (the onboarding Documents
// step would otherwise demand it before the selfie step). The standalone Documents screen shows it so a
// rejected photo can be replaced.
export const PROFILE_PHOTO_KEY = 'profile_photo'
export const ALL_DOC_KEYS = [PROFILE_PHOTO_KEY, ...REQUIRED_DRIVER_DOC_KEYS,...VEHICLE_DOC_GROUPS.flatMap((g) => g.slots.map((s) => s.key))]
