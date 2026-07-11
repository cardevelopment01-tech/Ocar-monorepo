import { createHttpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { getPresignedUrl } from '@/lib/storage'
import * as repo from './admin.repository'
import type { DriverStatus, UpdateDriverStatusPayload } from './admin.types'
import { forceResolveRide as resolveStuckRide } from '@/modules/rides/rides.service'

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

// ─── Admin accounts ───────────────────────────────────────────────────────────

export async function listAdminAccounts() { return repo.listAdminAccounts() }

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

export async function approveDriverDoc(docId: bigint, adminId: bigint) {
  return repo.approveDriverDoc(docId, adminId)
}

export async function rejectDriverDoc(docId: bigint, adminId: bigint, note: string) {
  if (!note || note.length < 10) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.rejectDriverDoc(docId, adminId, note)
}

export async function approveVehicleDoc(docId: bigint, adminId: bigint) {
  return repo.approveVehicleDoc(docId, adminId)
}

export async function rejectVehicleDoc(docId: bigint, adminId: bigint, note: string) {
  if (!note || note.length < 10) throw createHttpError(AppErrors.VALIDATION_ERROR)
  return repo.rejectVehicleDoc(docId, adminId, note)
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
  status?: string; ride_type?: string; search?: string; page?: number; limit?: number
}) {
  const limit = Math.min(query.limit ?? 20, 100)
  const page  = Math.max(query.page ?? 1, 1)
  const q: { status?: string; ride_type?: string; search?: string; limit: number; offset: number } = { limit, offset: (page - 1) * limit }
  if (query.status    !== undefined) q.status    = query.status
  if (query.ride_type !== undefined) q.ride_type = query.ride_type
  if (query.search    !== undefined) q.search    = query.search
  const { rows, total } = await repo.listAdminRides(q)
  return { rides: rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } }
}

export async function listUpcomingScheduledRides() {
  return repo.listUpcomingScheduledRides()
}

export async function getAdminRideById(rideId: bigint) {
  const ride = await repo.getAdminRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  return ride
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
