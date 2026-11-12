import { describe, it, expect } from 'vitest'
import { maxPickupRadiusMetres, BROADCAST_ROUND_STEP_METRES } from '@/constants/limits'

describe('maxPickupRadiusMetres: city ride', () => {
  it('is 4 km for a car and 2 km for an auto in round 1', () => {
    expect(maxPickupRadiusMetres('one_way', 'sedan', undefined, 1, 'city')).toBe(4_000)
    expect(maxPickupRadiusMetres('one_way', 'auto_rickshaw', undefined, 1, 'city')).toBe(2_000)
  })

  it('widens by the same step each round, like every other ride', () => {
    expect(maxPickupRadiusMetres('one_way', 'sedan', undefined, 3, 'city')).toBe(4_000 + 2 * BROADCAST_ROUND_STEP_METRES)
    expect(maxPickupRadiusMetres('one_way', 'auto_rickshaw', undefined, 3, 'city')).toBe(2_000 + 2 * BROADCAST_ROUND_STEP_METRES)
  })

  it('leaves every existing answer unchanged when no trip mode is given or it is standard', () => {
    expect(maxPickupRadiusMetres('one_way', null)).toBe(10_000)
    expect(maxPickupRadiusMetres('one_way', 'sedan', undefined, 2, 'standard')).toBe(11_000)
    expect(maxPickupRadiusMetres('round_trip', 'sedan')).toBe(10_000)
    expect(maxPickupRadiusMetres('rental', 'auto_rickshaw')).toBe(2_000)
    expect(maxPickupRadiusMetres('rental', 'sedan', 4)).toBe(4_000)
  })
})
