export type DriverStatus = 'pending_docs' | 'pending_approval' | 'active' | 'suspended' | 'banned' | 'docs_rejected'

export interface AdminDriverListRow {
  id: string
  code: string
  phone: string
  full_name: string | null
  email: string | null
  status: DriverStatus
  onboarding_step: string
  created_at: string
  vehicle: {
    number_plate: string
    vehicle_name: string
    category: string
  } | null
  docs_submitted: number
  docs_approved: number
}

export interface AdminDriverDetail {
  id: string
  code: string
  phone: string
  full_name: string | null
  email: string | null
  gender: string | null
  date_of_birth: string | null
  residential_address: string | null
  state: string | null
  city: string | null
  pincode: string | null
  experience_years: number | null
  emergency_contact: string | null
  languages_known: string[]
  aadhaar_number: string | null
  license_number: string | null
  city_id: string | null
  assigned_city_name: string | null
  assigned_city_billing_mode: 'commission' | 'package' | null
  status: DriverStatus
  onboarding_step: string
  created_at: string
  updated_at: string
  vehicle: {
    id: string
    number_plate: string
    vehicle_name: string
    model_year: number
    color: string
    fuel_type: string
    seating_capacity: number
    luggage_capacity: number
    ac_availability: boolean
    category: string
    brand: string
    category_id: string | null
    brand_id: string | null
    model_id: string | null
  } | null
  documents: {
    id: string
    doc_type: string
    file_url: string
    status: string
    rejection_note: string | null
  }[]
  vehicle_documents: {
    id: string
    doc_type: string
    file_url: string
    status: string
    rejection_note: string | null
  }[]
  status_history: {
    from_status: string | null
    to_status: string
    reason: string | null
    created_at: string
  }[]
  wallet: { balance: string; is_frozen: boolean } | null
  rating_avg: string
  total_ratings: number
  ratings: {
    id: string
    score: number
    comment: string | null
    created_at: string
    ride_id: string
    tags: string[]
  }[]
  warnings: {
    id: string
    category: string
    severity: string
    description: string
    acknowledged_at: string | null
    expires_at: string | null
    created_at: string
    issued_by_email: string | null
  }[]
  recent_rides: {
    id: string
    status: string
    ride_type: string
    requested_at: string
    completed_at: string | null
    fare: string | null
    user_name: string
  }[]
}

export interface UpdateDriverStatusPayload {
  status: DriverStatus
  reason?: string
}

// Identity/KYC fields an admin can correct against the driver's uploaded documents.
// phone/status/onboarding_step are deliberately excluded — those have their own gated flows.
export interface UpdateDriverProfilePayload {
  full_name?: string
  email?: string
  gender?: string
  date_of_birth?: string
  residential_address?: string
  state?: string
  city?: string
  pincode?: string
  experience_years?: number
  emergency_contact?: string
  languages_known?: string[]
  aadhaar_number?: string
  license_number?: string
  city_id?: string
  reason: string
}

// Vehicle spec fields an admin can correct after a driver mistake at
// onboarding (wrong category, plate typo, etc). category_id/brand_id/model_id
// are wire-format strings (bigint-as-string, like everywhere else in this
// file) — the service layer converts them to bigint before the repo call.
export interface UpdateDriverVehiclePayload {
  category_id?: string
  brand_id?: string
  model_id?: string | null
  vehicle_name?: string
  number_plate?: string
  model_year?: number
  color?: string
  fuel_type?: string
  seating_capacity?: number
  luggage_capacity?: number
  ac_availability?: boolean
  reason: string
}

// ─── Vehicle management types ─────────────────────────────────────────────────

export type VehicleState = 'pending' | 'active' | 'blacklisted' | 'inactive'

export interface AdminVehicleCategory {
  id: string
  slug: string
  display_name: string
  max_passengers: number
  is_active: boolean
  created_at: string
  driver_count: number
}

export interface AdminVehicleBrand {
  id: string
  name: string
  logo_url: string | null
  is_active: boolean
  created_at: string
  model_count: number
}

export interface AdminVehicleModel {
  id: string
  brand_id: string
  name: string
  typical_category_id: string | null
  is_active: boolean
  created_at: string
  brand_name: string
  typical_category_name: string | null
}

export interface FleetVehicle {
  id: string
  driver_id: string
  driver_name: string | null
  driver_code: string
  driver_phone: string
  vehicle_name: string | null
  number_plate: string | null
  category: string | null
  brand: string | null
  status: VehicleState
  is_primary: boolean
  created_at: string
}

export interface PendingVehicleDoc {
  id: string
  vehicle_id: string
  doc_type: string
  file_url: string
  doc_number: string | null
  status: string
  created_at: string
  number_plate: string | null
  vehicle_name: string | null
  driver_name: string | null
  driver_code: string
}

export interface ExpiringVehicleDoc {
  id: string
  vehicle_id: string
  doc_type: string
  file_url: string
  valid_until: string
  number_plate: string | null
  vehicle_name: string | null
  driver_name: string | null
  driver_phone: string
  driver_code: string
}

// ─── Geo / Cities ─────────────────────────────────────────────────────────────

// ─── Pricing ──────────────────────────────────────────────────────────────────

export interface AdminSurgeEvent {
  id: number
  city_id: number
  city_name: string
  category_id: number | null
  category_name: string | null
  multiplier: number
  reason: string | null
  status: 'scheduled' | 'active' | 'expired' | 'cancelled'
  starts_at: string
  ends_at: string
  created_at: string
}

export interface AdminCity {
  id: number
  name: string
  slug: string
  state: string
  centroid_lat: number
  centroid_lng: number
  default_speed_limit_kmph: number
  status: 'draft' | 'active' | 'inactive'
  is_rental_enabled: boolean
  is_return_cab_enabled: boolean
  billing_mode: 'commission' | 'package'
  created_at: string
}

// ─── Active driver sessions (live map) ───────────────────────────────────────

export interface ActiveDriverSession {
  session_id: string
  driver_id: string
  driver_name: string | null
  driver_phone: string
  driver_code: string
  session_status: 'online' | 'on_trip'
  lat: number | null
  lng: number | null
  heading: number | null
  speed_kmph: number | null
  location_updated_at: string | null
  ride_id: string | null
  origin_address: string | null
  destination_address: string | null
  origin_lat: number | null
  origin_lng: number | null
  dest_lat: number | null
  dest_lng: number | null
  vehicle_category: string | null
  vehicle_name: string | null
  number_plate: string | null
}

// ─── Rental packages ──────────────────────────────────────────────────────────

export interface AdminRentalPackage {
  id: number
  category_id: number
  category_name?: string
  category_slug?: string
  duration_minutes: number
  km_limit: number
  display_order: number
  package_fare: string
  extra_per_km: string
  extra_per_min: string
  is_active: boolean
  city_id: number | null
  city_name?: string | null
  updated_by: number | null
  created_at: string
  updated_at: string
}

// ─── Admin accounts ───────────────────────────────────────────────────────────

export interface AdminAccountListItem {
  id: string
  code: string
  email: string
  role: 'super_admin' | 'ops_admin' | 'support_admin' | 'finance_admin'
  admin_status: 'active' | 'suspended'
  created_at: string
}

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export interface AdminDashboardStats {
  total_rides_today: number
  active_drivers_online: number
  revenue_today: number
  open_disputes: number
  completed_rides: number
  cancelled_rides: number
  new_driver_signups: number
  active_trips: number
  rides_last_12h: number[]
}
