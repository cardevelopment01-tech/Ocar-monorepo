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
