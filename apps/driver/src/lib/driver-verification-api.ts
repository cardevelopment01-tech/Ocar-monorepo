import api from './api'
import { compressImage } from './image-compress'
import { putToS3WithRetry } from './s3-upload'

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.85

export interface DailyVerificationStatus {
  selfieDone: boolean
  plateDone: boolean
  complete: boolean
}

async function uploadOne(file: File, kind: 'selfie' | 'plate'): Promise<string> {
  const { upload_url, key } = (await api.post('/api/v1/drivers/daily-verification/upload-init', {
    kind,
    content_type: file.type,
  })).data as { upload_url: string; key: string }

  await putToS3WithRetry(upload_url, file)
  return key
}

export const driverVerificationApi = {
  getStatus: async (): Promise<DailyVerificationStatus> => {
    const res = await api.get('/api/v1/drivers/daily-verification/status')
    return res.data as DailyVerificationStatus
  },

  submit: async (selfie: File, plate: File): Promise<{ complete: true }> => {
    const [compressedSelfie, compressedPlate] = await Promise.all([
      compressImage(selfie, { maxEdge: MAX_EDGE, quality: JPEG_QUALITY }),
      compressImage(plate,  { maxEdge: MAX_EDGE, quality: JPEG_QUALITY }),
    ])
    const [selfieKey, plateKey] = await Promise.all([
      uploadOne(compressedSelfie, 'selfie'),
      uploadOne(compressedPlate, 'plate'),
    ])
    const res = await api.post('/api/v1/drivers/daily-verification', {
      selfie_key: selfieKey,
      plate_key: plateKey,
    })
    return res.data as { complete: true }
  },
}
