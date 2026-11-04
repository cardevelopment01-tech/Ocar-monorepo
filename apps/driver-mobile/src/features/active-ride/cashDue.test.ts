import { describe, expect, it } from 'vitest'
import { cashDueOf, riderOfferDiscount } from './cashDue'

describe('cashDueOf', () => {
  it('uses the server cash_due when present', () => {
    expect(cashDueOf({ cashDue: '363.00', totalFinal: '454.00', totalEstimated: '454.00' })).toBe(363)
  })
  it('falls back to the final fare, then the estimate, when an older server sends no cash_due', () => {
    expect(cashDueOf({ totalFinal: '454.00', totalEstimated: '430.00' })).toBe(454)
    expect(cashDueOf({ cashDue: null, totalFinal: null, totalEstimated: '430.00' })).toBe(430)
  })
  it('is 0 when nothing is known, and ignores a non-numeric value', () => {
    expect(cashDueOf({})).toBe(0)
    expect(cashDueOf({ cashDue: 'abc', totalEstimated: '430.00' })).toBe(430)
  })
})

describe('riderOfferDiscount', () => {
  it('is the discount only when positive', () => {
    expect(riderOfferDiscount({ discountAmount: '91.00' })).toBe(91)
    expect(riderOfferDiscount({ discountAmount: '0' })).toBe(0)
    expect(riderOfferDiscount({ discountAmount: null })).toBe(0)
    expect(riderOfferDiscount({})).toBe(0)
  })
})
