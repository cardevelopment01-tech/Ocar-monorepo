import { describe, expect, it } from 'vitest'
import { hasAtMostPaise, validateTierFields, valueMultiple } from '@/modules/packages/package-tier-rules'

// Value: protects=an admin cannot save a ride-credit plan that breaks drivers' purchases or the books (a name the column cannot hold, a price
// the database would silently round or overflow, a plan worth less than its price); fails_when=a 101-character name reaches the database and
// returns a 500, a price of 40.123 is stored as 40.12 while the preview showed 40.123, or a plan that costs ₹550 and gives ₹40 is saved;
// why_new=plans now carry GST, validity and a vehicle group, so a bad plan is expensive to undo once drivers have bought it; seam=none (pure
// rules); no_claim=the HTTP layer or the admin page.

const good = { label: 'Starter', price: 40, thresholdValue: 550, validityDays: 365 }

describe('validateTierFields', () => {
  it('accepts every plan on the client sheet', () => {
    for (const [price, value] of [[40, 550], [70, 1050], [250, 5500], [500, 10500], [800, 20000], [15, 500], [30, 1000], [100, 3500]] as const) {
      expect(validateTierFields({ ...good, price, thresholdValue: value })).toBeNull()
    }
  })
  it('needs a name, trimmed, within the column', () => {
    expect(validateTierFields({ ...good, label: '   ' })).toMatch(/name/i)
    expect(validateTierFields({ ...good, label: 'x'.repeat(101) })).toMatch(/at most 100/)
    expect(validateTierFields({ ...good, label: 'x'.repeat(100) })).toBeNull()
    expect(validateTierFields({ ...good, label: '  Starter  ' })).toBeNull()
  })
  it('refuses a price that is zero, negative, not a number or too large', () => {
    for (const price of [0, -5, NaN, Infinity]) expect(validateTierFields({ ...good, price })).toMatch(/price above zero/)
    expect(validateTierFields({ ...good, price: 10_000_001, thresholdValue: 20_000_000 })).toMatch(/too large/)
  })
  it('refuses more than two decimal places instead of letting the database round them', () => {
    expect(validateTierFields({ ...good, price: 40.123 })).toMatch(/two decimal/)
    expect(validateTierFields({ ...good, thresholdValue: 550.005 })).toMatch(/two decimal/)
    expect(validateTierFields({ ...good, price: 40.1, thresholdValue: 550.25 })).toBeNull()
  })
  it('refuses a plan worth less than its price, but allows one that is exactly its price', () => {
    expect(validateTierFields({ ...good, price: 550, thresholdValue: 40 })).toMatch(/at least the price/)
    expect(validateTierFields({ ...good, price: 100, thresholdValue: 100 })).toBeNull()
  })
  it('validity is whole days from 1 to 3650', () => {
    for (const validityDays of [0, -1, 3651, 1.5, NaN]) expect(validateTierFields({ ...good, validityDays })).toMatch(/Validity/)
    expect(validateTierFields({ ...good, validityDays: 1 })).toBeNull()
    expect(validateTierFields({ ...good, validityDays: 3650 })).toBeNull()
  })
})

describe('hasAtMostPaise', () => {
  it('copes with floating point: 0.1 + 0.2 and 1.15 are still two-decimal amounts', () => {
    expect(hasAtMostPaise(0.1 + 0.2)).toBe(true)
    expect(hasAtMostPaise(1.15)).toBe(true)
    expect(hasAtMostPaise(19.99)).toBe(true)
    expect(hasAtMostPaise(0.001)).toBe(false)
  })
})

describe('valueMultiple', () => {
  it('is ride value per rupee of price, and shows the client sheet dip at ₹500', () => {
    expect(valueMultiple(250, 5500)).toBe(22)
    expect(valueMultiple(500, 10500)).toBe(21) // worse than the cheaper ₹250 plan: the admin page flags this
    expect(valueMultiple(800, 20000)).toBe(25)
    expect(valueMultiple(0, 100)).toBe(0)
  })
})
