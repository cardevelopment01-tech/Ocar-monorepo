import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() }, query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), get: vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn() }, queues: {}, QUEUE_NAMES: {} }))
vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://b.s3.r.amazonaws.com/drivers/9/x.jpg'),
  getPresignedUrl: vi.fn(async (u: string) => u),
}))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: vi.fn() }))
vi.mock('@/modules/drivers/drivers.repository')
vi.mock('@/modules/drivers/drivers.service', () => ({ submitIfCompleteByAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock('@/modules/admin/admin.repository')
vi.mock('@/modules/admin/admin.service', () => ({
  afterDocChange: vi.fn(async (_d: bigint, _a: bigint, notify?: () => Promise<unknown>) => { await notify?.() }),
  docLabel: (t: string) => t,
  validateVerifiedExpiry: vi.fn((_t: string, v: string) => v || null),
}))

import * as driverRepo from '@/modules/drivers/drivers.repository'
import * as adminRepo from '@/modules/admin/admin.repository'
import { uploadFile } from '@/lib/storage'
import { recordAuditLog } from '@/lib/audit-log'
import { submitIfCompleteByAdmin } from '@/modules/drivers/drivers.service'
import {
  sniffMime, adminDocUploadSchema, uploadDriverDocumentForDriver,
} from '@/modules/admin/admin-doc-upload.service'

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const file = (buf = JPG) => ({ buffer: buf, size: buf.length, mimetype: 'image/jpeg', originalname: 'a.jpg' }) as never

const base = { kind: 'driver', doc_type: 'aadhaar_front', reason: 'Driver could not upload', approve: false, confirm_reference_selfie: false } as const
const parse = (o: Record<string, unknown>) => adminDocUploadSchema.parse({ ...base, ...o })

const T = new Date('2026-11-15T10:00:00.123Z')
const docRow = (over = {}) => ({ id: '5', doc_type: 'aadhaar_front', status: 'pending', file_url: 'old', updated_at: T, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(driverRepo.findDriverById).mockResolvedValue({ id: '9', status: 'active' } as never)
  vi.mocked(driverRepo.findDriverDocuments).mockResolvedValue([])
  vi.mocked(driverRepo.upsertDriverDocument).mockResolvedValue(docRow({ file_url: 'new' }) as never)
  vi.mocked(adminRepo.approveDriverDoc).mockResolvedValue({ driver_id: '9' })
})

describe('sniffMime', () => {
  it('trusts bytes, not the declared type', () => {
    expect(sniffMime(JPG)).toBe('image/jpeg')
    expect(sniffMime(Buffer.from('%PDF-1.7'))).toBe('application/pdf')
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png')
    expect(sniffMime(Buffer.from('<html>evil</html>'))).toBeNull()
  })
})

describe('adminDocUploadSchema', () => {
  it('requires a reason and a doc type valid for the kind', () => {
    expect(() => parse({ reason: 'x' })).toThrow()
    expect(() => parse({ kind: 'vehicle', doc_type: 'aadhaar_front' })).toThrow()
    expect(parse({ kind: 'vehicle', doc_type: 'insurance', approve: 'true' }).approve).toBe(true)
  })
  it('treats empty multipart fields as not sent', () => {
    expect(parse({ ticket_ref: '', seen_updated_at: '' }).seen_updated_at).toBeUndefined()
  })
})

describe('uploadDriverDocumentForDriver', () => {
  it('rejects a non-image/pdf file before any S3 write', async () => {
    await expect(uploadDriverDocumentForDriver(9n, 1n, file(Buffer.from('<html>')), parse({}), null)).rejects.toMatchObject({ httpStatus: 422 })
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('refuses a banned driver', async () => {
    vi.mocked(driverRepo.findDriverById).mockResolvedValue({ id: '9', status: 'banned' } as never)
    await expect(uploadDriverDocumentForDriver(9n, 1n, file(), parse({}), null)).rejects.toMatchObject({ appCode: 'DRIVER_NOT_EDITABLE' })
  })

  it('needs the confirmation for a profile photo', async () => {
    await expect(uploadDriverDocumentForDriver(9n, 1n, file(), parse({ doc_type: 'profile_photo' }), null))
      .rejects.toMatchObject({ appCode: 'CONFIRMATION_REQUIRED' })
  })

  it('refuses a vehicle document when the driver has no vehicle', async () => {
    vi.mocked(driverRepo.findVehicleByDriverId).mockResolvedValue(null)
    await expect(uploadDriverDocumentForDriver(9n, 1n, file(), parse({ kind: 'vehicle', doc_type: 'insurance' }), null))
      .rejects.toMatchObject({ appCode: 'STEP_NOT_COMPLETE' })
  })

  it('replacing needs the version the admin saw, and a stale one is a 409', async () => {
    vi.mocked(driverRepo.findDriverDocuments).mockResolvedValue([docRow()] as never)
    await expect(uploadDriverDocumentForDriver(9n, 1n, file(), parse({}), null)).rejects.toMatchObject({ httpStatus: 400 })
    await expect(uploadDriverDocumentForDriver(9n, 1n, file(), parse({ seen_updated_at: '2026-11-15T09:00:00.000Z' }), null))
      .rejects.toMatchObject({ appCode: 'DOC_CHANGED' })
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('uploads for review: stays pending, tagged with the admin, audited', async () => {
    const r = await uploadDriverDocumentForDriver(9n, 1n, file(), parse({ ticket_ref: 'T-42' }), '1.2.3.4')
    expect(r.status).toBe('pending')
    expect(driverRepo.upsertDriverDocument).toHaveBeenCalledWith(9n, 'aadhaar_front', expect.any(String), undefined, undefined, 1n)
    expect(adminRepo.approveDriverDoc).not.toHaveBeenCalled()
    expect(recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'driver_documents.admin_upload', targetTable: 'drivers', targetId: 9n, reason: 'Driver could not upload [T-42]',
      afterState: expect.objectContaining({ uploaded_by_admin_id: '1', document: 'aadhaar_front' }),
    }))
  })

  it('upload and approve approves the fresh row and can submit the application', async () => {
    vi.mocked(submitIfCompleteByAdmin).mockResolvedValue(true)
    const r = await uploadDriverDocumentForDriver(9n, 1n, file(), parse({ approve: 'true' }), null)
    expect(adminRepo.approveDriverDoc).toHaveBeenCalledWith(5n, 1n, null, T.toISOString())
    expect(r).toMatchObject({ status: 'approved', submitted: true })
  })

  it('a profile photo also becomes the reference selfie', async () => {
    vi.mocked(driverRepo.upsertDriverDocument).mockResolvedValue(docRow({ doc_type: 'profile_photo' }) as never)
    await uploadDriverDocumentForDriver(9n, 1n, file(), parse({ doc_type: 'profile_photo', confirm_reference_selfie: 'true' }), null)
    expect(driverRepo.setReferenceSelfie).toHaveBeenCalledWith(9n, expect.any(String))
  })
})
