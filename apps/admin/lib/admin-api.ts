import api from './api'

export type DriverStatus = 'pending_docs' | 'pending_approval' | 'active' | 'suspended' | 'banned'

export interface DriverListItem {
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

export interface DriverDetail {
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
  } | null
  documents: { doc_type: string; file_url: string; status: string; rejection_note: string | null }[]
  vehicle_documents: { doc_type: string; file_url: string; status: string; rejection_note: string | null }[]
  status_history: { from_status: string | null; to_status: string; reason: string | null; created_at: string }[]
}

export interface DriversResponse {
  drivers: DriverListItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export const adminDriverApi = {
  list: async (params: {
    status?: string
    search?: string
    page?: number
    limit?: number
  }): Promise<DriversResponse> => {
    const res = await api.get('/api/v1/admin/drivers', { params })
    return res.data as DriversResponse
  },

  getById: async (id: string): Promise<DriverDetail> => {
    const res = await api.get(`/api/v1/admin/drivers/${id}`)
    return res.data as DriverDetail
  },

  approve: async (id: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/status`, { status: 'active' })
  },

  reject: async (id: string, reason: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/status`, { status: 'banned', reason })
  },

  suspend: async (id: string, reason: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/status`, { status: 'suspended', reason })
  },

  reinstate: async (id: string): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/status`, { status: 'active' })
  },
}

// ─── Rides ────────────────────────────────────────────────────────────────────

export interface AdminRideItem {
  id: string
  status: string
  ride_type: string
  is_return_cab: boolean
  origin_address: string | null
  destination_address: string | null
  requested_at: string
  completed_at: string | null
  user_name: string
  user_phone: string
  driver_name: string | null
  driver_phone: string | null
  fare: string | null
}

export interface AdminRidesResponse {
  rides: AdminRideItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export const adminRideApi = {
  list: async (params: { status?: string; search?: string; page?: number; limit?: number }): Promise<AdminRidesResponse> => {
    const res = await api.get('/api/v1/admin/rides', { params })
    return res.data as AdminRidesResponse
  },
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface AdminUserItem {
  id: string
  code: string
  name: string
  phone: string
  email: string | null
  status: string
  rating_avg: string | null
  total_rides: number
  wallet_balance: string
  created_at: string
}

export interface AdminUsersResponse {
  users: AdminUserItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export const adminUserApi = {
  list: async (params: { status?: string; search?: string; page?: number; limit?: number }): Promise<AdminUsersResponse> => {
    const res = await api.get('/api/v1/admin/users', { params })
    return res.data as AdminUsersResponse
  },
  updateStatus: async (id: string, status: 'active' | 'suspended'): Promise<void> => {
    await api.patch(`/api/v1/admin/users/${id}/status`, { status })
  },
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export interface AdminPaymentItem {
  id: string
  status: string
  channel: string
  amount: string
  commission_amount: string
  driver_earning: string
  ride_id: string
  user_name: string
  driver_name: string | null
  created_at: string
}

export interface AdminPaymentsResponse {
  payments: AdminPaymentItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export const adminPaymentApi = {
  list: async (params: { channel?: string; search?: string; page?: number; limit?: number }): Promise<AdminPaymentsResponse> => {
    const res = await api.get('/api/v1/admin/payments', { params })
    return res.data as AdminPaymentsResponse
  },
}
