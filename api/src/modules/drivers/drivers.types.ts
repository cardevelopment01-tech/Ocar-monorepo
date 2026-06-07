// ── DB row types ──────────────────────────────────────────────────────────────

export interface Driver {
  id: string
  code: string
  phone: string
  full_name: string | null
  email: string | null
  gender: 'male' | 'female' | 'other' | null
  date_of_birth: Date | null
  residential_address: string | null
  state: string | null
  city: string | null
  pincode: string | null
  experience_years: number | null
  emergency_contact: string | null
  languages_known: string[]
  aadhaar_number: string | null
  license_number: string | null
  status: string
  onboarding_step: string
  fcm_token: string | null
  created_at: Date
  updated_at: Date
}

export interface DriverVehicle {
  id: string
  driver_id: string
  category_id: string | null
  brand_id: string | null
  model_id: string | null
  vehicle_name: string | null
  model_year: number | null
  number_plate: string | null
  color: string | null
  fuel_type: string | null
  seating_capacity: number
  luggage_capacity: number
  ac_availability: boolean
  status: string
  is_primary: boolean
  created_at: Date
  updated_at: Date
}

export interface DriverDocument {
  id: string
  driver_id: string
  doc_type: string
  file_url: string
  status: string
  rejection_note: string | null
  reviewed_by: string | null
  reviewed_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface DriverVehicleDocument {
  id: string
  vehicle_id: string
  doc_type: string
  file_url: string
  doc_number: string | null
  status: string
  rejection_note: string | null
  valid_until: Date | null
  created_at: Date
  updated_at: Date
}

// ── Service response types ────────────────────────────────────────────────────

export interface OnboardingStatus {
  current_step: string
  personal_info_complete: boolean
  vehicle_info_complete: boolean
  documents_complete: boolean
  missing_documents: string[]
}

export interface DocumentStatus {
  doc_type: string
  uploaded: boolean
  file_url: string | null
  status: string | null
}
