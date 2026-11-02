import { describe, it, expect } from 'vitest'
import { docFileError, isPdfUrl, MAX_DOC_BYTES } from './docFile'

describe('docFile', () => {
  it('accepts pdf and images up to the cap', () => {
    expect(docFileError({ mimeType: 'application/pdf', fileSize: MAX_DOC_BYTES })).toBeNull()
    expect(docFileError({ mimeType: 'image/png', fileSize: 1 })).toBeNull()
  })
  it('rejects other types and oversize files', () => {
    expect(docFileError({ mimeType: 'application/zip', fileSize: 1 })).toMatch(/PDF or image/)
    expect(docFileError({ mimeType: 'application/pdf', fileSize: MAX_DOC_BYTES + 1 })).toMatch(/too large/)
  })
  it('detects pdf urls, with or without a signed query', () => {
    expect(isPdfUrl('https://s3/x/rc.pdf')).toBe(true)
    expect(isPdfUrl('https://s3/x/rc.PDF?X-Amz=1')).toBe(true)
    expect(isPdfUrl('https://s3/x/rc.jpg')).toBe(false)
    expect(isPdfUrl(null)).toBe(false)
  })
})
