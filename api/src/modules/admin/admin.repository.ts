import { pool, withTransaction } from '@/db/client'
import { client as redisClient } from '@/db/redis'
import { RATE_CARD_VERSION_KEY, CITIES_ALL_KEY, cityByIdKey } from '@/constants/redis-keys'
import { invalidate } from '@/lib/cache/reference-cache'
import { logger } from '@/lib/logger'
import { hasApprovedRequiredDocs } from '@/modules/drivers/drivers.repository'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { recordAuditLog } from '@/lib/audit-log'
import type {
  AdminDriverListRow, AdminDriverDetail, DriverStatus,
  AdminVehicleCategory, AdminVehicleBrand, AdminVehicleModel,
  FleetVehicle, PendingVehicleDoc, ExpiringVehicleDoc,
  AdminCity, AdminDashboardStats, ActiveDriverSession, AdminRentalPackage,
  AdminAccountListItem, UpdateDriverProfilePayload,
} from './admin.types'
import type { PackageTier, DriverPackageWallet, DriverPackageLedgerEntry } from '@/modules/packages/packages.types'

// Hardcoded whitelist, never built from request keys — this is the only thing
// standing between an admin body and a dynamic UPDATE (see CLAUDE.md SQL rules).
const PROFILE_EDITABLE_COLUMNS = [
  'full_name', 'email', 'gender', 'date_of_birth', 'residential_address',
  'state', 'city', 'pincode', 'experience_years', 'emergency_contact',
  'languages_known', 'aadhaar_number', 'license_number', 'city_id',
] as const

// Hardcoded whitelist, never built from request keys — same rationale as
// PROFILE_EDITABLE_COLUMNS above.
const VEHICLE_EDITABLE_COLUMNS = [
  'category_id', 'brand_id', 'model_id', 'vehicle_name', 'number_plate',
  'model_year', 'color', 'fuel_type', 'seating_capacity', 'luggage_capacity',
  'ac_availability',
] as const

export async function listAdminAccounts(): Promise<AdminAccountListItem[]> {
  return pool.query<AdminAccountListItem>(
    `SELECT id, code, email, role, admin_status, created_at
     FROM admins
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC`
  ).then(res => res.rows)
}

