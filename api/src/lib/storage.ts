import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '@/config'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'

const s3 = new S3Client({
  region: config.S3_REGION,
  credentials: {
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  },
})

const S3_URL_PREFIX = `https://${config.S3_BUCKET_NAME}.s3.${config.S3_REGION}.amazonaws.com/`

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

export async function getPresignedUrl(fileUrl: string, expiresIn = 3600): Promise<string> {
  const key = fileUrl.startsWith(S3_URL_PREFIX) ? fileUrl.slice(S3_URL_PREFIX.length) : null
  if (!key) return fileUrl

  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: key }),
    { expiresIn }
  )
}

export async function deleteFile(url: string): Promise<void> {
  const key = url.startsWith(S3_URL_PREFIX) ? url.slice(S3_URL_PREFIX.length) : null
  if (!key) return

  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: key }))
}
