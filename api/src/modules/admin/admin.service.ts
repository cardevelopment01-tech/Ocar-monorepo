import { createHttpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import { getPresignedUrl } from '@/lib/storage'
import * as repo from './admin.repository'
import type { DriverStatus, UpdateDriverStatusPayload } from './admin.types'

const VALID_STATUSES = new Set<DriverStatus>(['pending_docs', 'pending_approval', 'active', 'suspended', 'banned'])

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
  payload: UpdateDriverStatusPayload
) {
  if (!VALID_STATUSES.has(payload.status)) {
    throw createHttpError(AppErrors.VALIDATION_ERROR)
  }

  // Cannot transition from active → pending_docs/pending_approval
  const backwardTransitions = new Set(['pending_docs', 'pending_approval'])
  if (currentStatus === 'active' && backwardTransitions.has(payload.status)) {
    throw createHttpError(AppErrors.VALIDATION_ERROR)
  }

  await repo.updateDriverStatus(driverId, adminId, currentStatus, payload.status, payload.reason)
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
