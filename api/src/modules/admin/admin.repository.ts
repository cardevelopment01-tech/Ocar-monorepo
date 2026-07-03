import { pool } from '@/db/client'
import type {
  AdminDriverListRow, AdminDriverDetail, DriverStatus,
  AdminVehicleCategory, AdminVehicleBrand, AdminVehicleModel,
  FleetVehicle, PendingVehicleDoc, ExpiringVehicleDoc,
  AdminCity, AdminDashboardStats, ActiveDriverSession, AdminRentalPackage,
} from './admin.types'

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
      `SELECT id::text, doc_type, file_url, status, rejection_note FROM driver_documents WHERE driver_id = $1 ORDER BY doc_type`,
      [id]
    ),
    pool.query(
      `SELECT dvd.id::text, dvd.doc_type, dvd.file_url, dvd.status, dvd.rejection_note
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
  reason?: string,
  onboardingStep?: string
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (toStatus === 'active') {
      await client.query(
        `UPDATE drivers
         SET status = $1,
             onboarding_step = COALESCE($3, onboarding_step),
             approved_by  = $4,
             approved_at  = now(),
             updated_at   = now()
         WHERE id = $2`,
        [toStatus, driverId, onboardingStep ?? null, adminId]
      )
    } else {
      await client.query(
        `UPDATE drivers
         SET status = $1,
             onboarding_step = COALESCE($3, onboarding_step),
             updated_at   = now()
         WHERE id = $2`,
        [toStatus, driverId, onboardingStep ?? null]
      )
    }
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

// ─── Vehicle categories ───────────────────────────────────────────────────────

export async function listAdminCategories(): Promise<AdminVehicleCategory[]> {
  const res = await pool.query(
    `SELECT vc.id, vc.slug, vc.display_name, vc.max_passengers, vc.is_active, vc.created_at,
            COUNT(dv.id)::int AS driver_count
     FROM vehicle_categories vc
     LEFT JOIN driver_vehicles dv ON dv.category_id = vc.id
     GROUP BY vc.id
     ORDER BY vc.display_name`
  )
  return res.rows.map(r => ({
    id: String(r.id), slug: r.slug as string, display_name: r.display_name as string,
    max_passengers: r.max_passengers as number, is_active: r.is_active as boolean,
    created_at: r.created_at as string, driver_count: r.driver_count as number,
  }))
}

export async function createCategory(data: {
  slug: string; display_name: string; max_passengers: number; is_active: boolean
}): Promise<AdminVehicleCategory> {
  const res = await pool.query(
    `INSERT INTO vehicle_categories (slug, display_name, max_passengers, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id, slug, display_name, max_passengers, is_active, created_at`,
    [data.slug, data.display_name, data.max_passengers, data.is_active]
  )
  const r = res.rows[0]
  return { id: String(r.id), slug: r.slug, display_name: r.display_name,
           max_passengers: r.max_passengers, is_active: r.is_active,
           created_at: r.created_at, driver_count: 0 }
}

export async function updateCategory(
  id: bigint,
  data: { display_name?: string; max_passengers?: number; is_active?: boolean }
): Promise<AdminVehicleCategory | null> {
  const sets: string[] = []
  const params: unknown[] = []
  let p = 1
  if (data.display_name !== undefined) { sets.push(`display_name = $${p++}`); params.push(data.display_name) }
  if (data.max_passengers !== undefined) { sets.push(`max_passengers = $${p++}`); params.push(data.max_passengers) }
  if (data.is_active !== undefined) { sets.push(`is_active = $${p++}`); params.push(data.is_active) }
  if (!sets.length) return null
  params.push(id)
  const res = await pool.query(
    `UPDATE vehicle_categories SET ${sets.join(', ')} WHERE id = $${p}
     RETURNING id, slug, display_name, max_passengers, is_active, created_at`,
    params
  )
  if (!res.rows.length) return null
  const r = res.rows[0]
  return { id: String(r.id), slug: r.slug, display_name: r.display_name,
           max_passengers: r.max_passengers, is_active: r.is_active,
           created_at: r.created_at, driver_count: 0 }
}

// ─── Vehicle brands ───────────────────────────────────────────────────────────

export async function listAdminBrands(): Promise<AdminVehicleBrand[]> {
  const res = await pool.query(
    `SELECT vb.id, vb.name, vb.logo_url, vb.is_active, vb.created_at,
            COUNT(vm.id)::int AS model_count
     FROM vehicle_brands vb
     LEFT JOIN vehicle_models vm ON vm.brand_id = vb.id
     GROUP BY vb.id
     ORDER BY vb.name`
  )
  return res.rows.map(r => ({
    id: String(r.id), name: r.name as string, logo_url: r.logo_url as string | null,
    is_active: r.is_active as boolean, created_at: r.created_at as string,
    model_count: r.model_count as number,
  }))
}

export async function createBrand(data: { name: string; is_active: boolean }): Promise<AdminVehicleBrand> {
  const res = await pool.query(
    `INSERT INTO vehicle_brands (name, is_active) VALUES ($1, $2)
     RETURNING id, name, logo_url, is_active, created_at`,
    [data.name, data.is_active]
  )
  const r = res.rows[0]
  return { id: String(r.id), name: r.name, logo_url: r.logo_url, is_active: r.is_active,
           created_at: r.created_at, model_count: 0 }
}

export async function updateBrand(
  id: bigint,
  data: { name?: string; is_active?: boolean }
): Promise<AdminVehicleBrand | null> {
  const sets: string[] = []
  const params: unknown[] = []
  let p = 1
  if (data.name !== undefined) { sets.push(`name = $${p++}`); params.push(data.name) }
  if (data.is_active !== undefined) { sets.push(`is_active = $${p++}`); params.push(data.is_active) }
  if (!sets.length) return null
  params.push(id)
  const res = await pool.query(
    `UPDATE vehicle_brands SET ${sets.join(', ')} WHERE id = $${p}
     RETURNING id, name, logo_url, is_active, created_at`,
    params
  )
  if (!res.rows.length) return null
  const r = res.rows[0]
  return { id: String(r.id), name: r.name, logo_url: r.logo_url, is_active: r.is_active,
           created_at: r.created_at, model_count: 0 }
}

// ─── Vehicle models ───────────────────────────────────────────────────────────

export async function listAdminModels(brandId?: bigint): Promise<AdminVehicleModel[]> {
  const params: unknown[] = []
  const where = brandId ? (params.push(brandId), 'WHERE vm.brand_id = $1') : ''
  const res = await pool.query(
    `SELECT vm.id, vm.brand_id, vm.name, vm.typical_category_id, vm.is_active, vm.created_at,
            vb.name AS brand_name,
            vc.display_name AS typical_category_name
     FROM vehicle_models vm
     JOIN vehicle_brands vb ON vb.id = vm.brand_id
     LEFT JOIN vehicle_categories vc ON vc.id = vm.typical_category_id
     ${where}
     ORDER BY vb.name, vm.name`,
    params
  )
  return res.rows.map(r => ({
    id: String(r.id), brand_id: String(r.brand_id), name: r.name as string,
    typical_category_id: r.typical_category_id ? String(r.typical_category_id) : null,
    is_active: r.is_active as boolean, created_at: r.created_at as string,
    brand_name: r.brand_name as string, typical_category_name: r.typical_category_name as string | null,
  }))
}

export async function createModel(data: {
  brand_id: bigint; name: string; typical_category_id?: bigint | null; is_active: boolean
}): Promise<AdminVehicleModel> {
  const res = await pool.query(
    `INSERT INTO vehicle_models (brand_id, name, typical_category_id, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id, brand_id, name, typical_category_id, is_active, created_at`,
    [data.brand_id, data.name, data.typical_category_id ?? null, data.is_active]
  )
  const r = res.rows[0]
  return { id: String(r.id), brand_id: String(r.brand_id), name: r.name,
           typical_category_id: r.typical_category_id ? String(r.typical_category_id) : null,
           is_active: r.is_active, created_at: r.created_at,
           brand_name: '', typical_category_name: null }
}

export async function updateModel(
  id: bigint,
  data: { name?: string; typical_category_id?: bigint | null; is_active?: boolean }
): Promise<AdminVehicleModel | null> {
  const sets: string[] = []
  const params: unknown[] = []
  let p = 1
  if (data.name !== undefined) { sets.push(`name = $${p++}`); params.push(data.name) }
  if ('typical_category_id' in data) { sets.push(`typical_category_id = $${p++}`); params.push(data.typical_category_id ?? null) }
  if (data.is_active !== undefined) { sets.push(`is_active = $${p++}`); params.push(data.is_active) }
  if (!sets.length) return null
  params.push(id)
  const res = await pool.query(
    `UPDATE vehicle_models SET ${sets.join(', ')} WHERE id = $${p}
     RETURNING id, brand_id, name, typical_category_id, is_active, created_at`,
    params
  )
  if (!res.rows.length) return null
  const r = res.rows[0]
  return { id: String(r.id), brand_id: String(r.brand_id), name: r.name,
           typical_category_id: r.typical_category_id ? String(r.typical_category_id) : null,
           is_active: r.is_active, created_at: r.created_at,
           brand_name: '', typical_category_name: null }
}

// ─── Fleet ────────────────────────────────────────────────────────────────────

export async function listFleet(status?: string): Promise<FleetVehicle[]> {
  const params: unknown[] = []
  const where = status ? (params.push(status), 'WHERE dv.status = $1') : ''
  const res = await pool.query(
    `SELECT dv.id, dv.driver_id, dv.vehicle_name, dv.number_plate,
            dv.status, dv.is_primary, dv.created_at,
            d.full_name AS driver_name, d.code AS driver_code, d.phone AS driver_phone,
            vc.display_name AS category,
            vb.name AS brand
     FROM driver_vehicles dv
     JOIN drivers d ON d.id = dv.driver_id
     LEFT JOIN vehicle_categories vc ON vc.id = dv.category_id
     LEFT JOIN vehicle_brands vb ON vb.id = dv.brand_id
     ${where}
     ORDER BY dv.created_at DESC`,
    params
  )
  return res.rows.map(r => ({
    id: String(r.id), driver_id: String(r.driver_id),
    driver_name: r.driver_name as string | null, driver_code: r.driver_code as string,
    driver_phone: r.driver_phone as string, vehicle_name: r.vehicle_name as string | null,
    number_plate: r.number_plate as string | null, category: r.category as string | null,
    brand: r.brand as string | null, status: r.status as FleetVehicle['status'],
    is_primary: r.is_primary as boolean, created_at: r.created_at as string,
  }))
}

export async function blacklistVehicle(
  vehicleId: bigint, adminId: bigint, reason: string
): Promise<{ driver_suspended: boolean }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const vehicleRes = await client.query(
      `SELECT driver_id, is_primary FROM driver_vehicles WHERE id = $1`,
      [vehicleId]
    )
    if (!vehicleRes.rows.length) throw new Error('Vehicle not found')
    const { driver_id, is_primary } = vehicleRes.rows[0] as { driver_id: bigint; is_primary: boolean }

    await client.query(
      `UPDATE driver_vehicles SET status = 'blacklisted', updated_at = now() WHERE id = $1`,
      [vehicleId]
    )

    let driver_suspended = false
    if (is_primary) {
      const driverRes = await client.query(
        `SELECT status FROM drivers WHERE id = $1`, [driver_id]
      )
      const fromStatus = driverRes.rows[0]?.status as string ?? 'active'
      await client.query(
        `UPDATE drivers SET status = 'suspended', updated_at = now() WHERE id = $1`,
        [driver_id]
      )
      await client.query(
        `INSERT INTO driver_status_history (driver_id, from_status, to_status, reason, changed_by)
         VALUES ($1, $2, 'suspended', $3, $4)`,
        [driver_id, fromStatus, `Vehicle blacklisted: ${reason}`, adminId]
      )
      driver_suspended = true
    }

    await client.query('COMMIT')
    return { driver_suspended }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function unblacklistVehicle(vehicleId: bigint): Promise<void> {
  await pool.query(
    `UPDATE driver_vehicles SET status = 'active', updated_at = now() WHERE id = $1`,
    [vehicleId]
  )
}

// ─── Vehicle documents ────────────────────────────────────────────────────────

export async function listPendingVehicleDocs(): Promise<PendingVehicleDoc[]> {
  const res = await pool.query(
    `SELECT dvd.id, dvd.vehicle_id, dvd.doc_type, dvd.file_url, dvd.doc_number,
            dvd.status, dvd.created_at,
            dv.number_plate, dv.vehicle_name,
            d.full_name AS driver_name, d.code AS driver_code
     FROM driver_vehicle_documents dvd
     JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
     JOIN drivers d ON d.id = dv.driver_id
     WHERE dvd.status = 'pending'
     ORDER BY dvd.created_at ASC`
  )
  return res.rows.map(r => ({
    id: String(r.id), vehicle_id: String(r.vehicle_id), doc_type: r.doc_type as string,
    file_url: r.file_url as string, doc_number: r.doc_number as string | null,
    status: r.status as string, created_at: r.created_at as string,
    number_plate: r.number_plate as string | null, vehicle_name: r.vehicle_name as string | null,
    driver_name: r.driver_name as string | null, driver_code: r.driver_code as string,
  }))
}

export async function approveDriverDoc(docId: bigint, adminId: bigint): Promise<void> {
  await pool.query(
    `UPDATE driver_documents
     SET status = 'approved', reviewed_by = $1, reviewed_at = now(), updated_at = now()
     WHERE id = $2`,
    [adminId, docId]
  )
}

export async function rejectDriverDoc(
  docId: bigint, adminId: bigint, rejectionNote: string
): Promise<void> {
  await pool.query(
    `UPDATE driver_documents
     SET status = 'rejected', rejection_note = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
     WHERE id = $3`,
    [rejectionNote, adminId, docId]
  )
}

export async function approveVehicleDoc(docId: bigint, adminId: bigint): Promise<void> {
  await pool.query(
    `UPDATE driver_vehicle_documents
     SET status = 'approved', reviewed_by = $1, reviewed_at = now(), updated_at = now()
     WHERE id = $2`,
    [adminId, docId]
  )
}

export async function rejectVehicleDoc(
  docId: bigint, adminId: bigint, rejectionNote: string
): Promise<void> {
  await pool.query(
    `UPDATE driver_vehicle_documents
     SET status = 'rejected', rejection_note = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
     WHERE id = $3`,
    [rejectionNote, adminId, docId]
  )
}

export async function listExpiringDocs(daysAhead: number): Promise<ExpiringVehicleDoc[]> {
  const res = await pool.query(
    `SELECT dvd.id, dvd.vehicle_id, dvd.doc_type, dvd.file_url, dvd.valid_until,
            dv.number_plate, dv.vehicle_name,
            d.full_name AS driver_name, d.phone AS driver_phone, d.code AS driver_code
     FROM driver_vehicle_documents dvd
     JOIN driver_vehicles dv ON dv.id = dvd.vehicle_id
     JOIN drivers d ON d.id = dv.driver_id
     WHERE dvd.status = 'approved'
       AND dvd.valid_until IS NOT NULL
       AND dvd.valid_until <= now() + ($1 || ' days')::interval
       AND dvd.valid_until >= now()
     ORDER BY dvd.valid_until ASC`,
    [daysAhead]
  )
  return res.rows.map(r => ({
    id: String(r.id), vehicle_id: String(r.vehicle_id), doc_type: r.doc_type as string,
    file_url: r.file_url as string, valid_until: r.valid_until as string,
    number_plate: r.number_plate as string | null, vehicle_name: r.vehicle_name as string | null,
    driver_name: r.driver_name as string | null, driver_phone: r.driver_phone as string,
    driver_code: r.driver_code as string,
  }))
}

// ─── Geo / Cities ─────────────────────────────────────────────────────────────

const ADMIN_CITY_COLS = `
  id, name, slug, state,
  ST_Y(centroid::geometry) AS centroid_lat,
  ST_X(centroid::geometry) AS centroid_lng,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled,
  created_at
`

export async function listAdminCities(): Promise<AdminCity[]> {
  const res = await pool.query(
    `SELECT ${ADMIN_CITY_COLS} FROM cities ORDER BY name`
  )
  return res.rows as AdminCity[]
}

export async function createAdminCity(data: {
  name: string
  slug: string
  state: string
  centroid_lat: number
  centroid_lng: number
  default_speed_limit_kmph: number
  is_rental_enabled: boolean
  is_return_cab_enabled: boolean
  created_by: bigint
}): Promise<AdminCity> {
  const res = await pool.query(
    `INSERT INTO cities
       (name, slug, state, centroid,
        default_speed_limit_kmph,
        is_rental_enabled, is_return_cab_enabled,
        created_by)
     VALUES (
       $1, $2, $3,
       ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326)::geography,
       $6, $7, $8, $9
     )
     RETURNING ${ADMIN_CITY_COLS}`,
    [
      data.name, data.slug, data.state,
      data.centroid_lat, data.centroid_lng,
      data.default_speed_limit_kmph,
      data.is_rental_enabled,
      data.is_return_cab_enabled,
      data.created_by,
    ]
  )
  return res.rows[0] as AdminCity
}

export async function updateAdminCity(
  id: bigint,
  data: {
    name?: string
    state?: string
    default_speed_limit_kmph?: number
    status?: string
    is_rental_enabled?: boolean
    is_return_cab_enabled?: boolean
  }
): Promise<AdminCity | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let p = 1

  if (data.name !== undefined)                    { sets.push(`name = $${p++}`);                     values.push(data.name) }
  if (data.state !== undefined)                   { sets.push(`state = $${p++}`);                    values.push(data.state) }
  if (data.default_speed_limit_kmph !== undefined){ sets.push(`default_speed_limit_kmph = $${p++}`); values.push(data.default_speed_limit_kmph) }
  if (data.status !== undefined)                  { sets.push(`status = $${p++}`);                   values.push(data.status) }
  if (data.is_rental_enabled !== undefined)       { sets.push(`is_rental_enabled = $${p++}`);        values.push(data.is_rental_enabled) }
  if (data.is_return_cab_enabled !== undefined)   { sets.push(`is_return_cab_enabled = $${p++}`);    values.push(data.is_return_cab_enabled) }

  if (!sets.length) {
    const res = await pool.query(`SELECT ${ADMIN_CITY_COLS} FROM cities WHERE id = $1`, [id])
    return res.rows[0] ?? null
  }

  values.push(id)
  const res = await pool.query(
    `UPDATE cities SET ${sets.join(', ')} WHERE id = $${p} RETURNING ${ADMIN_CITY_COLS}`,
    values
  )
  return res.rows[0] ?? null
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

export async function listAdminRateCards() {
  const res = await pool.query(
    `SELECT rc.*,
            vc.display_name AS category_name,
            vc.slug AS category_slug
     FROM rate_cards rc
     JOIN vehicle_categories vc ON vc.id = rc.category_id
     WHERE rc.effective_to IS NULL
     ORDER BY vc.display_name, rc.ride_type`
  )
  return res.rows
}

export async function listAdminRateCardHistory() {
  const res = await pool.query(
    `SELECT rch.*,
            vc.display_name AS category_name,
            rc.ride_type,
            rc.category_id
     FROM rate_card_history rch
     JOIN rate_cards rc ON rc.id = rch.rate_card_id
     JOIN vehicle_categories vc ON vc.id = rc.category_id
     ORDER BY rch.created_at DESC
     LIMIT 100`
  )
  return res.rows
}

export async function listAdminSurgeEvents() {
  const res = await pool.query(
    `SELECT se.*,
            c.name AS city_name,
            vc.display_name AS category_name
     FROM surge_events se
     JOIN cities c ON c.id = se.city_id
     LEFT JOIN vehicle_categories vc ON vc.id = se.category_id
     ORDER BY se.created_at DESC`
  )
  return res.rows
}

export async function createAdminSurgeEvent(data: {
  cityId: number
  categoryId: number | null
  multiplier: number
  reason: string | null
  startsAt: string
  endsAt: string
  adminId: bigint
}) {
  const res = await pool.query(
    `INSERT INTO surge_events
       (city_id, category_id, multiplier, reason,
        status, starts_at, ends_at, created_by)
     VALUES ($1,$2,$3,$4,'scheduled',$5,$6,$7)
     RETURNING *`,
    [
      data.cityId, data.categoryId, data.multiplier, data.reason,
      data.startsAt, data.endsAt, data.adminId,
    ]
  )
  return res.rows[0]
}

export async function cancelAdminSurgeEvent(id: bigint, adminId: bigint) {
  const res = await pool.query(
    `UPDATE surge_events
     SET status = 'cancelled',
         cancelled_by = $2,
         cancelled_at = now()
     WHERE id = $1 AND status IN ('scheduled', 'active')
     RETURNING *`,
    [id, adminId]
  )
  return res.rows[0] ?? null
}

// ─── Rides (admin listing) ─────────────────────────────────────────────────────

export async function listAdminRides(filters: {
  status?: string
  ride_type?: string
  search?: string
  limit: number
  offset: number
}) {
  const conditions: string[] = []
  const params: unknown[] = []
  let p = 1

  if (filters.status) {
    conditions.push(`r.status = $${p++}`)
    params.push(filters.status)
  }
  if (filters.ride_type) {
    conditions.push(`r.ride_type = $${p++}`)
    params.push(filters.ride_type)
  }
  if (filters.search) {
    conditions.push(`(u.name ILIKE $${p} OR u.phone ILIKE $${p} OR r.id::text = $${p})`)
    params.push(`%${filters.search}%`)
    p++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM rides r JOIN users u ON u.id = r.user_id ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query(
    `SELECT
       r.id::text, r.status, r.ride_type, r.is_return_cab,
       r.origin_address, r.destination_address,
       r.requested_at, r.accepted_at, r.driver_arrived_at, r.started_at, r.completed_at,
       u.name AS user_name, u.phone AS user_phone,
       d.full_name AS driver_name, d.phone AS driver_phone,
       COALESCE(fs.total_final, fs.total_estimated)::text AS fare
     FROM rides r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN drivers d ON d.id = r.driver_id
     LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
     ${where}
     ORDER BY r.requested_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, filters.limit, filters.offset]
  )

  return { rows: dataRes.rows, total }
}

