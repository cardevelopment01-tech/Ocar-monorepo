import { describe, it, expect } from 'vitest'
import { lateCancelFee, feeExample, fmtMinutes, policyChanges, policyProblem, samePolicy, type AdvancePolicy, type PolicyLimits } from '../advance-policy-model'

const base: AdvancePolicy = { lateCancelEnabled: true, lateCancelWindowMin: 60, feeMode: 'percent', feePercent: 10, feeCap: 100, feeFlat: 50, rescheduleMax: 3, searchGraceMin: 10 }

// The same cases as api/tests/unit/rides/advance-policy.test.ts: the admin's example must equal what a rider is charged.
describe('lateCancelFee (mirror of the API)', () => {
  it('is zero while off', () => { expect(lateCancelFee({ ...base, lateCancelEnabled: false }, 1850)).toBe(0) })
  it('percent mode: share of the fare, capped', () => {
    expect(lateCancelFee(base, 600)).toBe(60)
    expect(lateCancelFee(base, 1850)).toBe(100)
  })
  it('no cap when the cap is 0', () => { expect(lateCancelFee({ ...base, feeCap: 0 }, 1850)).toBe(185) })
  it('flat mode ignores percent and cap, and never exceeds the fare', () => {
    expect(lateCancelFee({ ...base, feeMode: 'flat', feeFlat: 75 }, 1850)).toBe(75)
    expect(lateCancelFee({ ...base, feeMode: 'flat', feeFlat: 500 }, 120)).toBe(120)
  })
  it('rounds to paise', () => { expect(lateCancelFee({ ...base, feePercent: 3.333, feeCap: 0 }, 100)).toBe(3.33) })
})

describe('feeExample', () => {
  it('says there is no fee when off', () => { expect(feeExample({ ...base, lateCancelEnabled: false })).toMatch(/^No fee/) })
  it('shows the rule on a real fare with the capped amount', () => {
    const s = feeExample(base)
    expect(s).toContain('₹1,850')
    expect(s).toContain('within 1 hour')
    expect(s).toContain('costs ₹100')
    expect(s).toContain('10% of the fare, up to ₹100')
    expect(s).toContain('before a driver accepts, is free')
  })
  it('describes flat mode', () => { expect(feeExample({ ...base, feeMode: 'flat', feeFlat: 75 })).toContain('a flat ₹75') })
})

describe('fmtMinutes', () => {
  it.each([[1, '1 minute'], [45, '45 minutes'], [60, '1 hour'], [90, '1 hour 30 minutes'], [120, '2 hours']])('%i -> %s', (m, out) => { expect(fmtMinutes(m)).toBe(out) })
})

describe('policyChanges', () => {
  it('sends only what changed, and nothing when nothing did', () => {
    expect(policyChanges(base, { ...base, feePercent: 12, searchGraceMin: 20 })).toEqual({ feePercent: 12, searchGraceMin: 20 })
    expect(policyChanges(base, { ...base })).toEqual({})
    expect(samePolicy(base, { ...base })).toBe(true)
    expect(samePolicy(base, { ...base, feeMode: 'flat' })).toBe(false)
  })
})

describe('policyProblem', () => {
  const lim = (min: number, max: number) => ({ min, max })
  const limits = { lateCancelEnabled: lim(0, 0), lateCancelWindowMin: lim(0, 1440), feeMode: lim(0, 0), feePercent: lim(0, 100), feeCap: lim(0, 5000), feeFlat: lim(0, 5000), rescheduleMax: lim(0, 10), searchGraceMin: lim(0, 60) } as unknown as PolicyLimits
  it('passes a valid draft, and passes when limits are not loaded yet', () => {
    expect(policyProblem(base, limits)).toBeNull()
    expect(policyProblem(base, null)).toBeNull()
  })
  it.each([
    [{ feePercent: 101 }, /percentage cannot be above 100/],
    [{ feeFlat: -1 }, /flat fee cannot be below 0/],
    [{ lateCancelWindowMin: 30.5 }, /window must be a whole number/],
    [{ rescheduleMax: 11 }, /reschedule limit cannot be above 10/],
    [{ feeCap: Number.NaN }, /cap must be a number/],
  ])('refuses %j', (over, msg) => { expect(policyProblem({ ...base, ...over }, limits)).toMatch(msg) })
})
