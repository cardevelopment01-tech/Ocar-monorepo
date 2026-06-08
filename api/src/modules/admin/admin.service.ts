import { createHttpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
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

  const { rows, total } = await repo.listDrivers({
    status: query.status,
    search: query.search,
    limit,
    offset,
  })

  return {
    drivers: rows,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  }
}

export async function getDriver(id: bigint) {
  const driver = await repo.getDriverById(id)
  if (!driver) throw createHttpError(AppErrors.NOT_FOUND)
  return driver
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
