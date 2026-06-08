import api from './api'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PersonalInfoPayload {
  full_name: string
  email?: string
  gender: 'male' | 'female' | 'other'
  date_of_birth: string        // YYYY-MM-DD
  residential_address: string
  state: string
  city: string
  pincode: string
  experience_years: number
  emergency_contact: string    // E.164: +919876543211
  languages_known: string[]
}

export interface VehicleInfoPayload {
  category_id: number
  brand_id: number
  vehicle_name: string
  model_year: number
  number_plate: string         // uppercase, no spaces
  color: string
  fuel_type: 'petrol' | 'diesel' | 'cng' | 'electric'
  seating_capacity: number
  luggage_capacity: number
  ac_availability: boolean
}

export interface VehicleCategory {
  id: number
  slug: string
  display_name: string
  max_passengers: number
}

export interface VehicleBrand {
  id: number
  name: string
}

export interface VehicleModel {
  id: number
  name: string
  typical_category_id: number | null
}

export interface DocumentStatus {
  identity: { license_number: string | null; aadhaar_number: string | null }
  photos: Record<string, { uploaded: boolean; url: string | null; status: string | null }>
  vehicle_docs: Record<string, { uploaded: boolean; url: string | null; status: string | null }>
  all_required_complete: boolean
}

// ── API calls ──────────────────────────────────────────────────────────────────

export const onboardingApi = {
  getPersonalInfo: async () => {
    const res = await api.get('/api/v1/drivers/onboarding/personal-info')
    return res.data as Partial<PersonalInfoPayload & { date_of_birth: string | null }>
  },

  savePersonalInfo: async (data: PersonalInfoPayload) => {
    const res = await api.post('/api/v1/drivers/onboarding/personal-info', data)
    return res.data as { success: boolean; next_step: string; driver_code: string }
  },

  getVehicleInfo: async () => {
    const res = await api.get('/api/v1/drivers/onboarding/vehicle-info')
    return res.data as { vehicle: (VehicleInfoPayload & { id: string }) | null }
  },

  saveVehicleInfo: async (data: VehicleInfoPayload) => {
    const res = await api.post('/api/v1/drivers/onboarding/vehicle-info', data)
    return res.data as { success: boolean; next_step: string; vehicle_id: string }
  },

  getDocumentStatus: async () => {
    const res = await api.get('/api/v1/drivers/onboarding/documents/status')
    return res.data as DocumentStatus
  },

  saveIdentityNumbers: async (data: { license_number: string; aadhaar_number: string }) => {
    const res = await api.post('/api/v1/drivers/onboarding/documents/identity', data)
    return res.data
  },

  uploadDriverDoc: async (file: File, docType: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('doc_type', docType)
    const res = await api.post('/api/v1/drivers/onboarding/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data as { doc_type: string; file_url: string; status: string }
  },

  uploadVehicleDoc: async (file: File, docType: string, docNumber?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('doc_type', docType)
    if (docNumber) formData.append('doc_number', docNumber)
    const res = await api.post('/api/v1/drivers/onboarding/documents/vehicle-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data as { doc_type: string; file_url: string; status: string }
  },

  submitApplication: async () => {
    const res = await api.post('/api/v1/drivers/onboarding/submit')
    return res.data as { success: boolean; status: string }
  },

  getCategories: async () => {
    const res = await api.get('/api/v1/vehicles/categories')
    return res.data as VehicleCategory[]
  },

  getBrands: async () => {
    const res = await api.get('/api/v1/vehicles/brands')
    return res.data as VehicleBrand[]
  },

  getModels: async (brandId: number) => {
    const res = await api.get(`/api/v1/vehicles/brands/${brandId}/models`)
    return res.data as VehicleModel[]
  },
}
