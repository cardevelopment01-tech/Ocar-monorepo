import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/storage', () => ({
  getUploadUrl: vi.fn().mockResolvedValue('https://signed.example.com/put'),
  promotePendingUpload: vi.fn().mockResolvedValue('https://ocar-docs.s3.ap-south-1.amazonaws.com/drivers/7/profile_photo/xyz.jpg'),
  getPresignedUrl: vi.fn().mockImplementation((url: string) => Promise.resolve(`${url}?signed=1`)),
}))
vi.mock('@/modules/drivers/drivers.repository', () => ({
  findDriverById: vi.fn().mockResolvedValue({ id: BigInt(7) }),
  upsertDriverDocument: vi.fn().mockResolvedValue({ doc_type: 'profile_photo', file_url: 'https://ocar-docs.s3.ap-south-1.amazonaws.com/drivers/7/profile_photo/xyz.jpg', status: 'pending' }),
  setReferenceSelfie: vi.fn().mockResolvedValue(undefined),
}))

import { initDriverDocumentUpload, completeDriverDocumentUpload } from '@/modules/drivers/drivers.service'
import { promotePendingUpload } from '@/lib/storage'

describe('initDriverDocumentUpload', () => {
  it('scopes the pending key under the requesting driver only', async () => {
    const { key } = await initDriverDocumentUpload(BigInt(7), 'profile_photo', 'image/jpeg', 204800)
    expect(key).toMatch(/^uploads\/pending\/drivers\/7\/profile_photo\/.+\.jpg$/)
  })

  it('rejects a file over the 10MB limit before signing anything', async () => {
    await expect(initDriverDocumentUpload(BigInt(7), 'profile_photo', 'image/jpeg', 11 * 1024 * 1024))
      .rejects.toMatchObject({ appCode: 'FILE_TOO_LARGE' })
  })
})

describe('completeDriverDocumentUpload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('promotes the object and upserts the document when the key belongs to the driver', async () => {
    const key = 'uploads/pending/drivers/7/profile_photo/xyz.jpg'
    const result = await completeDriverDocumentUpload(BigInt(7), key, 'profile_photo')
    expect(promotePendingUpload).toHaveBeenCalledWith(key, 'drivers/7/profile_photo')
    expect(result.doc_type).toBe('profile_photo')
  })

  it('rejects a key that does not belong to the requesting driver', async () => {
    const foreignKey = 'uploads/pending/drivers/99/profile_photo/xyz.jpg'
    await expect(completeDriverDocumentUpload(BigInt(7), foreignKey, 'profile_photo'))
      .rejects.toMatchObject({ appCode: 'AUTH_FORBIDDEN' })
    expect(promotePendingUpload).not.toHaveBeenCalled()
  })
})
