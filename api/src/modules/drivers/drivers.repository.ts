import type { PoolClient } from 'pg'
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

// Drives which wallet UI the driver app shows (Wallet.tsx vs RechargePackage.tsx)
// — mirrors the same drivers.city_id -> cities.billing_mode resolution used at
// go-online/accept-ride, no GPS fallback. NULL if the driver has no assigned
// city (matches the CITY_NOT_ASSIGNED gate on going online).
export async function getDriverBillingMode(id: bigint): Promise<'commission' | 'package' | null> {
  const rows = await query<{ billing_mode: 'commission' | 'package' }>(
    `SELECT c.billing_mode FROM drivers d
     JOIN cities c ON c.id = d.city_id AND c.status = 'active'
     WHERE d.id = $1`,
    [id.toString()]
  )
  return rows[0]?.billing_mode ?? null
}

export async function countCompletedRides(driverId: bigint): Promise<number> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM rides WHERE driver_id = $1 AND status = 'completed'`,
    [driverId.toString()]
  )
  return Number(rows[0]?.count ?? 0)
}

export async function updateProfile(
  id: bigint,
  data: { full_name: string; email?: string }
): Promise<Driver> {
  const params: unknown[] = [data.full_name, id.toString()]
  let sql = 'UPDATE drivers SET full_name = $1, updated_at = now()'
  if (data.email !== undefined) {
    sql += ', email = $3'
    params.push(data.email)
  }
  sql += ' WHERE id = $2 RETURNING *'
  const rows = await query<Driver>(sql, params)
  return rows[0]!
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
    city_id?: number
    pincode: string
    experience_years: number
    emergency_contact: string
    languages_known: string[]
  }
): Promise<Driver> {
  // city_id comes straight from the frontend's city dropdown (sourced from
  // the `cities` table, see PersonalDetails.tsx) — no name-matching. Only
  // falls back to a name lookup for older clients that haven't picked up the
  // city_id field yet; NULL for a free-text entry outside the fixed city list
  // (non-Odisha state), which is caught at go-online time.
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
       city_id             = COALESCE($13, (SELECT id FROM cities WHERE lower(name) = lower($8::varchar) LIMIT 1)),
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
      data.city_id ?? null,
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

// True if none of the driver's identity/vehicle documents are rejected or an
// expired-but-still-approved row (a document approved in the past whose
// valid_until has since passed) — the live rollup goOnline() gates on.
// Pass a transaction client when this must participate in a caller's lock
// (see admin.repository.ts's syncDriverStatusAfterDocChange) — otherwise runs
// through the shared pool.
export async function hasApprovedRequiredDocs(driverId: bigint, client?: PoolClient): Promise<boolean> {
  const sql = `SELECT EXISTS (
       SELECT 1 FROM driver_documents
       WHERE driver_id = $1
         AND (status = 'rejected' OR (status = 'approved' AND valid_until < CURRENT_DATE))
       UNION ALL
       SELECT 1 FROM driver_vehicle_documents dvd
       JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
       WHERE dv.driver_id = $1 AND dv.is_primary = true
         AND (dvd.status = 'rejected' OR (dvd.status = 'approved' AND dvd.valid_until < CURRENT_DATE))
     ) AS has_issue`
  const params = [driverId.toString()]
  const rows = client
    ? (await client.query<{ has_issue: boolean }>(sql, params)).rows
    : await query<{ has_issue: boolean }>(sql, params)
  return !rows[0]!.has_issue
}

const EXPIRY_REMINDER_DAYS = [30, 15, 7, 1]

export interface ExpiringDocNotice {
  driverId: string
  docType: string
  daysRemaining: number
  route: 'documents' | 'vehicle-docs'
}

// Approved documents landing on one of the reminder thresholds today, or
// expiring today (daysRemaining 0) — driven by the daily sweep_document_expiry
// job. Exact-day matching (not "<= N days") keeps each threshold a one-shot
// notification instead of a repeat every day inside the window.
export async function findDocsNeedingExpiryNotice(): Promise<ExpiringDocNotice[]> {
  const thresholds = [...EXPIRY_REMINDER_DAYS, 0]
  const rows = await query<{ driver_id: string; doc_type: string; days_remaining: number; route: 'documents' | 'vehicle-docs' }>(
    `SELECT driver_id, doc_type, days_remaining, 'documents'::text AS route FROM (
       SELECT driver_id::text, doc_type,
              (valid_until - CURRENT_DATE) AS days_remaining
       FROM driver_documents
       WHERE status = 'approved' AND valid_until IS NOT NULL
     ) d
     WHERE days_remaining = ANY($1::int[])
     UNION ALL
     SELECT driver_id, doc_type, days_remaining, 'vehicle-docs'::text AS route FROM (
       SELECT dv.driver_id::text AS driver_id, dvd.doc_type,
              (dvd.valid_until - CURRENT_DATE) AS days_remaining
       FROM driver_vehicle_documents dvd
       JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
       WHERE dvd.status = 'approved' AND dvd.valid_until IS NOT NULL
     ) v
     WHERE days_remaining = ANY($1::int[])`,
    [thresholds]
  )
  return rows.map(r => ({
    driverId: r.driver_id,
    docType: r.doc_type,
    daysRemaining: r.days_remaining,
    route: r.route,
  }))
}
