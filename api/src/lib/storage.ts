import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '@/config'
import { awsCredentials } from '@/lib/aws-credentials'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'

// requestChecksumCalculation defaults to WHEN_SUPPORTED as of SDK v3.729+,
// which makes getSignedUrl() sign a checksum computed over an empty body
// (presigning happens before any file bytes exist). Real uploads with a
// non-empty body then fail checksum validation, surfacing to the browser as
// an opaque CORS-looking failure. WHEN_REQUIRED restores pre-3.729 behavior.
const s3 = new S3Client({
  region: config.S3_REGION,
  ...awsCredentials(),
  requestChecksumCalculation: 'WHEN_REQUIRED',
})

const S3_URL_PREFIX = `https://${config.S3_BUCKET_NAME}.s3.${config.S3_REGION}.amazonaws.com/`

// Matches any virtual-hosted-style S3 URL (any bucket/region), not just the
// CURRENT config.S3_BUCKET_NAME/S3_REGION -- rows written before a bucket
// migration point at whatever bucket/region was live then. New uploads
// always target the current bucket/region (S3_URL_PREFIX, above), so read
// paths only need to recognize the URL *shape* to keep resolving old links
// after a migration, not match a specific historical value.
const S3_URL_PATTERN = /^https:\/\/[^./]+\.s3\.[^./]+\.amazonaws\.com\/(.+)$/

// ── Public pictures (admin broadcasts) ──
// A separate bucket on purpose: the documents bucket is private (identity documents), while a notification picture must be readable by any
// phone. Only the broadcasts/ prefix of this bucket is public. Not configured => the feature is off, nothing is written anywhere.
export function isPublicImageStorageConfigured(): boolean {
  return config.BROADCAST_IMAGE_BUCKET !== ''
}

/** The public address pictures are served from, no trailing slash: BROADCAST_IMAGE_BASE_URL, else the bucket's own S3 address. */
export function publicImageBaseUrl(): string {
  return config.BROADCAST_IMAGE_BASE_URL !== '' ? config.BROADCAST_IMAGE_BASE_URL.replace(/\/+$/, '') : `https://${config.BROADCAST_IMAGE_BUCKET}.s3.${config.S3_REGION}.amazonaws.com`
}

export async function uploadPublicImage(body: Buffer, contentType: 'image/jpeg' | 'image/png', ext: 'jpg' | 'png', folder: string): Promise<string> {
  if (!isPublicImageStorageConfigured()) throw new Error('public image bucket is not configured')
  const key = `${folder}/${uuidv4()}.${ext}`
  await s3.send(
    new PutObjectCommand({
      Bucket: config.BROADCAST_IMAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
      // A new random key per upload, so the file never changes: phones and CDNs may keep it as long as they like.
      CacheControl: 'public, max-age=31536000, immutable',
    })
  )
  return `${publicImageBaseUrl()}/${key}`
}

/** Writes one object to the private documents bucket at an exact key (used for the nightly audit-log archive). */
export async function putPrivateObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: key, Body: body, ContentType: contentType }))
}

export function extractS3Key(url: string): string | null {
  return url.match(S3_URL_PATTERN)?.[1] ?? null
}

export async function uploadFile(
  file: Express.Multer.File,
  folder: string
): Promise<string> {
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
  const key = `${folder}/${uuidv4()}${ext}`

  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentLength: file.size,
    })
  )

  return `${S3_URL_PREFIX}${key}`
}

// Signing with an exact ContentLength is what makes a plain presigned PUT
// enforce a size cap -- S3 rejects the upload if the actual Content-Length
// header doesn't match what was signed. Presigned POST supports a size
// *range* via a policy document; presigned PUT only supports an exact
// value, which is fine here since the client already knows its (compressed)
// file's byte length before requesting the URL.
export async function getUploadUrl(key: string, contentType: string, contentLength: number): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: key, ContentType: contentType, ContentLength: contentLength }),
    { expiresIn: 300 }
  )
}

export async function promotePendingUpload(pendingKey: string, folder: string): Promise<string> {
  const ext = path.extname(pendingKey) || '.jpg'
  const finalKey = `${folder}/${uuidv4()}${ext}`

  await s3.send(
    new CopyObjectCommand({
      Bucket: config.S3_BUCKET_NAME,
      CopySource: `${config.S3_BUCKET_NAME}/${pendingKey}`,
      Key: finalKey,
    })
  )
  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: pendingKey }))

  return `${S3_URL_PREFIX}${finalKey}`
}

export async function getPresignedUrl(fileUrl: string, expiresIn = 3600): Promise<string> {
  const key = extractS3Key(fileUrl)
  if (!key) return fileUrl

  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: key }),
    { expiresIn }
  )
}

export async function deleteFile(url: string): Promise<void> {
  const key = extractS3Key(url)
  if (!key) return

  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: key }))
}
