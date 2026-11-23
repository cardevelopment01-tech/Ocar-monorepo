import { describe, expect, it } from 'vitest'
import { formatNearestKm } from './eta'

describe('formatNearestKm', () => {
  it('metres to the nearest 100 under a kilometre, never "0 m" or "1000 m"', () => {
    expect(formatNearestKm(0.02)).toBe('100 m')
    expect(formatNearestKm(0.34)).toBe('300 m')
    expect(formatNearestKm(0.96)).toBe('1.0 km')
  })
  it('kilometres with one decimal from 1 km', () => {
    expect(formatNearestKm(1)).toBe('1.0 km')
    expect(formatNearestKm(3.14)).toBe('3.1 km')
  })
})
