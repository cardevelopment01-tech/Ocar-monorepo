import { describe, it, expect } from 'vitest'
import { estimateOverage, recommendPackage } from '../lib/recommend-package'
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
  it('falls back to the largest with the full overage when nothing fits', () => {
    expect(recommendPackage(PKGS, 150, 800)).toEqual({ packageId: 3, exceeds: true, overKm: 30, overMin: 80 })
  })
  it('a route inside the fit tolerance still picks the largest package, and reports what it runs over', () => {
    expect(recommendPackage(PKGS, 121, 722)).toEqual({ packageId: 3, exceeds: false, overKm: 1, overMin: 2 })
    expect(recommendPackage(PKGS, 123, 700)).toMatchObject({ packageId: 3, exceeds: true, overKm: 3, overMin: 0 })
  })
  it('treats a route a little past a limit as fitting it, so the rider pays the small extra instead of a dearer package', () => {
    const small = [pkg(10, 1, 5, 100), pkg(11, 2, 10, 180)]
    expect(recommendPackage(small, 5.7, 30)).toMatchObject({ packageId: 10, exceeds: false, overKm: 1 }) // the 0.7 km is still charged
    expect(recommendPackage(small, 7, 30)?.packageId).toBe(10) // exactly limit + 2 km
    expect(recommendPackage(small, 7.1, 30)?.packageId).toBe(11) // past the tolerance: the bigger package
    expect(recommendPackage(small, 5, 65)?.packageId).toBe(10) // limit + 5 min
    expect(recommendPackage(small, 5, 66)?.packageId).toBe(11)
  })
  it('returns null with no packages', () => {
    expect(recommendPackage([], 10, 10)).toBeNull()
  })
})

describe('estimateOverage', () => {
  const hourly = pkg(1, 1, 10, 415) // 1 h / 10 km, extra 12/km and 2/min
  it('is zero within the package', () => {
    expect(estimateOverage(hourly, 10, 60)).toEqual({ overKm: 0, overMin: 0, extra: 0 })
  })
  it('prices every km and minute past the package, with no free allowance', () => {
    expect(estimateOverage(hourly, 12, 65)).toEqual({ overKm: 2, overMin: 5, extra: 2 * 12 + 5 * 2 })
  })
  it("matches a client's ride: 16.19 km on a 1 h / 10 km package is 6.19 km extra, not 4.19", () => {
    expect(estimateOverage(hourly, 16.19, 24)).toEqual({ overKm: 7, overMin: 0, extra: 84 }) // started km rounds up; the bill is 6.19 km exactly
  })
})
