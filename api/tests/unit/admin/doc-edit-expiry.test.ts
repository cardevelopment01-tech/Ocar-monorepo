import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({
  updateDriverDocExpiry: vi.fn(),
  updateVehicleDocExpiry: vi.fn(),
  getDocType: vi.fn(),
  syncDriverStatusAfterDocChange: vi.fn(),
}))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))

import * as repo from '@/modules/admin/admin.repository'
import { recordAuditLog } from '@/lib/audit-log'
import { updateDocExpiry } from '@/modules/admin/admin.service'

const DOC_ID = BigInt(10)
const ADMIN_ID = BigInt(1)
const SEEN = '2026-08-24T10:00:00.000Z'
const NEW_EXPIRY = '2030-01-01'

describe('updateDocExpiry — correct the expiry of an approved document', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getDocType).mockResolvedValue('insurance')
  })

  it('updates a vehicle doc, audits old -> new, and re-syncs the driver status', async () => {
    vi.mocked(repo.updateVehicleDocExpiry).mockResolvedValue({ driver_id: '42', old_expiry: '2026-10-12' })
    await updateDocExpiry('vehicle', DOC_ID, ADMIN_ID, NEW_EXPIRY, SEEN, '1.2.3.4')
    expect(repo.updateVehicleDocExpiry).toHaveBeenCalledWith(DOC_ID, ADMIN_ID, NEW_EXPIRY, SEEN)
    expect(repo.updateDriverDocExpiry).not.toHaveBeenCalled()
    expect(recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'vehicle_documents.edit_expiry',
      beforeState: { verified_valid_until: '2026-10-12' },
      afterState: { verified_valid_until: NEW_EXPIRY },
    }))
    expect(repo.syncDriverStatusAfterDocChange).toHaveBeenCalledWith(BigInt(42), ADMIN_ID)
  })

  it('updates a driver doc through the driver repository function', async () => {
    vi.mocked(repo.getDocType).mockResolvedValue('driving_license_front')
    vi.mocked(repo.updateDriverDocExpiry).mockResolvedValue({ driver_id: '7', old_expiry: null })
    await updateDocExpiry('driver', DOC_ID, ADMIN_ID, NEW_EXPIRY, SEEN, null)
    expect(repo.updateDriverDocExpiry).toHaveBeenCalledWith(DOC_ID, ADMIN_ID, NEW_EXPIRY, SEEN)
    expect(repo.updateVehicleDocExpiry).not.toHaveBeenCalled()
  })

  it('requires a future date for an expiring document type', async () => {
    await expect(updateDocExpiry('vehicle', DOC_ID, ADMIN_ID, '', SEEN, null)).rejects.toMatchObject({ httpStatus: 422 })
    await expect(updateDocExpiry('vehicle', DOC_ID, ADMIN_ID, '2020-01-01', SEEN, null)).rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateVehicleDocExpiry).not.toHaveBeenCalled()
  })

  it('clears the date (null) for a no-expiry type, ignoring whatever was sent', async () => {
    vi.mocked(repo.getDocType).mockResolvedValue('aadhaar_front')
    vi.mocked(repo.updateDriverDocExpiry).mockResolvedValue({ driver_id: '7', old_expiry: '2026-09-09' })
    await updateDocExpiry('driver', DOC_ID, ADMIN_ID, '2031-05-05', SEEN, null)
    expect(repo.updateDriverDocExpiry).toHaveBeenCalledWith(DOC_ID, ADMIN_ID, null, SEEN)
  })

  it('409 DOC_CHANGED, no audit and no status sync, when no approved row matched the version', async () => {
    vi.mocked(repo.updateVehicleDocExpiry).mockResolvedValue(null)
    await expect(updateDocExpiry('vehicle', DOC_ID, ADMIN_ID, NEW_EXPIRY, SEEN, null))
      .rejects.toMatchObject({ httpStatus: 409, appCode: 'DOC_CHANGED' })
    expect(recordAuditLog).not.toHaveBeenCalled()
    expect(repo.syncDriverStatusAfterDocChange).not.toHaveBeenCalled()
  })

  it('400 without a document version, 404 for an unknown document', async () => {
    await expect(updateDocExpiry('vehicle', DOC_ID, ADMIN_ID, NEW_EXPIRY, '', null)).rejects.toMatchObject({ httpStatus: 400 })
    vi.mocked(repo.getDocType).mockResolvedValue(null)
    await expect(updateDocExpiry('vehicle', DOC_ID, ADMIN_ID, NEW_EXPIRY, SEEN, null)).rejects.toMatchObject({ httpStatus: 404 })
  })
})
