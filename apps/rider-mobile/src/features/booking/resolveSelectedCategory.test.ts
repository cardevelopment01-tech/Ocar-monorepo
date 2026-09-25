import { describe, it, expect } from 'vitest'
import { resolveSelectedCategory } from './resolveSelectedCategory'

describe('resolveSelectedCategory', () => {
  it('keeps the stored pick while it is still visible', () => {
    expect(resolveSelectedCategory([1, 2, 3], 2)).toBe(2)
  })
  it('falls back to the first visible card when the stored pick is hidden (one-way -> round-trip)', () => {
    expect(resolveSelectedCategory([1, 3], 2)).toBe(1)
  })
  it('defaults to the first visible card with no stored pick', () => {
    expect(resolveSelectedCategory([4, 5], null)).toBe(4)
  })
  it('returns null when nothing is visible', () => {
    expect(resolveSelectedCategory([], 2)).toBeNull()
    expect(resolveSelectedCategory([], null)).toBeNull()
  })
})
