import { describe, expect, it } from 'vitest'
import { mapOtpErrorCode } from './errorMessages'

describe('mapOtpErrorCode', () => {
  it('maps each known AUTH_OTP_* code to specific copy', () => {
    expect(mapOtpErrorCode('AUTH_OTP_EXPIRED')).toBe('Code expired, request a new one')
    expect(mapOtpErrorCode('AUTH_OTP_INVALID')).toBe('Incorrect code')
    expect(mapOtpErrorCode('AUTH_OTP_LOCKED')).toBe('Too many attempts, try again in a few minutes')
    expect(mapOtpErrorCode('AUTH_OTP_RATE_LIMITED')).toBe('Too many attempts, try again in a few minutes')
  })

  it('falls back to a generic message for an unknown code', () => {
    expect(mapOtpErrorCode('SOME_FUTURE_CODE')).toBe('Something went wrong, please try again')
  })
})
