import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { getInfoAsync } from 'expo-file-system/legacy'

// Same targets as web's compressDocImage() (apps/driver/src/lib/onboarding-api.ts).
// Picker/camera `quality` only re-encodes -- a 12MP photo stays 4000x3000 and
// ~2-4MB, which is the upload that times out on 3G. 1600px keeps documents legible.
export const MAX_EDGE = 1600
export const JPEG_QUALITY = 0.82

type UploadFile = { uri: string; mimeType: string; fileSize: number }

/** Resize target that fits the longer edge within maxEdge, or null if already small enough. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number | null; height: number | null } | null {
  if (Math.max(width, height) <= maxEdge) return null
  return width >= height ? { width: maxEdge, height: null } : { width: null, height: maxEdge }
}

/**
 * Downscale + JPEG re-encode before a presigned S3 PUT. Non-images (PDFs) pass
 * through; any manipulator failure falls back to the original file, same as web.
 * fileSize is re-read from disk because the presigned PUT is signed for it.
 */
export async function prepareImageForUpload<T extends UploadFile>(file: T): Promise<T> {
  if (!file.mimeType.startsWith('image/')) return file
  try {
    // Each full-res decode of a 12MP photo is ~48MB of native memory -- release
    // every ref/context as soon as it's done rather than waiting for GC.
    const probe = ImageManipulator.manipulate(file.uri)
    const original = await probe.renderAsync()
    const target = fitWithin(original.width, original.height)
    original.release()
    probe.release()

    const ctx = ImageManipulator.manipulate(file.uri)
    if (target) ctx.resize(target)
    const rendered = await ctx.renderAsync()
    const out = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG })
    rendered.release()
    ctx.release()
    const info = await getInfoAsync(out.uri)
    if (!info.exists || !info.size) return file
    return { ...file, uri: out.uri, mimeType: 'image/jpeg', fileSize: info.size }
  } catch {
    return file
  }
}