// admin_status and is_active are kept in lockstep — is_active is what
// login/authenticate() actually check, admin_status is the richer lifecycle
// label surfaced in the UI. Suspending/reactivating always updates both.
export async function setAdminStatus(params: {
  targetId: bigint
  status: 'active' | 'suspended'
  actingAdminId: bigint
  ipAddress: string | null
}): Promise<AdminAccountListItem | null> {
  const beforeRes = await pool.query('SELECT * FROM admins WHERE id = $1 AND deleted_at IS NULL', [params.targetId])
  const before = beforeRes.rows[0]
  if (!before) return null

  const afterRes = await pool.query<AdminAccountListItem>(
    `UPDATE admins
     SET admin_status = $1, is_active = $2, updated_at = now()
     WHERE id = $3
     RETURNING id, code, email, role, admin_status, created_at`,
    [params.status, params.status === 'active', params.targetId]
  )
  const after = afterRes.rows[0]!

  await recordAuditLog({
    adminId: params.actingAdminId,
    action: 'admins.status_change',
    targetTable: 'admins',
    targetId: params.targetId,
    beforeState: before,
    afterState: after as unknown as Record<string, unknown>,
    ipAddress: params.ipAddress,
  })

  return after
}

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
       v.category_id, v.brand_id, v.model_id,
       vc.display_name AS vehicle_category,
       vb.name AS vehicle_brand,
       dw.balance AS wallet_balance, dw.is_frozen AS wallet_is_frozen,
       ac.name AS assigned_city_name, ac.billing_mode AS assigned_city_billing_mode
     FROM drivers d
     LEFT JOIN driver_vehicles v ON v.driver_id = d.id
     LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
     LEFT JOIN vehicle_brands vb ON vb.id = v.brand_id
     LEFT JOIN driver_wallets dw ON dw.driver_id = d.id
     LEFT JOIN cities ac ON ac.id = d.city_id
     WHERE d.id = $1`,
    [id]
  )

  if (!driverRes.rows.length) return null
  const r = driverRes.rows[0]

  const [docsRes, vehicleDocsRes, historyRes, ratingsRes, warningsRes, recentRidesRes] = await Promise.all([
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
    pool.query(
      `SELECT rt.id::text, rt.score, rt.comment, rt.created_at, rt.ride_id::text,
              COALESCE(array_agg(rtd.label) FILTER (WHERE rtd.label IS NOT NULL), '{}') AS tags
       FROM ratings rt
       LEFT JOIN rating_tags rtg ON rtg.rating_id = rt.id
       LEFT JOIN rating_tag_definitions rtd ON rtd.id = rtg.tag_id
       WHERE rt.to_driver_id = $1
       GROUP BY rt.id
       ORDER BY rt.created_at DESC
       LIMIT 20`,
      [id]
    ),
    pool.query(
      `SELECT dw.id::text, dw.category, dw.severity, dw.description,
              dw.acknowledged_at, dw.expires_at, dw.created_at,
              a.email AS issued_by_email
       FROM driver_warnings dw
       LEFT JOIN admins a ON a.id = dw.issued_by
       WHERE dw.driver_id = $1
       ORDER BY dw.created_at DESC`,
      [id]
    ),
    pool.query(
      `SELECT r.id::text, r.status, r.ride_type, r.requested_at, r.completed_at,
              COALESCE(fs.total_final, fs.total_estimated)::text AS fare,
              u.name AS user_name
       FROM rides r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
       WHERE r.driver_id = $1
       ORDER BY r.requested_at DESC
       LIMIT 10`,
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
    aadhaar_number: r.aadhaar_number ? 'XXXX-XXXX-' + (r.aadhaar_number as string).slice(-4) : null,
    license_number: r.license_number as string | null,
    city_id: r.city_id ? String(r.city_id) : null,
    assigned_city_name: r.assigned_city_name as string | null,
    assigned_city_billing_mode: r.assigned_city_billing_mode as 'commission' | 'package' | null,
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
      category_id: r.category_id ? String(r.category_id) : null,
      brand_id: r.brand_id ? String(r.brand_id) : null,
      model_id: r.model_id ? String(r.model_id) : null,
      category: r.vehicle_category as string,
      brand: r.vehicle_brand as string,
    } : null,
    documents: docsRes.rows as AdminDriverDetail['documents'],
    vehicle_documents: vehicleDocsRes.rows as AdminDriverDetail['vehicle_documents'],
    status_history: historyRes.rows as AdminDriverDetail['status_history'],
    wallet: r.wallet_balance !== null
      ? { balance: r.wallet_balance as string, is_frozen: r.wallet_is_frozen as boolean }
      : null,
    rating_avg: r.rating_avg as string,
    total_ratings: r.total_ratings as number,
    ratings: ratingsRes.rows as AdminDriverDetail['ratings'],
    warnings: warningsRes.rows as AdminDriverDetail['warnings'],
    recent_rides: recentRidesRes.rows as AdminDriverDetail['recent_rides'],
  }
}

export async function updateDriverStatus(
  driverId: bigint,
  adminId: bigint,
  fromStatus: DriverStatus,
  toStatus: DriverStatus,
  reason?: string,
  onboardingStep?: string,
  ipAddress?: string | null
): Promise<void> {
  const client = await pool.connect()
  let beforeState: Record<string, unknown> | null = null
  let afterState: Record<string, unknown> | null = null
  try {
    await client.query('BEGIN')

    const beforeRes = await client.query('SELECT * FROM drivers WHERE id = $1 FOR UPDATE', [driverId])
    beforeState = beforeRes.rows[0] ?? null

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

    const afterRes = await client.query('SELECT * FROM drivers WHERE id = $1', [driverId])
    afterState = afterRes.rows[0] ?? null

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // Enqueued only after COMMIT succeeds — a rolled-back status change never
  // gets an audit entry.
  await recordAuditLog({
    adminId,
    action: 'drivers.status_change',
    targetTable: 'drivers',
    targetId: driverId,
    beforeState,
    afterState,
    ipAddress: ipAddress ?? null,
  })
}

// Keeps drivers.status in sync with per-document approval state after a doc
// approve/reject. The row lock has to cover the eligibility recheck, not just
// the write -- two concurrent doc mutations on the same driver must serialize
// on the DECISION, not just the write -- so this can't be built by calling
// updateDriverStatus() above (it takes a pre-decided toStatus and opens its
// own separate transaction, which would leave the same TOCTOU race).
export async function syncDriverStatusAfterDocChange(driverId: bigint, adminId: bigint): Promise<void> {
  let beforeStatus: string | null = null
  let afterStatus: string | null = null

  await withTransaction(async (client) => {
    const { rows } = await client.query<{ status: string }>('SELECT status FROM drivers WHERE id = $1 FOR UPDATE', [driverId])
    const currentStatus = rows[0]?.status
    if (!currentStatus) return

    const eligible = await hasApprovedRequiredDocs(driverId, client)
    if (!eligible && currentStatus === 'active') {
      beforeStatus = currentStatus
      afterStatus = 'docs_rejected'
      await client.query(
        `UPDATE drivers SET status = 'docs_rejected', onboarding_step = 'documents', updated_at = now() WHERE id = $1`,
        [driverId]
      )
      await client.query(
        `INSERT INTO driver_status_history (driver_id, from_status, to_status, reason, changed_by)
         VALUES ($1, $2, 'docs_rejected', 'Document rejected or expired', $3)`,
        [driverId, currentStatus, adminId]
      )
    } else if (eligible && currentStatus === 'docs_rejected') {
      beforeStatus = currentStatus
      afterStatus = 'active'
      await client.query(
        `UPDATE drivers SET status = 'active', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1`,
        [driverId]
      )
      await client.query(
        `INSERT INTO driver_status_history (driver_id, from_status, to_status, reason, changed_by)
         VALUES ($1, 'docs_rejected', 'active', 'All documents re-approved', $2)`,
        [driverId, adminId]
      )
    }
  })

  if (beforeStatus && afterStatus) {
    await recordAuditLog({
      adminId,
      action: 'drivers.status_change',
      targetTable: 'drivers',
      targetId: driverId,
      beforeState: { status: beforeStatus },
      afterState: { status: afterStatus },
      ipAddress: null,
    })
  }
}

// Full paginated ride history for the driver detail page's Rides tab — the
// same query the detail payload's `recent_rides` snapshot uses, minus the
// LIMIT 10, plus a count for pagination.
export async function listDriverRides(
  driverId: bigint,
  limit: number,
  offset: number
): Promise<{ rows: AdminDriverDetail['recent_rides']; total: number }> {
  const countRes = await pool.query('SELECT COUNT(*) FROM rides WHERE driver_id = $1', [driverId])
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query(
    `SELECT r.id::text, r.status, r.ride_type, r.requested_at, r.completed_at,
            COALESCE(fs.total_final, fs.total_estimated)::text AS fare,
            u.name AS user_name
     FROM rides r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
     WHERE r.driver_id = $1
     ORDER BY r.requested_at DESC
     LIMIT $2 OFFSET $3`,
    [driverId, limit, offset]
  )

  return { rows: dataRes.rows as AdminDriverDetail['recent_rides'], total }
}

// Driver-scoped transaction list for the Earnings tab — mirrors
// listAdminPayments but pre-filtered to one driver and reachable by
// ops_admin (the global /payments list is finance_admin-gated).
export async function listDriverPayments(
  driverId: bigint,
  limit: number,
  offset: number
): Promise<{ rows: unknown[]; total: number }> {
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM payments p JOIN rides r ON r.id = p.ride_id WHERE r.driver_id = $1`,
    [driverId]
  )
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query(
    `SELECT p.id::text, p.status, p.channel, p.created_at,
            p.amount::text, p.commission_amount::text, p.driver_earning::text,
            r.id::text AS ride_id,
            u.name AS user_name
     FROM payments p
     JOIN rides r ON r.id = p.ride_id
     JOIN users u ON u.id = r.user_id
     WHERE r.driver_id = $1
     ORDER BY p.created_at DESC
     LIMIT $2 OFFSET $3`,
    [driverId, limit, offset]
  )

  return { rows: dataRes.rows, total }
}

