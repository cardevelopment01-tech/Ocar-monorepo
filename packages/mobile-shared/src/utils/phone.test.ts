import { describe, expect, it } from 'vitest'
import { formatPhoneDisplay, normalizeIndianPhoneInput } from './phone'

// Value: protects=a pasted number lands as the right ten digits (never a wrong or truncated one that would text a stranger);
// fails_when=a +91 or 0 prefix is kept, or a ten digit number starting 91 loses its first digits; why_new=login phone field;
// seam=pure functions; no_claim=how the field looks.
describe('normalizeIndianPhoneInput', () => {
  it('keeps plain digits', () => { expect(normalizeIndianPhoneInput('9876543210')).toBe('9876543210') })
  it('strips spaces and punctuation', () => { expect(normalizeIndianPhoneInput('98765 43210')).toBe('9876543210') })
  it('drops a pasted +91', () => { expect(normalizeIndianPhoneInput('+91 98765 43210')).toBe('9876543210') })
  it('drops a leading 0', () => { expect(normalizeIndianPhoneInput('098765 43210')).toBe('9876543210') })
  it('a ten digit number that starts with 91 is left alone', () => { expect(normalizeIndianPhoneInput('9198765432')).toBe('9198765432') })
  it('never returns more than ten digits', () => { expect(normalizeIndianPhoneInput('987654321012345')).toBe('9876543210') })
  it('empty stays empty', () => { expect(normalizeIndianPhoneInput('')).toBe('') })
})

describe('formatPhoneDisplay', () => {
  it('groups five and five', () => { expect(formatPhoneDisplay('9876543210')).toBe('98765 43210') })
  it('leaves five or fewer digits alone', () => { expect(formatPhoneDisplay('98765')).toBe('98765'); expect(formatPhoneDisplay('98')).toBe('98') })
  it('a partial second group', () => { expect(formatPhoneDisplay('987654')).toBe('98765 4') })
})
