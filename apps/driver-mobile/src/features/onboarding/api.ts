import { api } from '@/services/api'
import { prepareImageForUpload } from '@/services/uploadImage'

// ── Types (mirrors apps/driver/src/lib/onboarding-api.ts) ──────────────────────

export interface PersonalInfoPayload {
  full_name: string
  email?: string
  gender: 'male' | 'female' | 'other'
  date_of_birth: string
  residential_address: string
  state: string
  city: string
  city_id?: number
  pincode: string
  experience_years: number
  emergency_contact: string
  languages_known: string[]
}

export interface VehicleInfoPayload {
  category_id: number
  brand_id: number
  model_id?: number
  vehicle_name: string
  model_year: number
  number_plate: string
  color: string
  fuel_type: 'petrol' | 'diesel' | 'cng' | 'electric'
  seating_capacity: number
  luggage_capacity: number
  ac_availability: boolean
  registration_date?: string
}

export type VehicleCategory = { id: number; slug: string; display_name: string; max_passengers: number }
export type VehicleBrand = { id: number; name: string }
export type VehicleModel = { id: number; name: string; typical_category_id: number | null }

export type DocumentStatus = {
  identity: { license_number: string | null; aadhaar_number: string | null }
  photos: Record<string, { uploaded: boolean; url: string | null; status: string | null; rejection_note: string | null }>
  vehicle_docs: Record<string, { uploaded: boolean; url: string | null; status: string | null; rejection_note: string | null }>
  all_required_complete: boolean
  rejection_reason: string | null
}

// ── Upload helper ────────────────────────────────────────────────────────────
// Presigned-URL PUT from a local file URI -- RN's fetch reads a local file:// /
// content:// URI into a Blob (same trick used across Expo apps for S3 uploads),
// so no extra native module is needed for the PUT itself. expo-image-picker's
// own `quality` option (see the onboarding screens) already downsizes the JPEG
// at capture time, so no separate compress-on-upload step is needed either.
async function putToS3WithRetry(uploadUrl: string, uri: string, contentType: string, attempts = 3): Promise<void> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const blob = await (await fetch(uri)).blob()
      const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob })
      if (!res.ok) throw new Error(`S3 PUT failed: ${res.status}`)
      return
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i))
    }
  }
  throw lastErr
}

export type PickedFile = { uri: string; mimeType: string; fileSize: number }

// ── API calls ────────────────────────────────────────────────────────────────

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

  uploadDriverDoc: async (picked: PickedFile, docType: string, validUntil?: string) => {
    const file = await prepareImageForUpload(picked)
    const { upload_url, key } = (await api.post('/api/v1/drivers/onboarding/documents/upload-init', {
      doc_type: docType,
      content_type: file.mimeType,
      content_length: file.fileSize,
    })).data as { upload_url: string; key: string }

    await putToS3WithRetry(upload_url, file.uri, file.mimeType)

    const res = await api.post('/api/v1/drivers/onboarding/documents/upload-complete', {
      doc_type: docType,
      key,
      ...(validUntil ? { valid_until: validUntil } : {}),
    })
    return res.data as { doc_type: string; file_url: string; status: string }
  },

  uploadVehicleDoc: async (picked: PickedFile, docType: string, docNumber?: string, validUntil?: string) => {
    const file = await prepareImageForUpload(picked)
    const { upload_url, key } = (await api.post('/api/v1/drivers/onboarding/documents/vehicle-upload-init', {
      doc_type: docType,
      content_type: file.mimeType,
      content_length: file.fileSize,
    })).data as { upload_url: string; key: string }

    await putToS3WithRetry(upload_url, file.uri, file.mimeType)

    const res = await api.post('/api/v1/drivers/onboarding/documents/vehicle-upload-complete', {
      doc_type: docType,
      key,
      ...(docNumber ? { doc_number: docNumber } : {}),
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
