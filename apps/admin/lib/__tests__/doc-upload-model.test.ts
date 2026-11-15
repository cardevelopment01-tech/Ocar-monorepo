import { describe, it, expect } from 'vitest'
import { validateUploadFile, uploadBlocker, minExpiryIso, needsExpiry } from '../doc-upload-model'

const f = (type = 'image/jpeg', size = 1000) => ({ type, size }) as File
const ok = { file: f(), expiry: '', reason: 'Driver could not upload', confirmSelfie: false }
const NOW = new Date('2026-11-15T10:00:00')

describe('validateUploadFile', () => {
  it('accepts jpg/png/pdf under 10 MB', () => {
    expect(validateUploadFile(f('application/pdf'))).toBeNull()
  })
  it('rejects other types, oversize and empty files', () => {
    expect(validateUploadFile(f('image/gif'))).toMatch(/JPG, PNG or PDF/)
    expect(validateUploadFile(f('image/png', 11 * 1024 * 1024))).toMatch(/10 MB/)
    expect(validateUploadFile(f('image/png', 0))).toMatch(/empty/)
  })
})

describe('uploadBlocker', () => {
  it('needs a file and a reason', () => {
    expect(uploadBlocker('aadhaar_front', { ...ok, file: null }, false, NOW)).toMatch(/file/)
    expect(uploadBlocker('aadhaar_front', { ...ok, reason: 'no' }, false, NOW)).toMatch(/why/)
    expect(uploadBlocker('aadhaar_front', ok, false, NOW)).toBeNull()
  })
  it('upload-for-review never needs an expiry, approve does for dated documents', () => {
    expect(uploadBlocker('insurance', ok, false, NOW)).toBeNull()
    expect(uploadBlocker('insurance', ok, true, NOW)).toMatch(/expiry/)
    expect(uploadBlocker('insurance', { ...ok, expiry: '2026-11-15' }, true, NOW)).toMatch(/expiry/)
    expect(uploadBlocker('insurance', { ...ok, expiry: '2026-11-16' }, true, NOW)).toBeNull()
    expect(uploadBlocker('aadhaar_front', ok, true, NOW)).toBeNull()
  })
  it('profile photo needs the reference-selfie confirmation', () => {
    expect(uploadBlocker('profile_photo', ok, false, NOW)).toMatch(/selfie/)
    expect(uploadBlocker('profile_photo', { ...ok, confirmSelfie: true }, true, NOW)).toBeNull()
  })
})

describe('helpers', () => {
  it('minExpiryIso is tomorrow', () => expect(minExpiryIso(NOW)).toBe('2026-11-16'))
  it('needsExpiry', () => {
    expect(needsExpiry('insurance')).toBe(true)
    expect(needsExpiry('vehicle_rc_front')).toBe(false)
  })
})
