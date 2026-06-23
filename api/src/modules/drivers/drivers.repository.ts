import { query } from '@/db/client'
import type {
  Driver,
  DriverVehicle,
  DriverDocument,
  DriverVehicleDocument,
} from './drivers.types'

// ── Drivers ───────────────────────────────────────────────────────────────────

export async function findDriverById(id: bigint): Promise<Driver | null> {
  const rows = await query<Driver>(
    'SELECT * FROM drivers WHERE id = $1 LIMIT 1',
    [id.toString()]
  )
  return rows[0] ?? null
}

export async function updatePersonalInfo(
  id: bigint,
  data: {
    full_name: string
    email?: string
    gender: string
    date_of_birth: string
    residential_address: string
    state: string
    city: string
    pincode: string
    experience_years: number
    emergency_contact: string
    languages_known: string[]
  }
): Promise<Driver> {
  const rows = await query<Driver>(
    `UPDATE drivers SET
       full_name           = $2,
       email               = COALESCE($3, email),
       gender              = $4,
       date_of_birth       = $5,
       residential_address = $6,
       state               = $7,
       city                = $8,
       pincode             = $9,
       experience_years    = $10,
       emergency_contact   = $11,
       languages_known     = $12,
       onboarding_step     = CASE
                               WHEN onboarding_step = 'personal_info' THEN 'vehicle_info'
                               ELSE onboarding_step
                             END,
       updated_at          = now()
     WHERE id = $1
     RETURNING *`,
    [
      id.toString(),
      data.full_name,
      data.email ?? null,
      data.gender,
      data.date_of_birth,
      data.residential_address,
      data.state,
      data.city,
      data.pincode,
      data.experience_years,
      data.emergency_contact,
      data.languages_known,
    ]
  )
  return rows[0]!
}

export async function updateIdentityDocuments(
  id: bigint,
  licenseNumber: string,
  aadhaarNumber: string
): Promise<void> {
  await query(
    'UPDATE drivers SET license_number = $2, aadhaar_number = $3, updated_at = now() WHERE id = $1',
    [id.toString(), licenseNumber, aadhaarNumber]
  )
}

export async function setOnboardingStep(id: bigint, step: string): Promise<void> {
  await query(
    'UPDATE drivers SET onboarding_step = $2, updated_at = now() WHERE id = $1',
    [id.toString(), step]
  )
}

export async function updateDriverStatus(
  id: bigint,
  status: string,
  step?: string
): Promise<void> {
  await query(
    `UPDATE drivers SET status = $2, onboarding_step = COALESCE($3, onboarding_step), updated_at = now() WHERE id = $1`,
    [id.toString(), status, step ?? null]
  )
}

