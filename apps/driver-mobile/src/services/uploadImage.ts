import { getInfoAsync } from 'expo-file-system/legacy'

// TEMP: expo-image-manipulator isn't autolinked in this local pnpm workspace
// checkout (package lives hoisted at the repo root, not symlinked into
// apps/driver-mobile/node_modules -- a pre-existing, separate bug from
// whatever this debugging session is actually about). Its wrapper module
// calls requireNativeModule() at import time, so a static top-level import
// here crashed every route in the app (expo-router eagerly requires every
// route file to build its manifest). Lazy-import so this file can be
// imported without the crash; only actually failing when a caller uploads
// an image. Revert to a static import once autolinking is fixed properly.
async function loadManipulator() {
  return import('expo-image-manipulator')
}

// Same targets as web's compressDocImage() (apps/driver/src/lib/onboarding-api.ts).
// Picker/camera `quality` only re-encodes -- a 12MP photo stays 4000x3000 and
// ~2-4MB, which is the upload that times out on 3G. 1600px keeps documents legible.
export const MAX_EDGE = 1600
export const JPEG_QUALITY = 0.82

// width/height are optional: camera and picker results already carry them, and with them the
// full-resolution decode that used to run just to read the size is skipped.
type UploadFile = { uri: string; mimeType: string; fileSize: number; width?: number; height?: number }

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
    const { ImageManipulator, SaveFormat } = await loadManipulator()
    // Each full-res decode of a 12MP photo is ~48MB of native memory -- release
    // every ref/context as soon as it's done rather than waiting for GC.
    let size = file.width && file.height ? { width: file.width, height: file.height } : null
    if (!size) {
      const probe = ImageManipulator.manipulate(file.uri)
      const original = await probe.renderAsync()
      size = { width: original.width, height: original.height }
      original.release()
      probe.release()
    }
    const target = fitWithin(size.width, size.height)

    const ctx = ImageManipulator.manipulate(file.uri)
    if (target) ctx.resize(target)
    const rendered = await ctx.renderAsync()
    const out = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG })
    rendered.release()
    ctx.release()
    const info = await getInfoAsync(out.uri)
    if (!info.exists || !info.size) return file
    // The input's dimensions no longer describe the re-encoded file.
    const result: T = { ...file, uri: out.uri, mimeType: 'image/jpeg', fileSize: info.size }
    delete result.width
    delete result.height
    return result
  } catch {
    return file
  }
}
