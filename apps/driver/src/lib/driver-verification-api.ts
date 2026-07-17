import api from './api'

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.85

// Phone camera photos are commonly several MB — downscale before upload,
// same approach as onboardingApi's compressDocImage.
async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) return file

    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(bitmap.width  * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    return file
  }
}

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
      compressImage(selfie),
      compressImage(plate),
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
