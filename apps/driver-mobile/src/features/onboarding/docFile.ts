/** Matches the API's per-document cap (MAX_UPLOAD_BYTES in drivers.service.ts). */
export const MAX_DOC_BYTES = 10 * 1024 * 1024

export const isPdfUrl = (url: string | null | undefined): boolean => !!url && /\.pdf(\?|$)/i.test(url)

/** Error text for a file the API would reject, or null if it is fine to upload. */
export function docFileError(file: { mimeType: string; fileSize: number }): string | null {
  if (file.mimeType !== 'application/pdf' && !file.mimeType.startsWith('image/')) return 'Only PDF or image files are allowed.'
  if (file.fileSize > MAX_DOC_BYTES) return 'File is too large. Keep it under 10 MB.'
  return null
}
