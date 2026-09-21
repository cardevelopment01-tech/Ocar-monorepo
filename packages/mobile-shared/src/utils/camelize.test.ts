import { describe, expect, it } from 'vitest'
import { camelizeKeys } from './camelize'

describe('camelizeKeys', () => {
  it('converts snake_case keys to camelCase, recursively', () => {
    expect(camelizeKeys({ origin_lat: 1, driver_name: 'x', nested: { total_estimated: '5' } })).toEqual({
      originLat: 1,
      driverName: 'x',
      nested: { totalEstimated: '5' },
    })
  })

  it('handles arrays and primitives untouched', () => {
    expect(camelizeKeys([{ stop_charge_applied: '1' }])).toEqual([{ stopChargeApplied: '1' }])
    expect(camelizeKeys(5)).toBe(5)
    expect(camelizeKeys(null)).toBe(null)
  })
})
