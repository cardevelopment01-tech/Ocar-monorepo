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
  { groupKey: 'vehicle_rc', label: 'Registration Certificate (RC)', hasExpiry: false, expiryRequired: false, required: true, slots: [{ key: 'vehicle_rc', slotLabel: '' }] },
  { groupKey: 'insurance', label: 'Insurance', hasExpiry: true, expiryRequired: true, required: true, slots: [{ key: 'insurance', slotLabel: '' }] },
  { groupKey: 'permit', label: 'Commercial Permit', hasExpiry: true, expiryRequired: true, required: true, slots: [{ key: 'permit', slotLabel: '' }] },
  { groupKey: 'pollution_cert', label: 'PUC Certificate', hasExpiry: true, expiryRequired: false, required: false, slots: [{ key: 'pollution_cert', slotLabel: '' }] },
  { groupKey: 'fitness_cert', label: 'Fitness Certificate', hasExpiry: true, expiryRequired: false, required: false, slots: [{ key: 'fitness_cert', slotLabel: '' }] },
] as const

export const REQUIRED_VEHICLE_DOC_KEYS = VEHICLE_DOC_GROUPS.filter((g) => g.required).flatMap((g) => g.slots.map((s) => s.key))
export const REQUIRED_DRIVER_DOC_KEYS = DRIVER_DOC_GROUPS.flatMap((g) => g.slots.map((s) => s.key))
export const ALL_DOC_KEYS = [...REQUIRED_DRIVER_DOC_KEYS, ...VEHICLE_DOC_GROUPS.flatMap((g) => g.slots.map((s) => s.key))]