export async function createStatusHistory(params: {
  driverId: bigint
  fromStatus: string | null
  toStatus: string
  reason: string
  changedBy?: bigint
}): Promise<void> {
  await query(
    `INSERT INTO driver_status_history (driver_id, from_status, to_status, reason, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.driverId.toString(),
      params.fromStatus,
      params.toStatus,
      params.reason,
      params.changedBy?.toString() ?? null,
    ]
  )
}

export async function findLatestDocsRejectedReason(driverId: bigint): Promise<string | null> {
  const rows = await query<{ reason: string | null }>(
    `SELECT reason FROM driver_status_history
     WHERE driver_id = $1 AND to_status = 'docs_rejected'
     ORDER BY created_at DESC LIMIT 1`,
    [driverId.toString()]
  )
  return rows[0]?.reason ?? null
}

// ── Driver vehicles ───────────────────────────────────────────────────────────

export async function findVehicleByDriverId(driverId: bigint): Promise<DriverVehicle | null> {
  const rows = await query<DriverVehicle>(
    'SELECT * FROM driver_vehicles WHERE driver_id = $1 AND is_primary = true LIMIT 1',
    [driverId.toString()]
  )
  return rows[0] ?? null
}

export async function upsertVehicle(
  driverId: bigint,
  data: {
    category_id: number
    brand_id: number
    model_id?: number
    vehicle_name: string
    model_year: number
    number_plate: string
    color: string
    fuel_type: string
    seating_capacity: number
    luggage_capacity: number
    ac_availability: boolean
    registration_date?: string
  }
): Promise<DriverVehicle> {
  const existing = await findVehicleByDriverId(driverId)

  if (existing) {
    const rows = await query<DriverVehicle>(
      `UPDATE driver_vehicles SET
         category_id       = $2,
         brand_id          = $3,
         model_id          = $4,
         vehicle_name      = $5,
         model_year        = $6,
         number_plate      = $7,
         color             = $8,
         fuel_type         = $9,
         seating_capacity  = $10,
         luggage_capacity  = $11,
         ac_availability   = $12,
         registration_date = $13,
         updated_at        = now()
       WHERE id = $1
       RETURNING *`,
      [
        existing.id,
        data.category_id,
        data.brand_id,
        data.model_id ?? null,
        data.vehicle_name,
        data.model_year,
        data.number_plate,
        data.color,
        data.fuel_type,
        data.seating_capacity,
        data.luggage_capacity,
        data.ac_availability,
        data.registration_date ?? null,
      ]
    )
    return rows[0]!
  }

  const rows = await query<DriverVehicle>(
    `INSERT INTO driver_vehicles
       (driver_id, category_id, brand_id, model_id, vehicle_name, model_year, number_plate,
        color, fuel_type, seating_capacity, luggage_capacity, ac_availability, registration_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      driverId.toString(),
      data.category_id,
      data.brand_id,
      data.model_id ?? null,
      data.vehicle_name,
      data.model_year,
      data.number_plate,
      data.color,
      data.fuel_type,
      data.seating_capacity,
      data.luggage_capacity,
      data.ac_availability,
      data.registration_date ?? null,
    ]
  )
  return rows[0]!
}

export async function setReferenceSelfie(driverId: bigint, fileUrl: string): Promise<void> {
  await query(
    `UPDATE drivers SET reference_selfie_url = $2, updated_at = now() WHERE id = $1`,
    [driverId.toString(), fileUrl]
  )
}

// ── Driver documents ──────────────────────────────────────────────────────────

export async function upsertDriverDocument(
  driverId: bigint,
  docType: string,
  fileUrl: string,
  validFrom?: Date,
  validUntil?: Date
): Promise<DriverDocument> {
  const rows = await query<DriverDocument>(
    `INSERT INTO driver_documents (driver_id, doc_type, file_url, valid_from, valid_until)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (driver_id, doc_type)
     DO UPDATE SET
       file_url    = EXCLUDED.file_url,
       valid_from  = COALESCE(EXCLUDED.valid_from,  driver_documents.valid_from),
       valid_until = COALESCE(EXCLUDED.valid_until, driver_documents.valid_until),
       status      = 'pending',
       updated_at  = now()
     RETURNING *`,
    [driverId.toString(), docType, fileUrl, validFrom ?? null, validUntil ?? null]
  )
  return rows[0]!
}

export async function findDriverDocuments(driverId: bigint): Promise<DriverDocument[]> {
  return query<DriverDocument>(
    'SELECT * FROM driver_documents WHERE driver_id = $1',
    [driverId.toString()]
  )
}

// ── Vehicle documents ─────────────────────────────────────────────────────────

export async function upsertVehicleDocument(
  vehicleId: string,
  docType: string,
  fileUrl: string,
  docNumber?: string,
  validUntil?: Date
): Promise<DriverVehicleDocument> {
  const rows = await query<DriverVehicleDocument>(
    `INSERT INTO driver_vehicle_documents (vehicle_id, doc_type, file_url, doc_number, valid_until)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (vehicle_id, doc_type)
     DO UPDATE SET
       file_url    = EXCLUDED.file_url,
       doc_number  = COALESCE(EXCLUDED.doc_number, driver_vehicle_documents.doc_number),
       valid_until = COALESCE(EXCLUDED.valid_until, driver_vehicle_documents.valid_until),
       status      = 'pending',
       updated_at  = now()
     RETURNING *`,
    [vehicleId, docType, fileUrl, docNumber ?? null, validUntil ?? null]
  )
  return rows[0]!
}

export async function findVehicleDocuments(vehicleId: string): Promise<DriverVehicleDocument[]> {
  return query<DriverVehicleDocument>(
    'SELECT * FROM driver_vehicle_documents WHERE vehicle_id = $1',
    [vehicleId]
  )
}
