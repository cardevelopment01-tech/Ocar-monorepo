import { describe, it, expect } from 'vitest'
import { parseVerificationFailure, retakeLine, retakePlan } from './errors'

const axiosErr = (code: string, details?: Record<string, unknown>) =>
  ({ isAxiosError: true, response: { data: { code, ...(details ? { details } : {}) } } })

describe('parseVerificationFailure', () => {
  it('reads which photo to retake and why', () => {
    expect(parseVerificationFailure(axiosErr('VERIFICATION_RETAKE', { selfie: 'NO_FACE', plate: null })))
      .toEqual({ kind: 'retake', selfie: 'NO_FACE', plate: null })
    expect(parseVerificationFailure(axiosErr('VERIFICATION_RETAKE', { selfie: null, plate: 'NO_PLATE_TEXT' })))
      .toEqual({ kind: 'retake', selfie: null, plate: 'NO_PLATE_TEXT' })
  })
  it('reads tries left for a mismatch and the under-review state', () => {
    expect(parseVerificationFailure(axiosErr('VERIFICATION_FAILED', { attemptsLeft: 2 }))).toEqual({ kind: 'failed', attemptsLeft: 2 })
    expect(parseVerificationFailure(axiosErr('VERIFICATION_FAILED'))).toEqual({ kind: 'failed', attemptsLeft: 0 })
    expect(parseVerificationFailure(axiosErr('VERIFICATION_UNDER_REVIEW'))).toEqual({ kind: 'under_review' })
  })
  it('ignores everything else, including a retake with no reasons', () => {
    expect(parseVerificationFailure(axiosErr('DAILY_CHECK_REQUIRED'))).toBeNull()
    expect(parseVerificationFailure(axiosErr('VERIFICATION_RETAKE', { selfie: null, plate: null }))).toBeNull()
    expect(parseVerificationFailure(new Error('network'))).toBeNull()
    expect(parseVerificationFailure(null)).toBeNull()
  })
})

describe('retakeLine and retakePlan', () => {
  it('gives one plain instruction per reason, with a safe fallback', () => {
    expect(retakeLine('POOR_QUALITY')).toBe('Move to better light')
    expect(retakeLine('NO_PLATE_TEXT')).toBe('Keep the whole plate in the frame')
    expect(retakeLine('SOMETHING_NEW')).toBe('Please retake this photo')
    expect(retakeLine(null)).toBe('Please retake this photo')
  })
  it('reopens only the failed step and keeps the other photo', () => {
    expect(retakePlan({ selfie: 'NO_FACE', plate: null })).toEqual({ first: 'selfie', only: 'selfie' })
    expect(retakePlan({ selfie: null, plate: 'NO_PLATE_TEXT' })).toEqual({ first: 'plate', only: 'plate' })
    expect(retakePlan({ selfie: 'NO_FACE', plate: 'NO_PLATE_TEXT' })).toEqual({ first: 'selfie', only: null })
  })
})
