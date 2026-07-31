import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { getPresignedUrl } from '@/lib/storage'
import * as repo from './admin.repository'
import type { DriverStatus, UpdateDriverStatusPayload, UpdateDriverProfilePayload, UpdateDriverVehiclePayload } from './admin.types'
import { forceResolveRide as resolveStuckRide } from '@/modules/rides/rides.service'
import { getRideStops } from '@/modules/rides/rides.repository'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { recordAuditLog } from '@/lib/audit-log'

function docLabel(docType: string): string {
  return docType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const VALID_STATUSES = new Set<DriverStatus>(['pending_docs', 'pending_approval', 'active', 'suspended', 'banned', 'docs_rejected'])

export async function listDrivers(query: {
  status?: string
  search?: string
  page?: number
  limit?: number
}) {
  const limit = Math.min(query.limit ?? 20, 100)
  const page  = Math.max(query.page ?? 1, 1)
  const offset = (page - 1) * limit

  const repoQuery: { status?: string; search?: string; limit: number; offset: number } = { limit, offset }
  if (query.status !== undefined) repoQuery.status = query.status
  if (query.search !== undefined) repoQuery.search = query.search
  const { rows, total } = await repo.listDrivers(repoQuery)

  return {
    drivers: rows,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  }
}

export async function getDriver(id: bigint) {
  const driver = await repo.getDriverById(id)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)

  const [signedDocs, signedVehicleDocs] = await Promise.all([
    Promise.all(driver.documents.map(async (doc) => ({
      ...doc,
      file_url: await getPresignedUrl(doc.file_url),
    }))),
    Promise.all(driver.vehicle_documents.map(async (doc) => ({
      ...doc,
      file_url: await getPresignedUrl(doc.file_url),
    }))),
  ])

  return { ...driver, documents: signedDocs, vehicle_documents: signedVehicleDocs }
}

export async function listDriverRides(driverId: bigint, query: { page?: number; limit?: number }) {
  const limit = Math.min(query.limit ?? 20, 100)
  const page = Math.max(query.page ?? 1, 1)
  const { rows, total } = await repo.listDriverRides(driverId, limit, (page - 1) * limit)
  return { rides: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }
}

export async function listDriverPayments(driverId: bigint, query: { page?: number; limit?: number }) {
  const limit = Math.min(query.limit ?? 20, 100)
  const page = Math.max(query.page ?? 1, 1)
  const { rows, total } = await repo.listDriverPayments(driverId, limit, (page - 1) * limit)
  return { payments: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }
}

export async function updateDriverStatus(
  driverId: bigint,
  adminId: bigint,
  currentStatus: DriverStatus,
  payload: UpdateDriverStatusPayload,
  ipAddress?: string | null
) {
  if (!VALID_STATUSES.has(payload.status)) {
    throw createHttpError(AppErrors.VALIDATION_ERROR)
  }

  // Cannot move an active driver backward into pre-approval states
  const backwardTransitions = new Set(['pending_docs', 'pending_approval', 'docs_rejected'])
  if (currentStatus === 'active' && backwardTransitions.has(payload.status)) {
    throw createHttpError(AppErrors.VALIDATION_ERROR)
  }

  // When rejecting docs, reset onboarding_step so driver lands on the documents page
  const onboardingStep = payload.status === 'docs_rejected' ? 'documents' : undefined
  await repo.updateDriverStatus(driverId, adminId, currentStatus, payload.status, payload.reason, onboardingStep, ipAddress)
}

export async function updateDriverProfile(
  driverId: bigint,
  adminId: bigint,
  payload: UpdateDriverProfilePayload,
  ipAddress: string | null
) {
  if (!payload.reason || payload.reason.trim().length < 10) {
    throw httpError(422, 'A reason (at least 10 characters) is required to correct driver details', AppErrors.VALIDATION_ERROR.code)
  }
  const { reason, ...fields } = payload
  if (Object.keys(fields).length === 0) {
    throw createHttpError(AppErrors.VALIDATION_ERROR)
  }

  // getDriverById masks aadhaar_number as 'XXXX-XXXX-1234' before it ever
  // reaches an admin — reject that shape outright so a client that echoes
  // the masked value back (e.g. saving an edit form without touching the
  // field) can never overwrite the real Aadhaar number with the mask.
  if (fields.aadhaar_number !== undefined && /^X{4}-X{4}-\d{4}$/.test(fields.aadhaar_number)) {
    throw httpError(422, 'Enter the full Aadhaar number, not the masked value', AppErrors.VALIDATION_ERROR.code)
  }

  await repo.updateDriverProfile(driverId, adminId, fields, reason, ipAddress)

  await notifyOwner({
    ownerType: 'driver',
    ownerId: driverId,
    type: 'profile_corrected',
    title: 'Profile updated',
    body: 'Your profile details were updated by Ocar support to match your documents.',
    payload: { route: 'profile' },
  })
}