// ─── Rental Packages (admin CRUD) ────────────────────────────────────────────

export async function listAdminRentalPackages() {
  const res = await pool.query(
    `SELECT rp.id, rp.category_id, vc.display_name AS category_name, vc.slug AS category_slug,
            rp.duration_hours, rp.km_limit,
            rp.package_fare::text, rp.extra_per_km::text, rp.extra_per_min::text,
            rp.is_active, rp.updated_by, rp.created_at, rp.updated_at
     FROM rental_packages rp
     JOIN vehicle_categories vc ON vc.id = rp.category_id
     ORDER BY vc.display_name, rp.duration_hours`
  )
  return res.rows as AdminRentalPackage[]
}

export async function updateAdminRentalPackage(
  id: bigint,
  fields: { package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean },
  adminId: bigint,
) {
  const sets: string[] = []
  const params: unknown[] = []
  let p = 1

  if (fields.package_fare  !== undefined) { sets.push(`package_fare  = $${p++}`); params.push(fields.package_fare) }
  if (fields.extra_per_km  !== undefined) { sets.push(`extra_per_km  = $${p++}`); params.push(fields.extra_per_km) }
  if (fields.extra_per_min !== undefined) { sets.push(`extra_per_min = $${p++}`); params.push(fields.extra_per_min) }
  if (fields.is_active     !== undefined) { sets.push(`is_active     = $${p++}`); params.push(fields.is_active) }

  sets.push(`updated_by = $${p++}`)
  params.push(adminId)
  params.push(id)

  const res = await pool.query(
    `UPDATE rental_packages SET ${sets.join(', ')} WHERE id = $${p} RETURNING
       id, category_id, duration_hours, km_limit,
       package_fare::text, extra_per_km::text, extra_per_min::text,
       is_active, updated_by, created_at, updated_at`,
    params,
  )
  return res.rows[0] as AdminRentalPackage | undefined
}

