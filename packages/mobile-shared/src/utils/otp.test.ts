import { describe, expect, it } from 'vitest'
import { OTP_SLOW_AFTER_SEC, otpWaitStatus, parseOtp } from './otp'

// Value: protects=the code is read out of the SMS correctly (never a phone number, year or the app hash) and the waiting screen says the
// right calm thing at the right time; fails_when=a long number is taken for the code, the slow hint shows while the user is typing, or the
// detected state is lost; why_new=Android SMS auto-read; seam=pure functions; no_claim=that the phone delivers the SMS.
describe('parseOtp', () => {
  it('reads the code from the auto-read layout (code first, app hash last)', () => {
    expect(parseOtp('<#> 483920 is your OTP for OD CAR RENTALS PRIVATE LIMITED. Do not share it with anyone. Valid for 10 minutes.\nFA+9qCX9VSu')).toBe('483920')
  })
  it('reads it from the original wording too', () => {
    expect(parseOtp('Dear Customer, your OTP for verification with OD CAR RENTALS PRIVATE LIMITED is 120045. Do not share it with anyone. Valid for 10 minutes.')).toBe('120045')
  })
  it('never takes a longer number for the code', () => {
    expect(parseOtp('Call 9876543210 now, code 555123')).toBe('555123')
    expect(parseOtp('Ref 1234567 only')).toBeNull()
    expect(parseOtp('2026 is the year')).toBeNull()
  })
  it('a hash made of digits and letters is not a code', () => {
    expect(parseOtp('Your code is 246810\n123456abcde')).toBe('246810')
  })
  it('null for nothing usable', () => {
    expect(parseOtp(null)).toBeNull()
    expect(parseOtp(undefined)).toBeNull()
    expect(parseOtp('')).toBeNull()
    expect(parseOtp('no digits here')).toBeNull()
  })
  it('honours another length (the 4 digit ride PIN)', () => {
    expect(parseOtp('Your PIN is 4821', 4)).toBe('4821')
    expect(parseOtp('Your PIN is 482110', 4)).toBeNull()
  })
})

describe('otpWaitStatus', () => {
  const base = { elapsedSec: 3, autoReading: false, detected: false, typed: 0 }
  it('waits calmly at first', () => {
    expect(otpWaitStatus(base)).toEqual({ kind: 'waiting', title: 'Waiting for your code' })
  })
  it('says the phone is reading the SMS when it is listening for it', () => {
    expect(otpWaitStatus({ ...base, autoReading: true })).toEqual({ kind: 'waiting', title: 'Reading your SMS automatically' })
  })
  it('after the slow threshold it says so and tells where to look, still without blame', () => {
    expect(otpWaitStatus({ ...base, elapsedSec: OTP_SLOW_AFTER_SEC - 1 }).kind).toBe('waiting')
    const slow = otpWaitStatus({ ...base, elapsedSec: OTP_SLOW_AFTER_SEC })
    expect(slow.kind).toBe('slow')
    expect(slow).toMatchObject({ title: 'Taking longer than usual' })
    expect((slow as { hint: string }).hint).toMatch(/Spam or Blocked/)
  })
  it('the slow hint only mentions resending once Resend is available', () => {
    const early = otpWaitStatus({ ...base, elapsedSec: 20, canResend: false }) as { hint: string }
    expect(early.hint).not.toMatch(/resend/i)
    const late = otpWaitStatus({ ...base, elapsedSec: 41, canResend: true }) as { hint: string }
    expect(late.hint).toMatch(/resend the code/)
  })
  it('success, then verifying, then an error outrank everything below them', () => {
    expect(otpWaitStatus({ ...base, success: true, verifying: true, error: 'x', detected: true, typed: 6 })).toEqual({ kind: 'success', title: "You're in" })
    expect(otpWaitStatus({ ...base, verifying: true, error: 'x', detected: true, typed: 6 }).kind).toBe('verifying')
    expect(otpWaitStatus({ ...base, error: 'Incorrect code', elapsedSec: 40 })).toEqual({ kind: 'error', title: 'Incorrect code' })
  })
  it('a code read from the SMS shows as detected, whatever else is going on', () => {
    expect(otpWaitStatus({ ...base, detected: true })).toEqual({ kind: 'detected', title: 'Code detected' })
    expect(otpWaitStatus({ ...base, detected: true, elapsedSec: 40, typed: 6 }).kind).toBe('detected')
  })
  it('says nothing while the user is typing', () => {
    expect(otpWaitStatus({ ...base, typed: 1 })).toEqual({ kind: 'none' })
    expect(otpWaitStatus({ ...base, typed: 3, elapsedSec: 60 })).toEqual({ kind: 'none' })
  })
})
