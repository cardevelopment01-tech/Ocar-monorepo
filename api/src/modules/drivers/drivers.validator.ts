import { z } from 'zod'

const ALLOWED_COLORS = [
  'White', 'Black', 'Silver', 'Grey', 'Red', 'Blue',
  'Brown', 'Green', 'Yellow', 'Orange', 'Other',
] as const

export const personalInfoSchema = z.object({
  full_name: z.string().min(2).max(120),
  email: z.string().email().optional(),
  gender: z.enum(['male', 'female', 'other']),
  date_of_birth: z
    .string()
    .refine((val) => !isNaN(new Date(val).getTime()), 'Invalid date format')
    .refine((val) => {
      const ageMs = Date.now() - new Date(val).getTime()
      return ageMs / (1000 * 60 * 60 * 24 * 365.25) >= 18
    }, 'Driver must be at least 18 years old')
    .refine((val) => {
      const ageMs = Date.now() - new Date(val).getTime()
      return ageMs / (1000 * 60 * 60 * 24 * 365.25) <= 70
    }, 'Driver cannot be older than 70 years'),
  residential_address: z.string().min(10).max(300),
  state: z.string().min(2).max(80),
  city: z.string().min(2).max(80),
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be exactly 6 digits'),
  experience_years: z.number().int().min(0).max(50),
  emergency_contact: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Emergency contact must be E.164 format'),
  languages_known: z.array(z.string().max(50)).min(1, 'At least one language is required'),
})

export const vehicleInfoSchema = z.object({
  category_id: z.number().int().positive(),
  brand_id: z.number().int().positive(),
  model_id: z.number().int().positive().optional(),
  vehicle_name: z.string().min(2).max(100),
  model_year: z
    .number()
    .int()
    .min(1990)
    .max(new Date().getFullYear() + 1),
  number_plate: z
    .string()
    .transform((s) => s.toUpperCase().trim())
    .pipe(
      z.string().regex(
        /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/,
        'Invalid Indian number plate format (e.g. MH12AB1234)'
      )
    ),
  color: z.enum(ALLOWED_COLORS),
  fuel_type: z.enum(['petrol', 'diesel', 'cng', 'electric']),
  seating_capacity: z.number().int().min(1).max(10),
  luggage_capacity: z.number().int().min(0).max(10),
  ac_availability: z.boolean(),
  registration_date: z.string().optional(),
})

export const identityDocumentSchema = z.object({
  license_number: z
    .string()
    .transform((s) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase().trim())
    .pipe(
      z.string().regex(
        /^[A-Z]{2}[A-Z0-9]{13,14}$/,
        'Invalid driving licence number format'
      )
    ),
  aadhaar_number: z
    .string()
    .regex(/^\d{12}$/, 'Aadhaar number must be exactly 12 digits'),
})

export const identityUploadSchema = z.object({
  doc_type:    z.enum(['profile_photo', 'driving_license', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']),
  valid_from:  z.string().optional(),
  valid_until: z.string().optional(),
})

export const vehicleUploadSchema = z.object({
  doc_type: z.enum(['vehicle_rc', 'insurance', 'permit', 'pollution_cert', 'fitness_cert']),
  doc_number: z.string().max(80).optional(),
  valid_until: z.string().optional(),
})