export async function createAdminRentalPackage(
  fields: {
    category_id: number
    duration_hours: number
    package_fare: number
    extra_per_km: number
    extra_per_min: number
  },
  adminId: bigint,
) {
  const km_limit = fields.duration_hours * 10
  const res = await pool.query(
    `INSERT INTO rental_packages
       (category_id, duration_hours, km_limit, package_fare, extra_per_km, extra_per_min, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING
       id, category_id, duration_hours, km_limit,
       package_fare::text, extra_per_km::text, extra_per_min::text,
       is_active, updated_by, created_at, updated_at`,
    [fields.category_id, fields.duration_hours, km_limit,
     fields.package_fare, fields.extra_per_km, fields.extra_per_min, adminId],
  )
  return res.rows[0] as AdminRentalPackage
}

// ─── Users (admin listing + status update) ────────────────────────────────────

export async function listAdminUsers(filters: {
  status?: string
  search?: string
  limit: number
  offset: number
}) {
  const conditions: string[] = []
  const params: unknown[] = []
  let p = 1

  if (filters.status) {
    conditions.push(`u.status = $${p++}`)
    params.push(filters.status)
  }
  if (filters.search) {
    conditions.push(`(u.name ILIKE $${p} OR u.phone ILIKE $${p} OR COALESCE(u.email,'') ILIKE $${p})`)
    params.push(`%${filters.search}%`)
    p++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM users u ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query(
    `SELECT
       u.id::text, u.code, u.name, u.phone, u.email::text, u.status, u.created_at,
       u.rating_avg::text,
       COUNT(r.id)::int AS total_rides,
       COALESCE(w.balance::text, '0.00') AS wallet_balance
     FROM users u
     LEFT JOIN rides r ON r.user_id = u.id AND r.status = 'completed'
     LEFT JOIN user_wallets w ON w.user_id = u.id
     ${where}
     GROUP BY u.id, w.balance
     ORDER BY u.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, filters.limit, filters.offset]
  )

  return { rows: dataRes.rows, total }
}

export async function updateAdminUserStatus(userId: bigint, status: string): Promise<{ id: string; status: string } | null> {
  const res = await pool.query(
    `UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING id::text, status`,
    [userId, status]
  )
  return res.rows[0] ?? null
}

// ─── Payments (admin listing) ─────────────────────────────────────────────────

export async function listAdminPayments(filters: {
  channel?: string
  search?: string
  limit: number
  offset: number
}) {
  const conditions: string[] = []
  const params: unknown[] = []
  let p = 1

  if (filters.channel) {
    conditions.push(`p.channel = $${p++}`)
    params.push(filters.channel)
  }
  if (filters.search) {
    conditions.push(`(u.name ILIKE $${p} OR COALESCE(d.full_name,'') ILIKE $${p})`)
    params.push(`%${filters.search}%`)
    p++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRes = await pool.query(
    `SELECT COUNT(*)
     FROM payments p
     JOIN rides r ON r.id = p.ride_id
     JOIN users u ON u.id = r.user_id
     LEFT JOIN drivers d ON d.id = r.driver_id
     ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query(
    `SELECT
       p.id::text, p.status, p.channel, p.created_at,
       p.amount::text, p.commission_amount::text, p.driver_earning::text,
       r.id::text AS ride_id,
       u.name AS user_name,
       d.full_name AS driver_name
     FROM payments p
     JOIN rides r ON r.id = p.ride_id
     JOIN users u ON u.id = r.user_id
     LEFT JOIN drivers d ON d.id = r.driver_id
     ${where}
     ORDER BY p.created_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, filters.limit, filters.offset]
  )

  return { rows: dataRes.rows, total }
}

// ─── Rate cards ───────────────────────────────────────────────────────────────

export async function createAdminRateCard(data: {
  categoryId: number
  rideType: string
  ratePerKm: number
  ratePerMin: number
  minFare: number
  returnRatePerKm?: number | null
  hourRate?: number | null
  notes?: string | null
  adminId: bigint
}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const expired = await client.query(
      `UPDATE rate_cards
       SET effective_to = now()
       WHERE category_id = $1 AND ride_type = $2 AND effective_to IS NULL
       RETURNING *`,
      [data.categoryId, data.rideType]
    )

    if (expired.rows.length > 0) {
      const old = expired.rows[0]
      await client.query(
        `INSERT INTO rate_card_history
           (rate_card_id, rate_per_km, rate_per_min, min_fare,
            return_rate_per_km, hour_rate, changed_by, change_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          old.id, old.rate_per_km, old.rate_per_min, old.min_fare,
          old.return_rate_per_km, old.hour_rate,
          data.adminId, data.notes ?? null,
        ]
      )
    }

    const res = await client.query(
      `INSERT INTO rate_cards
         (category_id, ride_type, rate_per_km, rate_per_min,
          min_fare, return_rate_per_km, hour_rate, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        data.categoryId, data.rideType,
        data.ratePerKm, data.ratePerMin, data.minFare,
        data.returnRatePerKm ?? null,
        data.hourRate ?? null,
        data.notes ?? null,
        data.adminId,
      ]
    )

    await client.query('COMMIT')
    return res.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  const IST_TODAY = `(NOW() AT TIME ZONE 'Asia/Kolkata')::date`

  const [statsRes, chartRes] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM rides
         WHERE (requested_at AT TIME ZONE 'Asia/Kolkata')::date = ${IST_TODAY}
        )::int                                                              AS total_rides_today,
        (SELECT COUNT(*) FROM driver_sessions
         WHERE status IN ('online', 'on_trip')
        )::int                                                              AS active_drivers_online,
        (SELECT COALESCE(SUM(amount), 0) FROM payments
         WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = ${IST_TODAY}
           AND status = 'completed'
        )::numeric                                                          AS revenue_today,
        (SELECT COUNT(*) FROM disputes
         WHERE status IN ('open', 'under_review', 'pending_info', 'escalated')
        )::int                                                              AS open_disputes,
        (SELECT COUNT(*) FROM rides
         WHERE status = 'completed'
           AND (requested_at AT TIME ZONE 'Asia/Kolkata')::date = ${IST_TODAY}
        )::int                                                              AS completed_rides,
        (SELECT COUNT(*) FROM rides
         WHERE status = 'cancelled'
           AND (requested_at AT TIME ZONE 'Asia/Kolkata')::date = ${IST_TODAY}
        )::int                                                              AS cancelled_rides,
        (SELECT COUNT(*) FROM drivers
         WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = ${IST_TODAY}
        )::int                                                              AS new_driver_signups,
        (SELECT COUNT(*) FROM rides
         WHERE status IN ('accepted', 'driver_arrived', 'in_progress')
        )::int                                                              AS active_trips
    `),
    pool.query(`
      SELECT
        (11 - FLOOR(EXTRACT(EPOCH FROM (NOW() - requested_at)) / 3600)::int) AS bucket,
        COUNT(*)::int AS count
      FROM rides
      WHERE requested_at >= NOW() - INTERVAL '12 hours'
      GROUP BY bucket
      ORDER BY bucket
    `),
  ])

  const s = statsRes.rows[0]
  const chart = Array(12).fill(0) as number[]
  for (const row of chartRes.rows) {
    const b = parseInt(String(row.bucket), 10)
    if (b >= 0 && b < 12) chart[b] = parseInt(String(row.count), 10)
  }

  return {
    total_rides_today:     s.total_rides_today as number,
    active_drivers_online: s.active_drivers_online as number,
    revenue_today:         parseFloat(String(s.revenue_today)),
    open_disputes:         s.open_disputes as number,
    completed_rides:       s.completed_rides as number,
    cancelled_rides:       s.cancelled_rides as number,
    new_driver_signups:    s.new_driver_signups as number,
    active_trips:          s.active_trips as number,
    rides_last_12h:        chart,
  }
}

