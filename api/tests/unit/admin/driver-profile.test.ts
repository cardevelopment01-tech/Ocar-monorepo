import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the repository so no DB connection is needed
vi.mock('@/modules/admin/admin.repository', () => ({
  updateDriverProfile: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
}))

import * as repo from '@/modules/admin/admin.repository'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { updateDriverProfile } from '@/modules/admin/admin.service'

const ADMIN_ID  = BigInt(1)
const DRIVER_ID = BigInt(42)
const VALID_REASON = 'Aadhaar name had a typo vs. the uploaded document'

describe('updateDriverProfile', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a missing reason', async () => {
    await expect(updateDriverProfile(DRIVER_ID, ADMIN_ID, { full_name: 'Correct Name' } as never, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateDriverProfile).not.toHaveBeenCalled()
  })

  it('rejects a reason shorter than 10 characters', async () => {
    await expect(updateDriverProfile(DRIVER_ID, ADMIN_ID, { full_name: 'X', reason: 'too short' }, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateDriverProfile).not.toHaveBeenCalled()
  })

  it('rejects a request with no fields to change', async () => {
    await expect(updateDriverProfile(DRIVER_ID, ADMIN_ID, { reason: VALID_REASON }, null))
      .rejects.toBeTruthy()
    expect(repo.updateDriverProfile).not.toHaveBeenCalled()
  })

  it('rejects a masked Aadhaar value (XXXX-XXXX-1234) instead of overwriting the real number', async () => {
    await expect(updateDriverProfile(
      DRIVER_ID, ADMIN_ID, { aadhaar_number: 'XXXX-XXXX-1234', reason: VALID_REASON }, null
    )).rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateDriverProfile).not.toHaveBeenCalled()
  })

  it('accepts a real Aadhaar number that merely resembles the mask shape at a glance', async () => {
    await updateDriverProfile(DRIVER_ID, ADMIN_ID, { aadhaar_number: '1234-5678-9012', reason: VALID_REASON }, null)
    expect(repo.updateDriverProfile).toHaveBeenCalledWith(
      DRIVER_ID, ADMIN_ID, { aadhaar_number: '1234-5678-9012' }, VALID_REASON, null
    )
  })

  it('passes only the field whitelist (never phone/status) through to the repository, and notifies the driver', async () => {
    await updateDriverProfile(DRIVER_ID, ADMIN_ID, { full_name: 'Correct Name', reason: VALID_REASON }, '1.2.3.4')

    expect(repo.updateDriverProfile).toHaveBeenCalledWith(
      DRIVER_ID, ADMIN_ID, { full_name: 'Correct Name' }, VALID_REASON, '1.2.3.4'
    )
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: DRIVER_ID }))
  })
})
