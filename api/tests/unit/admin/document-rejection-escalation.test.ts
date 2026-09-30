import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({
  rejectDriverDoc: vi.fn(),
  rejectVehicleDoc: vi.fn(),
  getDocType: vi.fn(),
  syncDriverStatusAfterDocChange: vi.fn(),
}))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
  notifyAllAdmins: vi.fn(),
}))
vi.mock('@/modules/notifications/templates.service', () => ({
  renderTemplate: vi.fn().mockResolvedValue({ subject: 'Document Rejected', body: 'rendered' }),
}))
vi.mock('@/jobs/queues', () => ({
  notificationsQueue: { add: vi.fn() },
}))
vi.mock('@/modules/drivers/drivers.repository', () => ({
  hasAllRequiredDocsApproved: vi.fn(),
  findDriverById: vi.fn().mockResolvedValue({ full_name: 'Test Driver', phone: '+919999999999' }),
}))

import * as repo from '@/modules/admin/admin.repository'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { notificationsQueue } from '@/jobs/queues'
import { rejectDriverDoc } from '@/modules/admin/admin.service'

const DOC_ID = BigInt(10)
const ADMIN_ID = BigInt(1)
const NOTE = 'Photo is blurry, please retake'
const SEEN = '2026-08-24T10:00:00.000Z'

describe('rejectDriverDoc — tiered notification and escalation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getDocType).mockResolvedValue('driving_license_front')
  })

  it('1st rejection: notifies once, no escalation job queued', async () => {
    vi.mocked(repo.rejectDriverDoc).mockResolvedValue({ driver_id: '21', doc_type: 'driving_license_front', rejection_count: 1 })
    await rejectDriverDoc(DOC_ID, ADMIN_ID, NOTE, SEEN, null)
    expect(renderTemplate).toHaveBeenCalledWith('document_rejected', 'push', expect.objectContaining({ follow_up_note: '' }))
    expect(notifyOwner).toHaveBeenCalledTimes(1)
    expect(notificationsQueue.add).not.toHaveBeenCalled()
  })

  it('2nd rejection: distinct follow-up copy, still no escalation', async () => {
    vi.mocked(repo.rejectDriverDoc).mockResolvedValue({ driver_id: '21', doc_type: 'driving_license_front', rejection_count: 2 })
    await rejectDriverDoc(DOC_ID, ADMIN_ID, NOTE, SEEN, null)
    expect(renderTemplate).toHaveBeenCalledWith('document_rejected', 'push', expect.objectContaining({
      follow_up_note: expect.stringContaining('2nd time'),
    }))
    expect(notificationsQueue.add).not.toHaveBeenCalled()
  })

  it('3rd rejection: escalation job queued with driver contact + count', async () => {
    vi.mocked(repo.rejectDriverDoc).mockResolvedValue({ driver_id: '21', doc_type: 'driving_license_front', rejection_count: 3 })
    await rejectDriverDoc(DOC_ID, ADMIN_ID, NOTE, SEEN, null)
    expect(notificationsQueue.add).toHaveBeenCalledWith('document_rejection_escalated', expect.objectContaining({
      driverId: '21', driverPhone: '+919999999999', rejectionCount: '3',
    }))
  })

  it('404s when the document does not exist (no silent success)', async () => {
    vi.mocked(repo.getDocType).mockResolvedValue(null)
    await expect(rejectDriverDoc(DOC_ID, ADMIN_ID, NOTE, SEEN, null)).rejects.toMatchObject({ httpStatus: 404 })
    expect(repo.rejectDriverDoc).not.toHaveBeenCalled()
  })

  it('409 DOC_CHANGED when the doc was re-uploaded since the reviewer loaded it', async () => {
    vi.mocked(repo.rejectDriverDoc).mockResolvedValue(null)
    await expect(rejectDriverDoc(DOC_ID, ADMIN_ID, NOTE, SEEN, null))
      .rejects.toMatchObject({ httpStatus: 409, appCode: 'DOC_CHANGED' })
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('400 when the document version is missing', async () => {
    await expect(rejectDriverDoc(DOC_ID, ADMIN_ID, NOTE, '', null)).rejects.toMatchObject({ httpStatus: 400 })
    expect(repo.rejectDriverDoc).not.toHaveBeenCalled()
  })
})
