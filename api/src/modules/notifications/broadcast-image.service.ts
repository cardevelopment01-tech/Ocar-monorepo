import { httpError } from '@/lib/errors'
import { isCompleteImage, readImageInfo } from '@/lib/image-info'
import { isPublicImageStorageConfigured, publicImageBaseUrl, uploadPublicImage } from '@/lib/storage'
import { isPublicHttpsUrl } from './broadcast.service'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'broadcast-image' })

// Firebase shows a notification picture on Android only up to 1 MB (docs: customize-messages/cross-platform); the admin page crops and
// compresses to 1024x512, so a real upload is far smaller. The size bounds here are for anything that skips that page.
export const BROADCAST_IMAGE_MAX_BYTES = 1_000_000
export const BROADCAST_IMAGE_MIN_WIDTH = 512
export const BROADCAST_IMAGE_MAX_WIDTH = 2048
// A wide banner: Android shows a notification picture at about 2:1. The page produces exactly 2:1; a little slack is allowed.
const MIN_RATIO = 1.8
const MAX_RATIO = 2.2

export interface BroadcastImage {
  url: string
  width: number
  height: number
  bytes: number
}

export async function saveBroadcastImage(file: { buffer: Buffer; size: number } | undefined): Promise<BroadcastImage> {
  if (!isPublicImageStorageConfigured()) {
    throw httpError(503, 'Picture upload is not set up on this server yet. Paste a link to a picture instead.', 'IMAGE_UPLOAD_NOT_CONFIGURED')
  }
  // A broadcast refuses a picture link that is not a public https one, so storing pictures at such an address would let every upload
  // work and then every send fail. Say so now, before anything is stored.
  if (!isPublicHttpsUrl(publicImageBaseUrl() + '/')) {
    log.error({ base: publicImageBaseUrl() }, 'broadcast picture storage has an address that is not a public https one (BROADCAST_IMAGE_BASE_URL)')
    throw httpError(503, 'Picture storage is set up with an address that is not a public https link. Ask a developer to check BROADCAST_IMAGE_BASE_URL. Meanwhile, paste a link to a picture instead.', 'IMAGE_UPLOAD_NOT_CONFIGURED')
  }
  if (!file) throw httpError(422, 'Choose a picture to upload', 'VALIDATION_ERROR')
  if (file.size > BROADCAST_IMAGE_MAX_BYTES) throw httpError(422, 'The picture must be under 1 MB', 'FILE_TOO_LARGE')

  const info = readImageInfo(file.buffer)
  if (!info) throw httpError(422, 'Only JPEG and PNG pictures are supported', 'UNSUPPORTED_FILE_TYPE')
  if (!isCompleteImage(file.buffer, info.type)) throw httpError(422, 'The picture file is incomplete or damaged. Try another one.', 'VALIDATION_ERROR')
  if (info.width < BROADCAST_IMAGE_MIN_WIDTH || info.width > BROADCAST_IMAGE_MAX_WIDTH) {
    throw httpError(422, `The picture must be between ${BROADCAST_IMAGE_MIN_WIDTH} and ${BROADCAST_IMAGE_MAX_WIDTH} pixels wide`, 'VALIDATION_ERROR')
  }
  const ratio = info.width / info.height
  if (!(ratio >= MIN_RATIO && ratio <= MAX_RATIO)) {
    throw httpError(422, 'The picture must be a wide banner, about twice as wide as it is tall (2:1)', 'VALIDATION_ERROR')
  }

  // The name comes from the verified type, never from the uploaded file's own name.
  const url = await uploadPublicImage(file.buffer, info.type === 'png' ? 'image/png' : 'image/jpeg', info.type === 'png' ? 'png' : 'jpg', 'broadcasts')
  log.info({ bytes: file.size, width: info.width, height: info.height }, 'broadcast picture stored')
  return { url, width: info.width, height: info.height, bytes: file.size }
}
