// Gets a picture ready for a push notification, in the browser, before it is uploaded: a centred 2:1 crop, 1024x512, JPEG. Android shows a
// notification picture as a wide banner and refuses anything over 1 MB; doing this here means the admin never has to resize anything and
// what the preview shows is exactly what is uploaded.

export const TARGET_WIDTH = 1024
export const TARGET_HEIGHT = 512
/** Aim well under Firebase's 1 MB limit: a smaller file also arrives faster on a weak connection. */
export const TARGET_BYTES = 400_000
/** What the browser has to read: a photo straight from a phone camera can be big, but not endless. */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024
/** Below this the picture would be blown up and look soft. */
export const MIN_SOURCE_WIDTH = 512

export interface CropBox { sx: number; sy: number; sw: number; sh: number }

/** The largest centred part of the source with the target's shape ("cover"). */
export function coverCrop(srcW: number, srcH: number, targetW = TARGET_WIDTH, targetH = TARGET_HEIGHT): CropBox {
  const targetRatio = targetW / targetH
  if (srcW / srcH > targetRatio) {
    const sw = Math.round(srcH * targetRatio) // too wide: trim the sides
    return { sx: Math.round((srcW - sw) / 2), sy: 0, sw, sh: srcH }
  }
  const sh = Math.round(srcW / targetRatio) // too tall (or exact): trim top and bottom
  return { sx: 0, sy: Math.round((srcH - sh) / 2), sw: srcW, sh }
}

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
  /** An object URL for the preview; the caller revokes it when done. */
  previewUrl: string
}

export class ImageProblem extends Error {}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export async function prepareBroadcastImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED.includes(file.type)) throw new ImageProblem('Choose a JPEG, PNG or WebP picture.')
  if (file.size > MAX_SOURCE_BYTES) throw new ImageProblem('That file is too large to read here (over 20 MB). Choose a smaller picture.')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageProblem('That file could not be read as a picture.')
  }
  try {
    if (bitmap.width < MIN_SOURCE_WIDTH) {
      throw new ImageProblem(`The picture is only ${bitmap.width} pixels wide. Use one at least ${MIN_SOURCE_WIDTH} wide so it stays sharp.`)
    }
    const canvas = document.createElement('canvas')
    canvas.width = TARGET_WIDTH
    canvas.height = TARGET_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageProblem('This browser cannot prepare pictures.')
    // JPEG has no transparency: put a transparent PNG on white, not black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT)
    const { sx, sy, sw, sh } = coverCrop(bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, TARGET_HEIGHT)

    // Highest quality that fits the byte target.
    let blob: Blob | null = null
    for (const quality of [0.88, 0.8, 0.72, 0.64, 0.56, 0.48]) {
      blob = await toBlob(canvas, quality)
      if (blob && blob.size <= TARGET_BYTES) break
    }
    if (!blob) throw new ImageProblem('The picture could not be prepared.')
    if (blob.size > 900_000) throw new ImageProblem('The picture is too detailed to shrink enough. Try a simpler one.')
    return { blob, width: TARGET_WIDTH, height: TARGET_HEIGHT, previewUrl: URL.createObjectURL(blob) }
  } finally {
    bitmap.close?.()
  }
}
