import { describe, it, expect } from 'vitest'
import { getConfigBounds, validateConfigBounds } from '@/lib/system-config-bounds'

describe('validateConfigBounds', () => {
  it('accepts values inside the range, including the edges', () => {
    expect(validateConfigBounds('commission_percent', '15')).toBeNull()
    expect(validateConfigBounds('commission_percent', '0')).toBeNull()
    expect(validateConfigBounds('commission_percent', '50')).toBeNull()
  })
  it('rejects a typo that would parse fine as a number', () => {
    expect(validateConfigBounds('commission_percent', '1500')).toMatch(/between 0 and 50/)
    expect(validateConfigBounds('commission_percent', '-1')).toMatch(/between 0 and 50/)
  })
  it('allows the negative driver_minimum_balance ops uses to disable the recharge gate', () => {
    expect(validateConfigBounds('driver_minimum_balance', '-999999')).toBeNull()
    expect(validateConfigBounds('driver_minimum_balance', '-2000000')).not.toBeNull()
  })
  it('treats string-typed booleans as true/false only', () => {
    expect(validateConfigBounds('cash_collection_enabled', 'true')).toBeNull()
    expect(validateConfigBounds('cash_collection_enabled', 'maybe')).toMatch(/one of: true, false/)
  })
  it('leaves unlisted keys unbounded', () => {
    expect(getConfigBounds('some_future_key')).toBeNull()
    expect(validateConfigBounds('some_future_key', 'anything')).toBeNull()
  })
  it('rejects non-numeric input on a bounded key', () => {
    expect(validateConfigBounds('cash_collection_tolerance', 'abc')).toMatch(/number/)
  })
})