export async function updateDriverVehicle(
  driverId: bigint,
  vehicleId: bigint,
  adminId: bigint,
  payload: UpdateDriverVehiclePayload,
  ipAddress: string | null
) {
  if (!payload.reason || payload.reason.trim().length < 10) {
    throw httpError(422, 'A reason (at least 10 characters) is required to correct vehicle details', AppErrors.VALIDATION_ERROR.code)
  }
  const { reason, category_id, brand_id, model_id, ...rest } = payload

  const fields: Parameters<typeof repo.updateDriverVehicle>[2] = { ...rest }
  if (category_id !== undefined) {
    if (!/^\d+$/.test(category_id)) throw httpError(422, 'category_id must be a valid id', AppErrors.VALIDATION_ERROR.code)
    fields.category_id = BigInt(category_id)
  }
  if (brand_id !== undefined) {
    if (!/^\d+$/.test(brand_id)) throw httpError(422, 'brand_id must be a valid id', AppErrors.VALIDATION_ERROR.code)
    fields.brand_id = BigInt(brand_id)
  }
  if (model_id !== undefined) {
    if (model_id && !/^\d+$/.test(model_id)) throw httpError(422, 'model_id must be a valid id', AppErrors.VALIDATION_ERROR.code)
    fields.model_id = model_id ? BigInt(model_id) : null
  }

  if (Object.keys(fields).length === 0) {
    throw createHttpError(AppErrors.VALIDATION_ERROR)
  }

  await repo.updateDriverVehicle(vehicleId, adminId, fields, reason, ipAddress)

  await notifyOwner({
    ownerType: 'driver',
    ownerId: driverId,
    type: 'vehicle_corrected',
    title: 'Vehicle details updated',
    body: 'Your vehicle details were updated by Ocar support to match your registration.',
    payload: { route: 'vehicle' },
  })
}

// ─── Admin accounts ───────────────────────────────────────────────────────────

export async function listAdminAccounts() { return repo.listAdminAccounts() }

export async function setAdminStatus(params: {
  targetId: bigint
  status: 'active' | 'suspended'
  actingAdminId: bigint
  ipAddress: string | null
}) {
  if (params.status !== 'active' && params.status !== 'suspended') {
    throw createHttpError(AppErrors.VALIDATION_ERROR)
  }
  if (params.targetId === params.actingAdminId) {
    throw httpError(422, 'You cannot change your own admin status', AppErrors.VALIDATION_ERROR.code)
  }

  const updated = await repo.setAdminStatus(params)
  if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
  return updated
}

// ─── Vehicle management ───────────────────────────────────────────────────────

export async function listCategories() { return repo.listAdminCategories() }

export async function createCategory(data: {
  slug: string; display_name: string; max_passengers: number; is_active: boolean
}) {
  if (!data.slug || !data.display_name) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.createCategory(data)
}

export async function updateCategory(id: bigint, data: {
  display_name?: string; max_passengers?: number; is_active?: boolean
}) {
  const updated = await repo.updateCategory(id, data)
  if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
  return updated
}

export async function listBrands() { return repo.listAdminBrands() }

export async function createBrand(data: { name: string; is_active: boolean }) {
  if (!data.name) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.createBrand(data)
}

export async function updateBrand(id: bigint, data: { name?: string; is_active?: boolean }) {
  const updated = await repo.updateBrand(id, data)
  if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
  return updated
}

export async function listModels(brandId?: string) {
  return repo.listAdminModels(brandId ? BigInt(brandId) : undefined)
}

export async function createModel(data: {
  brand_id: string; name: string; typical_category_id?: string | null; is_active: boolean
}) {
  if (!data.brand_id || !data.name) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.createModel({
    brand_id: BigInt(data.brand_id),
    name: data.name,
    typical_category_id: data.typical_category_id ? BigInt(data.typical_category_id) : null,
    is_active: data.is_active,
  })
}

