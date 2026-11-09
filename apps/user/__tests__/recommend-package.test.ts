import { describe, it, expect } from 'vitest'
import { recommendPackage } from '../lib/recommend-package'
import type { RentalPackage } from '../lib/ride-api'

const pkg = (id: number, hrs: number, km: number, fare: number): RentalPackage => ({
  id, category_id: 1, category_name: 'Sedan', duration_minutes: hrs * 60, km_limit: km,
  package_fare: fare, extra_per_km: 12, extra_per_min: 2, is_active: true, city_id: null, city_name: null,
})
const PKGS = [pkg(1, 4, 40, 900), pkg(2, 8, 80, 1500), pkg(3, 12, 120, 2100)]

describe('recommendPackage', () => {
  it('picks the smallest package covering both distance and time', () => {
    expect(recommendPackage(PKGS, 35, 150)?.packageId).toBe(1)
    expect(recommendPackage(PKGS, 35, 300)?.packageId).toBe(2) // time forces the bigger one
    expect(recommendPackage(PKGS, 90, 100)?.packageId).toBe(3) // distance forces it
  })
  it('falls back to the largest with overage when nothing fits', () => {
    expect(recommendPackage(PKGS, 150, 800)).toEqual({ packageId: 3, exceeds: true, overKm: 28, overMin: 75 })
  })
  it('a route inside the grace still fits the largest package, so nothing is flagged as over', () => {
    expect(recommendPackage(PKGS, 121, 722)).toEqual({ packageId: 3, exceeds: false, overKm: 0, overMin: 0 })
    expect(recommendPackage(PKGS, 123, 700)).toMatchObject({ packageId: 3, exceeds: true, overKm: 1, overMin: 0 })
  })
  it('treats a route a little past a limit as fitting it, because the server bills only beyond limit + grace', () => {
    const small = [pkg(10, 1, 5, 100), pkg(11, 2, 10, 180)]
    expect(recommendPackage(small, 5.7, 30)?.packageId).toBe(10) // 5.7 km is "the same as 5 km": no extra charge
    expect(recommendPackage(small, 7, 30)?.packageId).toBe(10) // exactly limit + 2 km
    expect(recommendPackage(small, 7.1, 30)?.packageId).toBe(11) // past the grace: the bigger package
    expect(recommendPackage(small, 5, 65)?.packageId).toBe(10) // limit + 5 min
    expect(recommendPackage(small, 5, 66)?.packageId).toBe(11)
  })
  it('returns null with no packages', () => {
    expect(recommendPackage([], 10, 10)).toBeNull()
  })
})
