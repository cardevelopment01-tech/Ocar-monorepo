import api from './api'
import { compressImage } from './image-compress'

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.85

export interface DailyVerificationStatus {
  selfieDone: boolean
  plateDone: boolean
  complete: boolean
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
    const formData = new FormData()
    formData.append('selfie', compressedSelfie)
    formData.append('plate', compressedPlate)
    const res = await api.post('/api/v1/drivers/daily-verification', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
    return res.data as { complete: true }
  },
}