export async function updateModel(id: bigint, data: {
  name?: string; typical_category_id?: string | null; is_active?: boolean
}) {
  const payload: Parameters<typeof repo.updateModel>[1] = {}
  if (data.name !== undefined) payload.name = data.name
  if ('typical_category_id' in data) payload.typical_category_id = data.typical_category_id ? BigInt(data.typical_category_id) : null
  if (data.is_active !== undefined) payload.is_active = data.is_active
  const updated = await repo.updateModel(id, payload)
  if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
  return updated
}

export async function listFleet(status?: string) { return repo.listFleet(status) }

export async function blacklistVehicle(vehicleId: bigint, adminId: bigint, reason: string) {
  if (!reason || reason.length < 10) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.blacklistVehicle(vehicleId, adminId, reason)
}

export async function unblacklistVehicle(vehicleId: bigint) {
  return repo.unblacklistVehicle(vehicleId)
}

export async function listPendingVehicleDocs() { return repo.listPendingVehicleDocs() }

export async function approveDriverDoc(docId: bigint, adminId: bigint, ipAddress: string | null) {
  await repo.approveDriverDoc(docId, adminId)
  await recordAuditLog({
    adminId, action: 'driver_documents.approve', targetTable: 'driver_documents', targetId: docId,
    afterState: { status: 'approved' }, ipAddress,
  })
}

export async function rejectDriverDoc(docId: bigint, adminId: bigint, note: string, ipAddress: string | null) {
  if (!note || note.length < 10) throw createHttpError(AppErrors.VALIDATION_ERROR)
  const rejected = await repo.rejectDriverDoc(docId, adminId, note)
  if (rejected) {
    await recordAuditLog({
      adminId, action: 'driver_documents.reject', targetTable: 'driver_documents', targetId: docId,
      afterState: { status: 'rejected', doc_type: rejected.doc_type, note }, ipAddress,
    })
    await notifyOwner({
      ownerType: 'driver',
      ownerId: BigInt(rejected.driver_id),
      type: 'document_rejected',
      title: 'Document Rejected',
      body: `Your ${docLabel(rejected.doc_type)} was rejected: ${note}. Please resubmit it to continue.`,
      payload: { route: 'documents' },
    })
  }
  return rejected
}

export async function approveVehicleDoc(docId: bigint, adminId: bigint, ipAddress: string | null) {
  await repo.approveVehicleDoc(docId, adminId)
  await recordAuditLog({
    adminId, action: 'vehicle_documents.approve', targetTable: 'driver_vehicle_documents', targetId: docId,
    afterState: { status: 'approved' }, ipAddress,
  })
}

export async function rejectVehicleDoc(docId: bigint, adminId: bigint, note: string, ipAddress: string | null) {
  if (!note || note.length < 10) throw createHttpError(AppErrors.VALIDATION_ERROR)
  const rejected = await repo.rejectVehicleDoc(docId, adminId, note)
  if (rejected) {
    await recordAuditLog({
      adminId, action: 'vehicle_documents.reject', targetTable: 'driver_vehicle_documents', targetId: docId,
      afterState: { status: 'rejected', doc_type: rejected.doc_type, note }, ipAddress,
    })
    await notifyOwner({
      ownerType: 'driver',
      ownerId: BigInt(rejected.driver_id),
      type: 'document_rejected',
      title: 'Document Rejected',
      body: `Your ${docLabel(rejected.doc_type)} was rejected: ${note}. Please resubmit it to continue.`,
      payload: { route: 'vehicle-docs' },
    })
  }
  return rejected
}

export async function listExpiringDocs(daysAhead = 30) {
  return repo.listExpiringDocs(Math.min(Math.max(daysAhead, 1), 90))
}

// ─── Geo / Cities ─────────────────────────────────────────────────────────────

