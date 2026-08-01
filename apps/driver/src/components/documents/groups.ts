import type { DocGroupDef, SlotState } from './types'

// The document set itself — shared by the onboarding wizard and the
// post-onboarding settings screen. This is data about what documents
// exist, not about the wizard flow, so it belongs to neither page.

export const DRIVER_GROUPS: DocGroupDef[] = [
  {
    groupKey: 'driving_license',
    label: 'Driving Licence',
    required: true,
    slots: [
      { key: 'driving_license_front', slotLabel: 'Front', accept: 'image/*,application/pdf', isVehicle: false },
      { key: 'driving_license_back',  slotLabel: 'Back',  accept: 'image/*,application/pdf', isVehicle: false },
    ],
    hasExpiry: true,
    expiryRequired: true,
  },
  {
    groupKey: 'aadhaar',
    label: 'Aadhaar Card',
    required: true,
    slots: [
      { key: 'aadhaar_front', slotLabel: 'Front', accept: 'image/*', isVehicle: false },
      { key: 'aadhaar_back',  slotLabel: 'Back',  accept: 'image/*', isVehicle: false },
    ],
    hasExpiry: false,
    expiryRequired: false,
  },
]

export const VEHICLE_GROUPS: DocGroupDef[] = [
  {
    groupKey: 'vehicle_rc',
    label: 'Registration Certificate (RC)',
    required: true,
    slots: [{ key: 'vehicle_rc', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: false,
    expiryRequired: false,
  },
  {
    groupKey: 'insurance',
    label: 'Insurance',
    required: true,
    slots: [{ key: 'insurance', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: true,
    expiryRequired: true,
  },
  {
    groupKey: 'permit',
    label: 'Commercial Permit',
    required: true,
    slots: [{ key: 'permit', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: true,
    expiryRequired: true,
  },
  {
    groupKey: 'pollution_cert',
    label: 'PUC Certificate',
    required: false,
    slots: [{ key: 'pollution_cert', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: true,
    expiryRequired: false,
  },
  {
    groupKey: 'fitness_cert',
    label: 'Fitness Certificate',
    required: false,
    slots: [{ key: 'fitness_cert', slotLabel: '', accept: 'image/*,application/pdf', isVehicle: true }],
    hasExpiry: true,
    expiryRequired: false,
  },
]

export const ALL_GROUPS = [...DRIVER_GROUPS, ...VEHICLE_GROUPS]
export const ALL_KEYS   = ALL_GROUPS.flatMap(g => g.slots.map(s => s.key))

export function initSlotState(): Record<string, SlotState> {
  return Object.fromEntries(
    ALL_KEYS.map(k => [k, { state: 'idle', url: null, error: null, docStatus: null, rejectionNote: null }])
  )
}