// Corrects driver personal/identity fields to match their real documents — a
// trusted admin override, not a re-verification (see docs/... admin driver
// correction plan). No status/onboarding_step change.
export async function updateDriverProfile(
  driverId: bigint,
  adminId: bigint,
  fields: Omit<UpdateDriverProfilePayload, 'reason'>,
  reason: string,
  ipAddress: string | null
): Promise<void> {
  const setClauses: string[] = []
  const values: unknown[] = []
  for (const col of PROFILE_EDITABLE_COLUMNS) {
    if (fields[col] !== undefined) {
      values.push(fields[col])
      setClauses.push(`${col} = $${values.length}`)
    }
  }

  const client = await pool.connect()
  let beforeState: Record<string, unknown> | null = null
  let afterState: Record<string, unknown> | null = null
  try {
    await client.query('BEGIN')

    const beforeRes = await client.query('SELECT * FROM drivers WHERE id = $1 FOR UPDATE', [driverId])
    beforeState = beforeRes.rows[0] ?? null

    if (setClauses.length > 0) {
      values.push(driverId)
      await client.query(
        `UPDATE drivers SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
        values
      )
    }

    const afterRes = await client.query('SELECT * FROM drivers WHERE id = $1', [driverId])
    afterState = afterRes.rows[0] ?? null

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await recordAuditLog({
    adminId,
    action: 'drivers.profile_correction',
    targetTable: 'drivers',
    targetId: driverId,
    beforeState,
    afterState,
    reason,
    ipAddress,
  })
}

// Corrects vehicle spec fields to match the real vehicle (wrong category
// picked at onboarding, plate typo, etc) — a trusted admin override, same
// shape as updateDriverProfile above. category_id/brand_id/model_id and
// number_plate are DB-constrained (FK / UNIQUE) — invalid values surface as
// a clean 409 via the existing global 23503/23505 handling in
// error.middleware.ts, so no extra existence/uniqueness checks needed here.
export async function updateDriverVehicle(
  vehicleId: bigint,
  adminId: bigint,
  fields: {
    category_id?: bigint
    brand_id?: bigint
    model_id?: bigint | null
    vehicle_name?: string
    number_plate?: string
    model_year?: number
    color?: string
    fuel_type?: string
    seating_capacity?: number
    luggage_capacity?: number
    ac_availability?: boolean
  },
  reason: string,
  ipAddress: string | null
): Promise<void> {
  const setClauses: string[] = []
  const values: unknown[] = []
  for (const col of VEHICLE_EDITABLE_COLUMNS) {
    if (fields[col] !== undefined) {
      values.push(fields[col])
      setClauses.push(`${col} = $${values.length}`)
    }
  }

  const client = await pool.connect()
  let beforeState: Record<string, unknown> | null = null
  let afterState: Record<string, unknown> | null = null
  try {
    await client.query('BEGIN')

    const beforeRes = await client.query('SELECT * FROM driver_vehicles WHERE id = $1 FOR UPDATE', [vehicleId])
    beforeState = beforeRes.rows[0] ?? null

    if (setClauses.length > 0) {
      values.push(vehicleId)
      await client.query(
        `UPDATE driver_vehicles SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
        values
      )
    }

    const afterRes = await client.query('SELECT * FROM driver_vehicles WHERE id = $1', [vehicleId])
    afterState = afterRes.rows[0] ?? null

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await recordAuditLog({
    adminId,
    action: 'vehicles.profile_correction',
    targetTable: 'driver_vehicles',
    targetId: vehicleId,
    beforeState,
    afterState,
    reason,
    ipAddress,
  })
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

export async function approveDriverDoc(docId: bigint, adminId: bigint): Promise<{ driver_id: string } | null> {
  const res = await pool.query(
    `UPDATE driver_documents
     SET status = 'approved', reviewed_by = $1, reviewed_at = now(), updated_at = now()
     WHERE id = $2
     RETURNING driver_id`,
    [adminId, docId]
  )
  const row = res.rows[0]
  return row ? { driver_id: String(row.driver_id) } : null
}

export async function rejectDriverDoc(
  docId: bigint, adminId: bigint, rejectionNote: string
): Promise<{ driver_id: string; doc_type: string } | null> {
  const res = await pool.query(
    `UPDATE driver_documents
     SET status = 'rejected', rejection_note = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
     WHERE id = $3
     RETURNING driver_id, doc_type`,
    [rejectionNote, adminId, docId]
  )
  const row = res.rows[0]
  return row ? { driver_id: String(row.driver_id), doc_type: row.doc_type as string } : null
}

export async function approveVehicleDoc(docId: bigint, adminId: bigint): Promise<{ driver_id: string } | null> {
  const res = await pool.query(
    `UPDATE driver_vehicle_documents dvd
     SET status = 'approved', reviewed_by = $1, reviewed_at = now(), updated_at = now()
     FROM driver_vehicles dv
     WHERE dvd.id = $2 AND dv.id = dvd.vehicle_id
     RETURNING dv.driver_id`,
    [adminId, docId]
  )
  const row = res.rows[0]
  return row ? { driver_id: String(row.driver_id) } : null
}

export async function rejectVehicleDoc(
  docId: bigint, adminId: bigint, rejectionNote: string
): Promise<{ driver_id: string; doc_type: string } | null> {
  const res = await pool.query(
    `UPDATE driver_vehicle_documents dvd
     SET status = 'rejected', rejection_note = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
     FROM driver_vehicles dv
     WHERE dvd.id = $3 AND dv.id = dvd.vehicle_id
     RETURNING dvd.doc_type, dv.driver_id`,
    [rejectionNote, adminId, docId]
  )
  const row = res.rows[0]
  return row ? { driver_id: String(row.driver_id), doc_type: row.doc_type as string } : null
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
  id::int, name, slug, state,
  ST_Y(centroid::geometry) AS centroid_lat,
  ST_X(centroid::geometry) AS centroid_lng,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled,
  billing_mode,
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
  const row = res.rows[0] as AdminCity
  await invalidate(CITIES_ALL_KEY, cityByIdKey(row.id))
  return row
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
    billing_mode?: 'commission' | 'package'
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
  if (data.billing_mode !== undefined)            { sets.push(`billing_mode = $${p++}`);              values.push(data.billing_mode) }

  if (!sets.length) {
    const res = await pool.query(`SELECT ${ADMIN_CITY_COLS} FROM cities WHERE id = $1`, [id])
    return res.rows[0] ?? null
  }

  values.push(id)
  const res = await pool.query(
    `UPDATE cities SET ${sets.join(', ')} WHERE id = $${p} RETURNING ${ADMIN_CITY_COLS}`,
    values
  )
  await invalidate(CITIES_ALL_KEY, cityByIdKey(id))
  return res.rows[0] ?? null
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

export async function listAdminRateCards() {
  const res = await pool.query(
    `SELECT rc.*,
            vc.display_name AS category_name,
            vc.slug AS category_slug,
            c.name AS city_name
     FROM rate_cards rc
     JOIN vehicle_categories vc ON vc.id = rc.category_id
     LEFT JOIN cities c ON c.id = rc.city_id
     WHERE rc.effective_to IS NULL
     ORDER BY c.name NULLS FIRST, vc.display_name, rc.ride_type`
  )
  return res.rows
}

export async function listAdminRateCardHistory() {
  const res = await pool.query(
    `SELECT rch.*,
            vc.display_name AS category_name,
            rc.ride_type,
            rc.category_id,
            c.name AS city_name
     FROM rate_card_history rch
     JOIN rate_cards rc ON rc.id = rch.rate_card_id
     JOIN vehicle_categories vc ON vc.id = rc.category_id
     LEFT JOIN cities c ON c.id = rch.city_id
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

export async function getAdminRideStats() {
  const res = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE requested_at::date = CURRENT_DATE)::text AS today_count,
       COUNT(*) FILTER (WHERE status IN ('accepted','driver_arrived','in_progress'))::text AS active_count,
       COUNT(*) FILTER (WHERE status = 'cancelled' AND requested_at::date = CURRENT_DATE)::text AS cancelled_today_count,
       COUNT(*) FILTER (WHERE cash_discrepancy AND requested_at::date = CURRENT_DATE)::text AS cash_flagged_count
     FROM rides`
  )
  return res.rows[0]
}

export async function listAdminRides(filters: {
  status?: string
  ride_type?: string
  search?: string
  cash_discrepancy?: boolean
  date_from?: string
  date_to?: string
  city_id?: number
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
  if (filters.cash_discrepancy) {
    conditions.push(`r.cash_discrepancy = $${p++}`)
    params.push(true)
  }
  if (filters.date_from) {
    conditions.push(`r.requested_at::date >= $${p++}`)
    params.push(filters.date_from)
  }
  if (filters.date_to) {
    conditions.push(`r.requested_at::date <= $${p++}`)
    params.push(filters.date_to)
  }
  if (filters.city_id !== undefined) {
    conditions.push(`(r.origin_city_id = $${p} OR r.destination_city_id = $${p})`)
    params.push(filters.city_id)
    p++
  }
  if (filters.search) {
    const likeParam = p++
    const idParam   = p++
    conditions.push(`(u.name ILIKE $${likeParam} OR u.phone ILIKE $${likeParam} OR d.full_name ILIKE $${likeParam} OR d.phone ILIKE $${likeParam} OR r.id::text = $${idParam})`)
    params.push(`%${filters.search}%`, filters.search)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM rides r JOIN users u ON u.id = r.user_id LEFT JOIN drivers d ON d.id = r.driver_id ${where}`,
    params
  )
  const total = parseInt(countRes.rows[0].count as string, 10)

  const dataRes = await pool.query(
    `SELECT
       r.id::text, r.status, r.ride_type, r.is_return_cab,
       r.origin_address, r.destination_address,
       r.requested_at, r.accepted_at, r.driver_arrived_at, r.started_at, r.completed_at,
       r.review_flagged_at, r.review_reason,
       r.cash_discrepancy, r.cash_collected_amount::text AS cash_collected_amount,
       u.name AS user_name, u.phone AS user_phone,
       d.full_name AS driver_name, d.phone AS driver_phone,
       COALESCE(fs.total_final, fs.total_estimated)::text AS fare,
       pay.status AS payment_status, pay.channel AS payment_channel,
       rc.reason_code AS cancellation_reason_code, rc.reason AS cancellation_reason, rc.actor AS cancellation_actor
     FROM rides r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN drivers d ON d.id = r.driver_id
     LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
     LEFT JOIN payments pay ON pay.ride_id = r.id
     LEFT JOIN ride_cancellations rc ON rc.ride_id = r.id
     ${where}
     ORDER BY r.requested_at DESC
     LIMIT $${p} OFFSET $${p + 1}`,
    [...params, filters.limit, filters.offset]
  )

  return { rows: dataRes.rows, total }
}

export async function listUpcomingScheduledRides() {
  const res = await pool.query(
    `SELECT
       r.id::text, r.ride_type, r.scheduled_for,
       r.origin_address, r.destination_address,
       u.name AS user_name, u.phone AS user_phone,
       ram.status AS advance_status,
       (ram.status = 'pending_driver' AND r.scheduled_for < now()) AS is_stuck
     FROM rides r
     JOIN users u ON u.id = r.user_id
     JOIN ride_advance_meta ram ON ram.ride_id = r.id
     WHERE r.status = 'scheduled'
     ORDER BY r.scheduled_for ASC`
  )
  return res.rows
}

export async function getAdminRideById(rideId: bigint) {
  const res = await pool.query(
    `SELECT
       r.id::text, r.status, r.ride_type, r.is_return_cab,
       r.origin_address, r.destination_address,
       r.requested_at, r.accepted_at, r.driver_arrived_at, r.started_at, r.completed_at,
       r.review_flagged_at, r.review_reason,
       r.cash_discrepancy, r.cash_collected_amount::text AS cash_collected_amount,
       r.sos_triggered, r.sos_triggered_at,
       u.name AS user_name, u.phone AS user_phone,
       d.full_name AS driver_name, d.phone AS driver_phone,
       dv.number_plate AS vehicle_number_plate, dv.vehicle_name AS vehicle_name, dv.color AS vehicle_color,
       COALESCE(fs.total_final, fs.total_estimated)::text AS fare,
       fs.base_fare::text, fs.distance_fare::text, fs.time_fare::text, fs.stop_fare::text,
       fs.hour_surcharge::text, fs.overage_fare::text, fs.surge_fare::text, fs.surge_multiplier::text,
       fs.estimated_km::text, fs.estimated_min::text, fs.actual_km::text, fs.actual_min::text,
       fs.overage_km::text, fs.overage_min::text, fs.refund_amount::text,
       pay.status AS payment_status, pay.channel AS payment_channel,
       rc.reason_code AS cancellation_reason_code, rc.reason AS cancellation_reason, rc.actor AS cancellation_actor,
       rc.fee_applicable AS cancellation_fee_applicable, rc.fee_amount::text AS cancellation_fee_amount,
       rc.fee_waived AS cancellation_fee_waived, rc.fee_waived_reason AS cancellation_fee_waived_reason
     FROM rides r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN drivers d ON d.id = r.driver_id
     LEFT JOIN driver_vehicles dv ON dv.id = r.vehicle_id
     LEFT JOIN fare_snapshots fs ON fs.ride_id = r.id
     LEFT JOIN payments pay ON pay.ride_id = r.id
     LEFT JOIN ride_cancellations rc ON rc.ride_id = r.id
     WHERE r.id = $1`,
    [rideId]
  )
  return res.rows[0] ?? null
}

export async function getRideStatusHistory(rideId: bigint) {
  const res = await pool.query(
    `SELECT from_status, to_status, actor, note, created_at
     FROM ride_status_history WHERE ride_id = $1 ORDER BY created_at ASC`,
    [rideId]
  )
  return res.rows
}

export async function getRideLinkedSafety(rideId: bigint) {
  const [disputes, sos, ratings] = await Promise.all([
    pool.query(`SELECT id::text, status, type FROM disputes WHERE ride_id = $1`, [rideId]),
    pool.query(`SELECT id::text, status, severity FROM sos_alerts WHERE ride_id = $1`, [rideId]),
    pool.query(`SELECT direction, score, comment FROM ratings WHERE ride_id = $1`, [rideId]),
  ])
  return { disputes: disputes.rows, sos_alerts: sos.rows, ratings: ratings.rows }
}

// ─── Rental Packages (admin CRUD) ────────────────────────────────────────────

export async function listAdminRentalPackages(cityId: number | null) {
  if (cityId === null) {
    const res = await pool.query(
      `SELECT rp.id, rp.category_id, vc.display_name AS category_name, vc.slug AS category_slug,
              rp.duration_minutes, rp.km_limit, rp.display_order,
              rp.package_fare::text, rp.extra_per_km::text, rp.extra_per_min::text,
              rp.is_active, rp.city_id, c.name AS city_name,
              rp.updated_by, rp.created_at, rp.updated_at
       FROM rental_packages rp
       JOIN vehicle_categories vc ON vc.id = rp.category_id
       LEFT JOIN cities c ON c.id = rp.city_id
       WHERE rp.city_id IS NULL
       ORDER BY vc.display_name, rp.display_order, rp.duration_minutes`
    )
    return res.rows as AdminRentalPackage[]
  }

  const res = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (rp.category_id, rp.duration_minutes, rp.km_limit)
              rp.id, rp.category_id, vc.display_name AS category_name, vc.slug AS category_slug,
              rp.duration_minutes, rp.km_limit, rp.display_order,
              rp.package_fare::text, rp.extra_per_km::text, rp.extra_per_min::text,
              rp.is_active, rp.city_id, c.name AS city_name,
              rp.updated_by, rp.created_at, rp.updated_at
       FROM rental_packages rp
       JOIN vehicle_categories vc ON vc.id = rp.category_id
       LEFT JOIN cities c ON c.id = rp.city_id
       WHERE (rp.city_id = $1 OR rp.city_id IS NULL)
       ORDER BY rp.category_id, rp.duration_minutes, rp.km_limit, rp.city_id NULLS LAST
     ) t
     ORDER BY t.category_name, t.display_order, t.duration_minutes`,
    [cityId]
  )
  return res.rows as AdminRentalPackage[]
}

export async function updateAdminRentalPackage(
  id: bigint,
  fields: {
    package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
    duration_minutes?: number; km_limit?: number; display_order?: number; city_id?: number | null
  },
  adminId: bigint,
) {
  const sets: string[] = []
  const params: unknown[] = []
  let p = 1

  if (fields.package_fare     !== undefined) { sets.push(`package_fare     = $${p++}`); params.push(fields.package_fare) }
  if (fields.extra_per_km     !== undefined) { sets.push(`extra_per_km     = $${p++}`); params.push(fields.extra_per_km) }
  if (fields.extra_per_min    !== undefined) { sets.push(`extra_per_min    = $${p++}`); params.push(fields.extra_per_min) }
  if (fields.is_active        !== undefined) { sets.push(`is_active        = $${p++}`); params.push(fields.is_active) }
  if (fields.duration_minutes !== undefined) { sets.push(`duration_minutes = $${p++}`); params.push(fields.duration_minutes) }
  if (fields.km_limit         !== undefined) { sets.push(`km_limit         = $${p++}`); params.push(fields.km_limit) }
  if (fields.display_order    !== undefined) { sets.push(`display_order    = $${p++}`); params.push(fields.display_order) }
  if (fields.city_id          !== undefined) { sets.push(`city_id          = $${p++}`); params.push(fields.city_id) }

  sets.push(`updated_by = $${p++}`)
  params.push(adminId)
  params.push(id)

  const res = await pool.query(
    `UPDATE rental_packages SET ${sets.join(', ')} WHERE id = $${p} RETURNING
       id, category_id, duration_minutes, km_limit, display_order,
       package_fare::text, extra_per_km::text, extra_per_min::text,
       is_active, city_id, updated_by, created_at, updated_at`,
    params,
  )
  return res.rows[0] as AdminRentalPackage | undefined
}

export async function deleteAdminRentalPackage(id: bigint) {
  const res = await pool.query(`DELETE FROM rental_packages WHERE id = $1 RETURNING id`, [id])
  return res.rows[0] as { id: bigint } | undefined
}

export async function createAdminRentalPackage(
  fields: {
    category_id: number
    duration_minutes: number
    km_limit: number
    package_fare: number
    extra_per_km: number
    extra_per_min: number
    display_order?: number
    city_id?: number | null
  },
  adminId: bigint,
) {
  const res = await pool.query(
    `INSERT INTO rental_packages
       (category_id, duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order, city_id, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 100), $8, $9)
     RETURNING
       id, category_id, duration_minutes, km_limit, display_order,
       package_fare::text, extra_per_km::text, extra_per_min::text,
       is_active, city_id, updated_by, created_at, updated_at`,
    [fields.category_id, fields.duration_minutes, fields.km_limit,
     fields.package_fare, fields.extra_per_km, fields.extra_per_min,
     fields.display_order ?? null, fields.city_id ?? null, adminId],
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
    conditions.push(`(u.name ILIKE $${p} OR u.phone ILIKE $${p} OR u.email ILIKE $${p})`)
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
  kmPerDay?: number | null
  driverAllowancePerDay?: number | null
  cityId?: number | null
  notes?: string | null
  adminId: bigint
}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const expired = await client.query(
      `UPDATE rate_cards
       SET effective_to = now()
       WHERE category_id = $1 AND ride_type = $2
         AND COALESCE(city_id, 0) = COALESCE($3::bigint, 0)
         AND effective_to IS NULL
       RETURNING *`,
      [data.categoryId, data.rideType, data.cityId ?? null]
    )

    if (expired.rows.length > 0) {
      const old = expired.rows[0]
      await client.query(
        `INSERT INTO rate_card_history
           (rate_card_id, rate_per_km, rate_per_min, min_fare,
            return_rate_per_km, hour_rate, km_per_day, driver_allowance_per_day,
            city_id, changed_by, change_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          old.id, old.rate_per_km, old.rate_per_min, old.min_fare,
          old.return_rate_per_km, old.hour_rate,
          old.km_per_day, old.driver_allowance_per_day,
          old.city_id, data.adminId, data.notes ?? null,
        ]
      )
    }

    const res = await client.query(
      `INSERT INTO rate_cards
         (category_id, ride_type, rate_per_km, rate_per_min,
          min_fare, return_rate_per_km, hour_rate, km_per_day, driver_allowance_per_day,
          city_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        data.categoryId, data.rideType,
        data.ratePerKm, data.ratePerMin, data.minFare,
        data.returnRatePerKm ?? null,
        data.hourRate ?? null,
        data.kmPerDay ?? null,
        data.driverAllowancePerDay ?? null,
        data.cityId ?? null,
        data.notes ?? null,
        data.adminId,
      ]
    )

    await client.query('COMMIT')
    try {
      await redisClient.incr(RATE_CARD_VERSION_KEY)
    } catch (err) {
      logger.warn({ err }, 'reference-cache: failed to bump rate_card version, will serve stale until TTL')
    }
    return res.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Dashboard stats ──────────────────────────────────────────────────────────

// Runs a query with a per-query statement_timeout (SET LOCAL inside the
// caller's transaction — reverts on COMMIT, never leaks onto other pool
// users). Smaller ceiling than analytics since this is polled frequently.
async function dashboardQuery<T extends QueryResultRow>(
  client: PoolClient, text: string, params: unknown[] = [], timeoutMs = 30_000
): Promise<QueryResult<T>> {
  await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`) // Number()-coerced — never user input
  return client.query<T>(text, params)
}

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  // IST is UTC+5:30, no DST. Compute today's [start, end) once in JS as UTC
  // timestamptz bounds so the predicates below stay sargable (half-open
  // range on the raw column, no function wrapping it — see getDriverEarningsSummary).
  const nowIst = new Date(Date.now() + 5.5 * 3600_000)
  const istMidnightUtc = new Date(Date.UTC(
    nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate()
  ) - 5.5 * 3600_000)
  const dayStart = istMidnightUtc.toISOString()
  const dayEnd = new Date(istMidnightUtc.getTime() + 86_400_000).toISOString()

  const client = await pool.connect()
  let statsRes: QueryResult, chartRes: QueryResult
  try {
    await client.query('BEGIN')
    ;[statsRes, chartRes] = await Promise.all([
      dashboardQuery(client, `
      SELECT
        (SELECT COUNT(*) FROM rides
         WHERE requested_at >= $1 AND requested_at < $2
        )::int                                                              AS total_rides_today,
        (SELECT COUNT(*) FROM driver_sessions
         WHERE status IN ('online', 'on_trip')
        )::int                                                              AS active_drivers_online,
        (SELECT COALESCE(SUM(amount), 0) FROM payments
         WHERE created_at >= $1 AND created_at < $2
           AND status = 'completed'
        )::numeric                                                          AS revenue_today,
        (SELECT COUNT(*) FROM disputes
         WHERE status IN ('open', 'under_review', 'pending_info', 'escalated')
        )::int                                                              AS open_disputes,
        (SELECT COUNT(*) FROM rides
         WHERE status = 'completed'
           AND requested_at >= $1 AND requested_at < $2
        )::int                                                              AS completed_rides,
        (SELECT COUNT(*) FROM rides
         WHERE status = 'cancelled'
           AND requested_at >= $1 AND requested_at < $2
        )::int                                                              AS cancelled_rides,
        (SELECT COUNT(*) FROM drivers
         WHERE created_at >= $1 AND created_at < $2
        )::int                                                              AS new_driver_signups,
        (SELECT COUNT(*) FROM rides
         WHERE status IN ('accepted', 'driver_arrived', 'in_progress', 'returning')
        )::int                                                              AS active_trips
      `, [dayStart, dayEnd]),
      dashboardQuery(client, `
      SELECT
        (11 - FLOOR(EXTRACT(EPOCH FROM (NOW() - requested_at)) / 3600)::int) AS bucket,
        COUNT(*)::int AS count
      FROM rides
      WHERE requested_at >= NOW() - INTERVAL '12 hours'
      GROUP BY bucket
      ORDER BY bucket
      `),
    ])
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }

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
      ST_Y(r.origin::geometry)             AS origin_lat,
      ST_X(r.origin::geometry)             AS origin_lng,
      ST_Y(r.destination::geometry)        AS dest_lat,
      ST_X(r.destination::geometry)        AS dest_lng,
      vc.display_name                      AS vehicle_category,
      dv.vehicle_name,
      dv.number_plate
    FROM driver_sessions ds
    JOIN drivers d ON d.id = ds.driver_id
    LEFT JOIN driver_location_snapshots dls ON dls.driver_id = ds.driver_id
    LEFT JOIN rides r ON r.driver_id = ds.driver_id
      AND r.status IN ('accepted', 'driver_arrived', 'in_progress', 'returning')
    LEFT JOIN driver_vehicles dv ON dv.driver_id = ds.driver_id
      AND dv.is_primary = true AND dv.status != 'blacklisted'
    LEFT JOIN vehicle_categories vc ON vc.id = dv.category_id
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
    vehicle_category:    r.vehicle_category as string | null,
    vehicle_name:        r.vehicle_name as string | null,
    number_plate:        r.number_plate as string | null,
  }))
}

// ─── Package tiers (city billing_mode = 'package') ────────────────────────────

export async function listPackageTiers(): Promise<PackageTier[]> {
  const res = await pool.query<PackageTier>(
    `SELECT id, label, price::text, threshold_value::text, is_active, created_at, updated_at
     FROM package_tiers ORDER BY price ASC`
  )
  return res.rows
}

export async function createPackageTier(data: {
  label: string; price: number; thresholdValue: number; createdBy: bigint
}): Promise<PackageTier> {
  const res = await pool.query<PackageTier>(
    `INSERT INTO package_tiers (label, price, threshold_value, created_by)
     VALUES ($1,$2,$3,$4)
     RETURNING id, label, price::text, threshold_value::text, is_active, created_at, updated_at`,
    [data.label, data.price, data.thresholdValue, data.createdBy]
  )
  return res.rows[0]!
}

export async function updatePackageTier(
  id: bigint,
  data: { label?: string; price?: number; thresholdValue?: number; isActive?: boolean }
): Promise<PackageTier | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let p = 1
  if (data.label !== undefined)          { sets.push(`label = $${p++}`);           values.push(data.label) }
  if (data.price !== undefined)          { sets.push(`price = $${p++}`);           values.push(data.price) }
  if (data.thresholdValue !== undefined) { sets.push(`threshold_value = $${p++}`); values.push(data.thresholdValue) }
  if (data.isActive !== undefined)       { sets.push(`is_active = $${p++}`);       values.push(data.isActive) }
  if (!sets.length) return null
  values.push(id)
  const res = await pool.query<PackageTier>(
    `UPDATE package_tiers SET ${sets.join(', ')} WHERE id = $${p}
     RETURNING id, label, price::text, threshold_value::text, is_active, created_at, updated_at`,
    values
  )
  return res.rows[0] ?? null
}

// ─── Driver package wallet / ledger (admin view) ──────────────────────────────

export async function getDriverPackageWallet(driverId: bigint): Promise<DriverPackageWallet | null> {
  const res = await pool.query<DriverPackageWallet>(
    `SELECT id, driver_id, balance::text, is_frozen, frozen_reason,
            lifetime_topup::text, lifetime_consumed::text
     FROM driver_package_wallets WHERE driver_id = $1`,
    [driverId]
  )
  return res.rows[0] ?? null
}

export async function getDriverPackageLedger(driverId: bigint, limit = 50): Promise<DriverPackageLedgerEntry[]> {
  const res = await pool.query<DriverPackageLedgerEntry>(
    `SELECT id, entry_type, amount::text, direction, balance_after::text,
            ride_id, reference_id, note, created_at
     FROM driver_package_ledger WHERE driver_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [driverId, limit]
  )
  return res.rows
}
