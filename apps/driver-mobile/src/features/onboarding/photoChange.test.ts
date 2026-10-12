import { describe, it, expect } from 'vitest'
import { shouldWarnBeforePhotoChange } from './photoChange'

describe('shouldWarnBeforePhotoChange', () => {
  it('warns only when replacing an approved photo (the change that newly blocks going online)', () => {
    expect(shouldWarnBeforePhotoChange('approved')).toBe(true)
  })

  it('does not warn when the photo is missing, under review, rejected or unknown', () => {
    for (const s of ['pending', 'rejected', 'expired', null, undefined, '']) {
      expect(shouldWarnBeforePhotoChange(s)).toBe(false)
    }
  })
})
