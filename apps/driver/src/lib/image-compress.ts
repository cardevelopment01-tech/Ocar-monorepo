// Shared canvas-based downscale, used anywhere a phone-camera photo gets
// uploaded (onboarding documents, daily verification selfie/plate). Phone
// cameras commonly produce multi-MB images; downscaling before upload cuts
// bandwidth and avoids timeouts on slow mobile connections. Non-image files
// and already-small images pass through unchanged.
export async function compressImage(
  file: File,
  opts: { maxEdge: number; quality: number }
): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, opts.maxEdge / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) return file

    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(bitmap.width  * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', opts.quality)
    )
    if (!blob) return file
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
  } catch {
    return file
  }
}
