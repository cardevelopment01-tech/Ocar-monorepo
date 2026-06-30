import { describe, it, expect } from 'vitest'
import { clampTripHours } from '@/modules/pricing/pricing.service'

describe('clampTripHours', () => {
  describe('round_trip enforcement', () => {
    it('undefined defaults to minimum 4h', () => {
      expect(clampTripHours('round_trip', undefined)).toBe(4)
    })

    it('0 is raised to minimum 4h', () => {
      expect(clampTripHours('round_trip', 0)).toBe(4)
    })

    it('value below 4 is raised to 4', () => {
      expect(clampTripHours('round_trip', 2)).toBe(4)
      expect(clampTripHours('round_trip', 3.9)).toBe(4)
    })

    it('exactly 4 stays at 4', () => {
      expect(clampTripHours('round_trip', 4)).toBe(4)
    })

    it('value above 4 is passed through ceiled', () => {
      expect(clampTripHours('round_trip', 6)).toBe(6)
      expect(clampTripHours('round_trip', 8)).toBe(8)
    })

    it('fractional hours are ceiling-rounded up', () => {
      expect(clampTripHours('round_trip', 4.1)).toBe(5)
      expect(clampTripHours('round_trip', 5.5)).toBe(6)
      expect(clampTripHours('round_trip', 7.9)).toBe(8)
    })

    it('fractional below 4 after ceiling still clamps to 4', () => {
      // ceil(3.2) = 4 → max(4, 4) = 4
      expect(clampTripHours('round_trip', 3.2)).toBe(4)
      // ceil(1.1) = 2 → max(4, 2) = 4
      expect(clampTripHours('round_trip', 1.1)).toBe(4)
    })
  })

  describe('non-round_trip rides are unchanged', () => {
    it('one_way with undefined returns 0', () => {
      expect(clampTripHours('one_way', undefined)).toBe(0)
    })

    it('one_way with a value passes through unchanged', () => {
      expect(clampTripHours('one_way', 2)).toBe(2)
    })

    it('rental with undefined returns 0', () => {
      expect(clampTripHours('rental', undefined)).toBe(0)
    })

    it('rental with a value passes through unchanged', () => {
      expect(clampTripHours('rental', 4)).toBe(4)
    })
  })
})
