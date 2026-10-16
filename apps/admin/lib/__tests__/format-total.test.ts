import { describe, it, expect } from 'vitest'
import { formatTotal, hasNextPage } from '../format-total'

describe('formatTotal', () => {
  it('formats exact totals with Indian grouping and no plus', () => {
    expect(formatTotal(1234, false)).toBe('1,234')
    expect(formatTotal(0, false)).toBe('0')
  })
  it('adds a plus when capped', () => {
    expect(formatTotal(10000, true)).toBe('10,000+')
  })
})

describe('hasNextPage', () => {
  it('uses the page count when the total is exact', () => {
    expect(hasNextPage({ page: 2, pages: 3, capped: false, rowsOnPage: 20, limit: 20 })).toBe(true)
    expect(hasNextPage({ page: 3, pages: 3, capped: false, rowsOnPage: 5, limit: 20 })).toBe(false)
  })
  it('keeps paging past the cap while pages come back full', () => {
    expect(hasNextPage({ page: 500, pages: 500, capped: true, rowsOnPage: 20, limit: 20 })).toBe(true)
    expect(hasNextPage({ page: 731, pages: 500, capped: true, rowsOnPage: 8, limit: 20 })).toBe(false)
  })
})
