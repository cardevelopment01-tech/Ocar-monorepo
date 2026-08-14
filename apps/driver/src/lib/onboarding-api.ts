import api from './api'
import { compressImage } from './image-compress'
import { putToS3WithRetry } from './s3-upload'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PersonalInfoPayload {
  full_name: string
  email?: string
  gender: 'male' | 'female' | 'other'
  date_of_birth: string        // YYYY-MM-DD
  residential_address: string
  state: string
  city: string
  city_id?: number
  pincode: string
  experience_years: number
  emergency_contact: string    // E.164: +919876543211
  languages_known: string[]
}

export interface VehicleInfoPayload {
  category_id: number
  brand_id: number
  model_id?: number
  vehicle_name: string
  model_year: number
  number_plate: string         // uppercase, no spaces
  color: string
  fuel_type: 'petrol' | 'diesel' | 'cng' | 'electric'
  seating_capacity: number
  luggage_capacity: number
  ac_availability: boolean
  registration_date?: string   // YYYY-MM-DD, date vehicle was first registered
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
  photos: Record<string, { uploaded: boolean; url: string | null; status: string | null; rejection_note: string | null }>
  vehicle_docs: Record<string, { uploaded: boolean; url: string | null; status: string | null; rejection_note: string | null }>
  all_required_complete: boolean
  rejection_reason: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Phone camera photos of ID docs are commonly 4-12MB; downscale before upload
// to cut bandwidth and avoid timeouts on slow mobile connections.
const DOC_MAX_EDGE = 1600
const DOC_JPEG_QUALITY = 0.82

async function compressDocImage(file: File): Promise<File> {
  return compressImage(file, { maxEdge: DOC_MAX_EDGE, quality: DOC_JPEG_QUALITY })
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

  uploadDriverDoc: async (file: File, docType: string, validUntil?: string) => {
    const compressed = await compressDocImage(file)
    const { upload_url, key } = (await api.post('/api/v1/drivers/onboarding/documents/upload-init', {
      doc_type: docType,
      content_type: compressed.type,
    })).data as { upload_url: string; key: string }

    await putToS3WithRetry(upload_url, compressed)

    const res = await api.post('/api/v1/drivers/onboarding/documents/upload-complete', {
      doc_type: docType,
      key,
      ...(validUntil ? { valid_until: validUntil } : {}),
    })
    return res.data as { doc_type: string; file_url: string; status: string }
  },

  uploadVehicleDoc: async (file: File, docType: string, docNumber?: string, validUntil?: string) => {
    const compressed = await compressDocImage(file)
    const { upload_url, key } = (await api.post('/api/v1/drivers/onboarding/documents/vehicle-upload-init', {
      doc_type: docType,
      content_type: compressed.type,
    })).data as { upload_url: string; key: string }

    await putToS3WithRetry(upload_url, compressed)

    const res = await api.post('/api/v1/drivers/onboarding/documents/vehicle-upload-complete', {
      doc_type: docType,
      key,
      ...(docNumber  ? { doc_number: docNumber }   : {}),
      ...(validUntil ? { valid_until: validUntil } : {}),
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

  getCities: async () => {
    const res = await api.get('/api/v1/geo/cities')
    return res.data as { id: number; name: string; state: string }[]
  },
}