export async function listAdminCities() {
  return repo.listAdminCities()
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
}) {
  if (!data.name || !data.slug || !data.state) throw createHttpError(AppErrors.VALIDATION_ERROR)
  if (isNaN(data.centroid_lat) || isNaN(data.centroid_lng)) throw createHttpError(AppErrors.VALIDATION_ERROR)
  if (data.centroid_lat < -90 || data.centroid_lat > 90) throw createHttpError(AppErrors.VALIDATION_ERROR)
  if (data.centroid_lng < -180 || data.centroid_lng > 180) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.createAdminCity(data)
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

export async function listAdminRateCards() { return repo.listAdminRateCards() }
export async function listAdminRateCardHistory() { return repo.listAdminRateCardHistory() }
export async function listAdminSurgeEvents() { return repo.listAdminSurgeEvents() }

export async function createAdminRateCard(data: Parameters<typeof repo.createAdminRateCard>[0]) {
  if (!data.categoryId || !data.rideType) throw createHttpError(AppErrors.VALIDATION_ERROR)
  if (data.ratePerKm <= 0 || data.minFare <= 0) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.createAdminRateCard(data)
}

export async function createAdminSurgeEvent(data: Parameters<typeof repo.createAdminSurgeEvent>[0]) {
  if (data.multiplier < 1 || data.multiplier > 5) throw createHttpError(AppErrors.VALIDATION_ERROR)
  if (!data.startsAt || !data.endsAt) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.createAdminSurgeEvent(data)
}

export async function cancelAdminSurgeEvent(id: bigint, adminId: bigint) {
  const result = await repo.cancelAdminSurgeEvent(id, adminId)
  if (!result) throw createHttpError(AppErrors.NOT_FOUND)
  return result
}

// ─── Rides / Users / Payments ─────────────────────────────────────────────────

export async function listAdminRides(query: {
  status?: string; ride_type?: string; search?: string; cash_discrepancy?: boolean; page?: number; limit?: number
}) {
  const limit = Math.min(query.limit ?? 20, 100)
  const page  = Math.max(query.page ?? 1, 1)
  const q: { status?: string; ride_type?: string; search?: string; cash_discrepancy?: boolean; limit: number; offset: number } = { limit, offset: (page - 1) * limit }
  if (query.status          !== undefined) q.status           = query.status
  if (query.ride_type       !== undefined) q.ride_type        = query.ride_type
  if (query.search          !== undefined) q.search           = query.search
  if (query.cash_discrepancy !== undefined) q.cash_discrepancy = query.cash_discrepancy
  const { rows, total } = await repo.listAdminRides(q)
  return { rides: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }
}

export async function listUpcomingScheduledRides() {
  return repo.listUpcomingScheduledRides()
}

export async function getAdminRideById(rideId: bigint) {
  const ride = await repo.getAdminRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  const stops = await getRideStops(rideId)
  return { ...ride, stops }
}

export async function forceResolveAdminRide(
  rideId: bigint,
  action: 'complete' | 'cancel',
  adminId: bigint,
  note?: string,
) {
  const outcome = action === 'complete' ? 'completed' as const : 'cancelled' as const
  return resolveStuckRide(rideId, outcome, 'admin', note, adminId)
}

// ─── Rental Packages ──────────────────────────────────────────────────────────

function rethrowIfDuplicatePackage(err: unknown): never {
  if ((err as { code?: string }).code === '23505') {
    throw Object.assign(
      new Error('A package with this duration and km limit already exists for this category'),
      { httpStatus: 409 },
    )
  }
  throw err
}

export async function listAdminRentalPackages() {
  return repo.listAdminRentalPackages()
}

export async function updateAdminRentalPackage(
  id: bigint,
  body: {
    package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
    duration_minutes?: number; km_limit?: number; display_order?: number
  },
  adminId: bigint,
) {
  if (body.package_fare     !== undefined && (isNaN(body.package_fare)     || body.package_fare     <= 0))
    throw Object.assign(new Error('package_fare must be > 0'), { httpStatus: 400 })
  if (body.extra_per_km     !== undefined && (isNaN(body.extra_per_km)     || body.extra_per_km     <= 0))
    throw Object.assign(new Error('extra_per_km must be > 0'), { httpStatus: 400 })
  if (body.extra_per_min    !== undefined && (isNaN(body.extra_per_min)    || body.extra_per_min    < 0))
    throw Object.assign(new Error('extra_per_min must be >= 0'), { httpStatus: 400 })
  if (body.duration_minutes !== undefined && (isNaN(body.duration_minutes) || body.duration_minutes <= 0 || body.duration_minutes > 1440))
    throw Object.assign(new Error('duration_minutes must be between 1 and 1440'), { httpStatus: 400 })
  if (body.km_limit         !== undefined && (isNaN(body.km_limit)         || body.km_limit         <= 0 || body.km_limit         > 1000))
    throw Object.assign(new Error('km_limit must be between 1 and 1000'), { httpStatus: 400 })

  try {
    const pkg = await repo.updateAdminRentalPackage(id, body, adminId)
    if (!pkg) throw Object.assign(new Error('Rental package not found'), { httpStatus: 404 })
    return pkg
  } catch (err) {
    if ((err as { httpStatus?: number }).httpStatus) throw err
    rethrowIfDuplicatePackage(err)
  }
}

export async function deleteAdminRentalPackage(id: bigint) {
  try {
    const deleted = await repo.deleteAdminRentalPackage(id)
    if (!deleted) throw Object.assign(new Error('Rental package not found'), { httpStatus: 404 })
  } catch (err) {
    if ((err as { httpStatus?: number }).httpStatus) throw err
    if ((err as { code?: string }).code === '23503') {
      throw Object.assign(
        new Error('This package has been used in past rides and cannot be deleted. Deactivate it instead.'),
        { httpStatus: 409 },
      )
    }
    throw err
  }
}

export async function createAdminRentalPackage(
  body: {
    category_id: number; duration_minutes: number; km_limit: number
    package_fare: number; extra_per_km: number; extra_per_min: number; display_order?: number
  },
  adminId: bigint,
) {
  if (isNaN(body.category_id) || body.category_id <= 0)
    throw Object.assign(new Error('category_id is required'), { httpStatus: 400 })
  if (isNaN(body.duration_minutes) || body.duration_minutes <= 0 || body.duration_minutes > 1440)
    throw Object.assign(new Error('duration_minutes must be between 1 and 1440'), { httpStatus: 400 })
  if (isNaN(body.km_limit)      || body.km_limit      <= 0 || body.km_limit      > 1000)
    throw Object.assign(new Error('km_limit must be between 1 and 1000'), { httpStatus: 400 })
  if (isNaN(body.package_fare)  || body.package_fare  <= 0)
    throw Object.assign(new Error('package_fare must be > 0'), { httpStatus: 400 })
  if (isNaN(body.extra_per_km)  || body.extra_per_km  <= 0)
    throw Object.assign(new Error('extra_per_km must be > 0'), { httpStatus: 400 })
  if (isNaN(body.extra_per_min) || body.extra_per_min < 0)
    throw Object.assign(new Error('extra_per_min must be >= 0'), { httpStatus: 400 })

  try {
    return await repo.createAdminRentalPackage(body, adminId)
  } catch (err) {
    rethrowIfDuplicatePackage(err)
  }
}

export async function listAdminUsers(query: {
  status?: string; search?: string; page?: number; limit?: number
}) {
  const limit = Math.min(query.limit ?? 20, 100)
  const page  = Math.max(query.page ?? 1, 1)
  const q: { status?: string; search?: string; limit: number; offset: number } = { limit, offset: (page - 1) * limit }
  if (query.status !== undefined) q.status = query.status
  if (query.search !== undefined) q.search = query.search
  const { rows, total } = await repo.listAdminUsers(q)
  return { users: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }
}

export async function updateAdminUserStatus(userId: bigint, status: string) {
  const VALID = new Set(['active', 'suspended'])
  if (!VALID.has(status)) throw createHttpError(AppErrors.VALIDATION_ERROR)
  const updated = await repo.updateAdminUserStatus(userId, status)
  if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
  return updated
}

export async function listAdminPayments(query: {
  channel?: string; search?: string; page?: number; limit?: number
}) {
  const limit = Math.min(query.limit ?? 20, 100)
  const page  = Math.max(query.page ?? 1, 1)
  const q: { channel?: string; search?: string; limit: number; offset: number } = { limit, offset: (page - 1) * limit }
  if (query.channel !== undefined) q.channel = query.channel
  if (query.search  !== undefined) q.search  = query.search
  const { rows, total } = await repo.listAdminPayments(q)
  return { payments: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }
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
) {
  const updated = await repo.updateAdminCity(id, data)
  if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
  return updated
}

export async function getDashboardStats() {
  return repo.getAdminDashboardStats()
}

export async function getActiveSessions() {
  return repo.getActiveDriverSessions()
}
