import { describe, it, expect } from 'vitest'
import { EMPTY_FORM, audienceReady, buildAudience, describeAudience, normalizeIndianPhone, parsePhones, type AudienceForm } from '../audience'

// Value: protects=what the admin sets up in the form is exactly the audience the API receives, typed phone numbers are cleaned and checked
// before anything is sent, and the history describes each audience in words an admin recognises; fails_when=a filter is dropped or leaks
// across roles, a bad or duplicate number gets through, or the label names the wrong city; why_new=the old page had three fixed audiences;
// seam=none (pure functions); no_claim=what the API does with the audience (api tests).

const names = { cities: new Map([[1, 'Bhubaneswar'], [2, 'Cuttack']]), categories: new Map([[3, 'SUV'], [4, 'Luxury SUV']]) }
const form = (over: Partial<AudienceForm> = {}): AudienceForm => ({ ...EMPTY_FORM, ...over })

describe('normalizeIndianPhone', () => {
  it('accepts the usual ways of writing a mobile number, and nothing else', () => {
    for (const p of ['9861003979', '98610 03979', '+919861003979', '919861003979', '+91 98610-03979']) expect(normalizeIndianPhone(p)).toBe('+919861003979')
    for (const p of ['', '12345', '5861003979', '+14155550123', '98610039799']) expect(normalizeIndianPhone(p)).toBeNull()
  })
})

describe('parsePhones', () => {
  it('splits on lines, commas and semicolons, keeps spaces inside a number, and drops duplicates', () => {
    const out = parsePhones('98610 03979\n+91 80936 30642, 9861003979; 98610 03979')
    expect(out.valid).toEqual(['+919861003979', '+918093630642'])
    expect(out.invalid).toEqual([])
  })
  it('reports what it could not read, as typed', () => {
    expect(parsePhones('9861003979, 12345\nabc')).toEqual({ valid: ['+919861003979'], invalid: ['12345', 'abc'] })
  })
  it('empty text gives nothing', () => expect(parsePhones('  \n ')).toEqual({ valid: [], invalid: [] }))
})

describe('buildAudience', () => {
  it('all drivers and all riders send no filters at all', () => {
    expect(buildAudience(form())).toEqual({ role: 'driver' })
    expect(buildAudience(form({ role: 'rider' }))).toEqual({ role: 'rider' })
  })
  it('driver filters become numbers and flags, and only the ones set', () => {
    expect(buildAudience(form({ cityIds: ['1', '2'], categoryIds: ['3'], docIssues: true }))).toEqual({ role: 'driver', cityIds: [1, 2], categoryIds: [3], docIssues: true })
    expect(buildAudience(form({ missingRcBack: true }))).toEqual({ role: 'driver', missingRcBack: true })
  })
  it('the rider booking window is a number, and driver filters never leak onto riders', () => {
    expect(buildAudience(form({ role: 'rider', bookedInLastDays: '30', cityIds: ['1'], docIssues: true }))).toEqual({ role: 'rider', bookedInLastDays: 30 })
  })
  it('phone mode sends only the valid numbers and ignores every other filter', () => {
    expect(buildAudience(form({ usePhones: true, phonesText: '98610 03979, nope', cityIds: ['1'], docIssues: true }))).toEqual({ role: 'driver', phones: ['+919861003979'] })
  })
})

describe('audienceReady', () => {
  it('filters are always ready', () => expect(audienceReady(form({ docIssues: true }))).toBe(true))
  it('phone mode needs at least one number, all of them readable, and no more than ten', () => {
    expect(audienceReady(form({ usePhones: true, phonesText: '' }))).toBe(false)
    expect(audienceReady(form({ usePhones: true, phonesText: '9861003979' }))).toBe(true)
    expect(audienceReady(form({ usePhones: true, phonesText: '9861003979, 12345' }))).toBe(false)
    const eleven = Array.from({ length: 11 }, (_, i) => `98610${String(i).padStart(5, '0')}`).join('\n')
    expect(audienceReady(form({ usePhones: true, phonesText: eleven }))).toBe(false)
  })
})

describe('describeAudience', () => {
  it('says "All drivers" / "All riders" with no filters', () => {
    expect(describeAudience({ role: 'driver' }, names)).toBe('All drivers')
    expect(describeAudience({ role: 'rider' }, names)).toBe('All riders')
  })
  it('names the cities and vehicle types, and the document filters', () => {
    expect(describeAudience({ role: 'driver', cityIds: [1, 2], categoryIds: [4], docIssues: true }, names)).toBe('Drivers · Bhubaneswar, Cuttack · Luxury SUV · blocked by documents')
    expect(describeAudience({ role: 'driver', missingRcBack: true }, names)).toBe('Drivers · missing the RC back')
  })
  it('falls back to the id when a name is not known yet', () => {
    expect(describeAudience({ role: 'driver', cityIds: [9] }, names)).toBe('Drivers · City 9')
  })
  it('riders who booked recently', () => {
    expect(describeAudience({ role: 'rider', bookedInLastDays: 30 }, names)).toBe('Riders · booked in the last 30 days')
  })
  it('phone numbers are shown as a count, never the numbers', () => {
    expect(describeAudience({ role: 'driver', phoneCount: 1 }, names)).toBe('1 phone number (drivers)')
    expect(describeAudience({ role: 'rider', phoneCount: 3 }, names)).toBe('3 phone numbers (riders)')
  })
})

describe('incomplete KYC audience', () => {
  it('is its own audience: nothing else is sent with it, and it is described in words', () => {
    expect(buildAudience(form({ incompleteKyc: true, cityIds: ['1'], docIssues: true }))).toEqual({ role: 'driver', incompleteKyc: true })
    expect(describeAudience({ role: 'driver', incompleteKyc: true }, { cities: new Map(), categories: new Map() })).toBe('Drivers · not finished verification')
  })
})
