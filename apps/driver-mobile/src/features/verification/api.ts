import { api } from '@/services/api'

export type DailyVerificationStatus = {
  selfieDone: boolean
  plateDone: boolean
  complete: boolean
}

export type PickedPhoto = { uri: string; mimeType: string; fileSize: number }

// Same presigned-PUT-from-local-URI approach as onboarding's api.ts -- kept as
// its own small copy rather than a shared import since these are two
// independent upload flows (different backend routes/keys) that happen to
// share a shape, not the same feature.
async function putToS3WithRetry(uploadUrl: string, uri: string, contentType: string, attempts = 3): Promise<void> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const blob = await (await fetch(uri)).blob()
      const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob })
      if (!res.ok) throw new Error(`S3 PUT failed: ${res.status}`)
      return
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** i))
    }
  }
  throw lastErr
}

export async function fetchVerificationStatus(): Promise<DailyVerificationStatus> {
  const res = await api.get('/api/v1/drivers/daily-verification/status')
  return res.data as DailyVerificationStatus
}

async function uploadOne(file: PickedPhoto, kind: 'selfie' | 'plate'): Promise<string> {
  const { upload_url, key } = (await api.post('/api/v1/drivers/daily-verification/upload-init', {
    kind,
    content_type: file.mimeType,
    content_length: file.fileSize,
  })).data as { upload_url: string; key: string }

  await putToS3WithRetry(upload_url, file.uri, file.mimeType)
  return key
}

export async function submitVerification(selfie: PickedPhoto, plate: PickedPhoto): Promise<{ complete: true }> {
  const [selfieKey, plateKey] = await Promise.all([uploadOne(selfie, 'selfie'), uploadOne(plate, 'plate')])
  const res = await api.post('/api/v1/drivers/daily-verification', { selfie_key: selfieKey, plate_key: plateKey })
  return res.data as { complete: true }
}