// ─── Active driver sessions (live map) ────────────────────────────────────────

export async function getActiveDriverSessions(): Promise<ActiveDriverSession[]> {
  const res = await pool.query(`
    SELECT
      ds.id::text                          AS session_id,
      ds.driver_id::text,
      ds.status                            AS session_status,
      d.full_name                          AS driver_name,
      d.phone                              AS driver_phone,
      d.code                               AS driver_code,
      ST_Y(dls.location::geometry)         AS lat,
      ST_X(dls.location::geometry)         AS lng,
      dls.heading,
      dls.speed_kmph,
      dls.updated_at                       AS location_updated_at,
      r.id::text                           AS ride_id,
      r.origin_address,
      r.destination_address,
      r.origin_lat,
      r.origin_lng,
      r.dest_lat,
      r.dest_lng
    FROM driver_sessions ds
    JOIN drivers d ON d.id = ds.driver_id
    LEFT JOIN driver_location_snapshots dls ON dls.driver_id = ds.driver_id
    LEFT JOIN rides r ON r.driver_id = ds.driver_id
      AND r.status IN ('accepted', 'driver_arrived', 'in_progress')
    WHERE ds.status IN ('online', 'on_trip')
    ORDER BY ds.went_online_at DESC
  `)

  return res.rows.map(r => ({
    session_id:          r.session_id as string,
    driver_id:           r.driver_id as string,
    driver_name:         r.driver_name as string | null,
    driver_phone:        r.driver_phone as string,
    driver_code:         r.driver_code as string,
    session_status:      r.session_status as 'online' | 'on_trip',
    lat:                 r.lat != null ? parseFloat(r.lat as string) : null,
    lng:                 r.lng != null ? parseFloat(r.lng as string) : null,
    heading:             r.heading != null ? parseFloat(r.heading as string) : null,
    speed_kmph:          r.speed_kmph != null ? parseFloat(r.speed_kmph as string) : null,
    location_updated_at: r.location_updated_at as string | null,
    ride_id:             r.ride_id as string | null,
    origin_address:      r.origin_address as string | null,
    destination_address: r.destination_address as string | null,
    origin_lat:          r.origin_lat != null ? parseFloat(r.origin_lat as string) : null,
    origin_lng:          r.origin_lng != null ? parseFloat(r.origin_lng as string) : null,
    dest_lat:            r.dest_lat   != null ? parseFloat(r.dest_lat   as string) : null,
    dest_lng:            r.dest_lng   != null ? parseFloat(r.dest_lng   as string) : null,
  }))
}
