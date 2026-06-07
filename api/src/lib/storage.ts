import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { config } from '@/config'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'

function createClient(): S3Client {
  if (config.NODE_ENV !== 'production' && config.MINIO_ENDPOINT) {
    return new S3Client({
      region: config.S3_REGION || 'us-east-1',
      endpoint: config.MINIO_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY || 'minioadmin',
        secretAccessKey: config.S3_SECRET_KEY || 'minioadmin',
      },
    })
  }
  return new S3Client({
    region: config.S3_REGION,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  })
}

const s3 = createClient()

function buildUrl(key: string): string {
  if (config.NODE_ENV !== 'production') {
    return `${config.MINIO_ENDPOINT}/${config.S3_BUCKET_NAME}/${key}`
  }
  return `https://${config.S3_BUCKET_NAME}.s3.${config.S3_REGION}.amazonaws.com/${key}`
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

  return buildUrl(key)
}

export async function deleteFile(url: string): Promise<void> {
  const prefix =
    config.NODE_ENV !== 'production'
      ? `${config.MINIO_ENDPOINT}/${config.S3_BUCKET_NAME}/`
      : `https://${config.S3_BUCKET_NAME}.s3.${config.S3_REGION}.amazonaws.com/`

  const key = url.startsWith(prefix) ? url.slice(prefix.length) : null
  if (!key) return

  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET_NAME, Key: key }))
}
