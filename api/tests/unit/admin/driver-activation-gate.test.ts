import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({
  updateDriverStatus: vi.fn(),
}))
vi.mock('@/modules/drivers/drivers.repository', () => ({
  hasAllRequiredDocsApproved: vi.fn(),
}))

vi.mock('@/modules/rides/rides.repository', () => ({ getActiveSession: vi.fn().mockResolvedValue(null), getRideStops: vi.fn() }))
vi.mock('@/modules/rides/rides.service', () => ({
  goOffline: vi.fn().mockResolvedValue(undefined),
  forceResolveRide: vi.fn(), getRideAssignCandidates: vi.fn(), adminAssignDriver: vi.fn(),
}))

import * as repo from '@/modules/admin/admin.repository'
import { getActiveSession } from '@/modules/rides/rides.repository'
import { goOffline } from '@/modules/rides/rides.service'
import { hasAllRequiredDocsApproved } from '@/modules/drivers/drivers.repository'
import { updateDriverStatus } from '@/modules/admin/admin.service'

const DRIVER_ID = BigInt(21)
const ADMIN_ID = BigInt(1)

describe('updateDriverStatus — activation requires complete document approval', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects pending_approval -> active when required docs are not all approved', async () => {
    vi.mocked(hasAllRequiredDocsApproved).mockResolvedValue(false)
    await expect(updateDriverStatus(DRIVER_ID, ADMIN_ID, 'pending_approval', { status: 'active' }))
      .rejects.toMatchObject({ httpStatus: 422, appCode: 'DOCS_INCOMPLETE' })
    expect(repo.updateDriverStatus).not.toHaveBeenCalled()
  })

  it('rejects docs_rejected -> active when required docs are not all approved', async () => {
    vi.mocked(hasAllRequiredDocsApproved).mockResolvedValue(false)
    await expect(updateDriverStatus(DRIVER_ID, ADMIN_ID, 'docs_rejected', { status: 'active' }))
      .rejects.toMatchObject({ httpStatus: 422, appCode: 'DOCS_INCOMPLETE' })
    expect(repo.updateDriverStatus).not.toHaveBeenCalled()
  })

  it('allows activation once all required docs are approved', async () => {
    vi.mocked(hasAllRequiredDocsApproved).mockResolvedValue(true)
    await updateDriverStatus(DRIVER_ID, ADMIN_ID, 'pending_approval', { status: 'active' })
    expect(repo.updateDriverStatus).toHaveBeenCalledWith(DRIVER_ID, ADMIN_ID, 'pending_approval', 'active', undefined, undefined, undefined)
  })

  it('does not run the doc-completeness check for non-activating transitions', async () => {
    await updateDriverStatus(DRIVER_ID, ADMIN_ID, 'active', { status: 'suspended', reason: 'test reason' })
    expect(hasAllRequiredDocsApproved).not.toHaveBeenCalled()
    expect(repo.updateDriverStatus).toHaveBeenCalled()
  })

  it('ends an online session when the driver is suspended or banned, and leaves a trip alone', async () => {
    vi.mocked(getActiveSession).mockResolvedValue({ id: 1n, status: 'online' } as never)
    await updateDriverStatus(DRIVER_ID, ADMIN_ID, 'active', { status: 'suspended', reason: 'test reason' })
    expect(goOffline).toHaveBeenCalledWith(DRIVER_ID, 'admin_suspended')
    vi.mocked(goOffline).mockClear()
    vi.mocked(getActiveSession).mockResolvedValue({ id: 1n, status: 'on_trip' } as never)
    await updateDriverStatus(DRIVER_ID, ADMIN_ID, 'active', { status: 'banned', reason: 'test reason' })
    expect(goOffline).not.toHaveBeenCalled()
  })
})
