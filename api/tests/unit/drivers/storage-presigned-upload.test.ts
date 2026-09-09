import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: sendMock })),
  PutObjectCommand: vi.fn((input) => ({ input, __type: 'PutObjectCommand' })),
  CopyObjectCommand: vi.fn((input) => ({ input, __type: 'CopyObjectCommand' })),
  DeleteObjectCommand: vi.fn((input) => ({ input, __type: 'DeleteObjectCommand' })),
  GetObjectCommand: vi.fn((input) => ({ input, __type: 'GetObjectCommand' })),
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/put-url'),
}))
vi.mock('@/config', () => ({
  config: { S3_BUCKET_NAME: 'ocar-docs', S3_REGION: 'ap-south-1', S3_ACCESS_KEY: 'k', S3_SECRET_KEY: 's' },
}))

import { getUploadUrl, promotePendingUpload, getPresignedUrl, deleteFile } from '@/lib/storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

describe('getUploadUrl', () => {
  beforeEach(() => vi.clearAllMocks())

  it('signs a PutObject request with the given key, content type, and exact content length, 5-minute expiry', async () => {
    const url = await getUploadUrl('uploads/pending/drivers/7/profile_photo/abc.jpg', 'image/jpeg', 204800)
    expect(url).toBe('https://signed.example.com/put-url')
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: 'ocar-docs',
          Key: 'uploads/pending/drivers/7/profile_photo/abc.jpg',
          ContentType: 'image/jpeg',
          ContentLength: 204800,
        }),
      }),
      { expiresIn: 300 }
    )
  })
})

describe('promotePendingUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendMock.mockResolvedValue({})
  })

  it('copies the pending object into the target folder and deletes the pending copy', async () => {
    const finalUrl = await promotePendingUpload(
      'uploads/pending/drivers/7/profile_photo/abc.jpg',
      'drivers/7/profile_photo'
    )
    expect(sendMock).toHaveBeenCalledTimes(2)
    const copyCall = sendMock.mock.calls[0]![0] as { __type: string; input: Record<string, unknown> }
    expect(copyCall.__type).toBe('CopyObjectCommand')
    expect(copyCall.input['CopySource']).toBe('ocar-docs/uploads/pending/drivers/7/profile_photo/abc.jpg')
    expect(copyCall.input['Key']).toMatch(/^drivers\/7\/profile_photo\/.+\.jpg$/)
    const deleteCall = sendMock.mock.calls[1]![0] as { __type: string; input: Record<string, unknown> }
    expect(deleteCall.__type).toBe('DeleteObjectCommand')
    expect(deleteCall.input['Key']).toBe('uploads/pending/drivers/7/profile_photo/abc.jpg')
    expect(finalUrl).toMatch(/^https:\/\/ocar-docs\.s3\.ap-south-1\.amazonaws\.com\/drivers\/7\/profile_photo\/.+\.jpg$/)
  })
})

describe('getPresignedUrl / deleteFile against a URL from a since-migrated bucket', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendMock.mockResolvedValue({})
  })

  // A bucket migration (different name and/or region) leaves old DB rows
  // pointing at the OLD bucket/region -- both read paths must still resolve
  // the key against the CURRENT config.S3_BUCKET_NAME, not require an exact
  // match against the URL's own (now-historical) bucket/region.
  const oldUrl = 'https://ocar-bucket.s3.ap-south-2.amazonaws.com/drivers/7/profile_photo/abc.jpg'

  it('signs a GetObject request for the current bucket using the key extracted from an old-bucket URL', async () => {
    await getPresignedUrl(oldUrl)
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: expect.objectContaining({ Bucket: 'ocar-docs', Key: 'drivers/7/profile_photo/abc.jpg' }),
      }),
      { expiresIn: 3600 }
    )
  })

  it('passes through unchanged a URL that is not a virtual-hosted-style S3 URL', async () => {
    const nonS3Url = 'http://minio:9000/ocar-docs/drivers/7/profile_photo/abc.jpg'
    await expect(getPresignedUrl(nonS3Url)).resolves.toBe(nonS3Url)
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it('deletes the object from the current bucket using the key extracted from an old-bucket URL', async () => {
    await deleteFile(oldUrl)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0]![0] as { __type: string; input: Record<string, unknown> }
    expect(call.__type).toBe('DeleteObjectCommand')
    expect(call.input).toEqual({ Bucket: 'ocar-docs', Key: 'drivers/7/profile_photo/abc.jpg' })
  })
})
