import { pool } from '@/db/client'
import type { AdminDriverListRow, AdminDriverDetail, DriverStatus } from './admin.types'

export async function listDrivers(filters: {
  status?: string
  search?: string
  limit: number
  offset: number
}): Promise<{ rows: AdminDriverListRow[]; total: number }> {
  const conditions: string[] = []
  const params: unknown[] = []
  let p = 1

  if (filters.status) {
    conditions.push(`d.status = $${p++}`)
    params.push(filters.status)
  }

  if (filters.search) {
    conditions.push(`(d.phone ILIKE $${p} OR d.full_name ILIKE $${p} OR d.code ILIKE $${p})`)
    params.push(`%${filters.search}%`)
    p++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM drivers d ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query(
    `SELECT
       d.id, d.code, d.phone, d.full_name, d.email,
       d.status, d.onboarding_step, d.created_at,
       v.number_plate, v.vehicle_name,
       vc.display_name AS vehicle_category,
       (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id) AS docs_submitted,
       (SELECT COUNT(*) FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.status = 'approved') AS docs_approved
     FROM drivers d
     LEFT JOIN driver_vehicles v ON v.driver_id = d.id
     LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
     ${where}
     ORDER BY d.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, filters.limit, filters.offset]
  )

  const rows: AdminDriverListRow[] = dataRes.rows.map(r => ({
    id: String(r.id),
    code: r.code as string,
    phone: r.phone as string,
    full_name: r.full_name as string | null,
    email: r.email as string | null,
    status: r.status as DriverStatus,
    onboarding_step: r.onboarding_step as string,
    created_at: r.created_at as string,
    vehicle: r.number_plate
      ? { number_plate: r.number_plate as string, vehicle_name: r.vehicle_name as string, category: r.vehicle_category as string }
      : null,
    docs_submitted: parseInt(r.docs_submitted as string, 10),
    docs_approved: parseInt(r.docs_approved as string, 10),
  }))

  return { rows, total }
}

export async function getDriverById(id: bigint): Promise<AdminDriverDetail | null> {
  const driverRes = await pool.query(
    `SELECT
       d.*,
       v.id AS vehicle_id, v.number_plate, v.vehicle_name, v.model_year,
       v.color, v.fuel_type, v.seating_capacity, v.luggage_capacity, v.ac_availability,
       vc.display_name AS vehicle_category,
       vb.name AS vehicle_brand
     FROM drivers d
     LEFT JOIN driver_vehicles v ON v.driver_id = d.id
     LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
     LEFT JOIN vehicle_brands vb ON vb.id = v.brand_id
     WHERE d.id = $1`,
    [id]
  )

  if (!driverRes.rows.length) return null
  const r = driverRes.rows[0]

  const [docsRes, vehicleDocsRes, historyRes] = await Promise.all([
    pool.query(
      `SELECT doc_type, file_url, status, rejection_note FROM driver_documents WHERE driver_id = $1 ORDER BY doc_type`,
      [id]
    ),
    pool.query(
      `SELECT dvd.doc_type, dvd.file_url, dvd.status, dvd.rejection_note
       FROM driver_vehicle_documents dvd
       JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
       WHERE dv.driver_id = $1
       ORDER BY dvd.doc_type`,
      [id]
    ),
    pool.query(
      `SELECT from_status, to_status, reason, created_at
       FROM driver_status_history
       WHERE driver_id = $1
       ORDER BY created_at DESC`,
      [id]
    ),
  ])

  return {
    id: String(r.id),
    code: r.code as string,
    phone: r.phone as string,
    full_name: r.full_name as string | null,
    email: r.email as string | null,
    gender: r.gender as string | null,
    date_of_birth: r.date_of_birth as string | null,
    residential_address: r.residential_address as string | null,
    state: r.state as string | null,
    city: r.city as string | null,
    pincode: r.pincode as string | null,
    experience_years: r.experience_years as number | null,
    emergency_contact: r.emergency_contact as string | null,
    languages_known: (r.languages_known as string[]) ?? [],
    aadhaar_number: r.aadhaar_number as string | null,
    license_number: r.license_number as string | null,
    status: r.status as DriverStatus,
    onboarding_step: r.onboarding_step as string,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    vehicle: r.vehicle_id ? {
      id: String(r.vehicle_id),
      number_plate: r.number_plate as string,
      vehicle_name: r.vehicle_name as string,
      model_year: r.model_year as number,
      color: r.color as string,
      fuel_type: r.fuel_type as string,
      seating_capacity: r.seating_capacity as number,
      luggage_capacity: r.luggage_capacity as number,
      ac_availability: r.ac_availability as boolean,
      category: r.vehicle_category as string,
      brand: r.vehicle_brand as string,
    } : null,
    documents: docsRes.rows as AdminDriverDetail['documents'],
    vehicle_documents: vehicleDocsRes.rows as AdminDriverDetail['vehicle_documents'],
    status_history: historyRes.rows as AdminDriverDetail['status_history'],
  }
}

export async function updateDriverStatus(
  driverId: bigint,
  adminId: bigint,
  fromStatus: DriverStatus,
  toStatus: DriverStatus,
  reason?: string
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE drivers SET status = $1, updated_at = now() WHERE id = $2`,
      [toStatus, driverId]
    )
    await client.query(
      `INSERT INTO driver_status_history (driver_id, from_status, to_status, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [driverId, fromStatus, toStatus, reason ?? null, adminId]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
