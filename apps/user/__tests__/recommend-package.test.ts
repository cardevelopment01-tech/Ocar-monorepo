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
    // within the grace, nothing is chargeable
    expect(recommendPackage(PKGS, 121, 722)).toMatchObject({ exceeds: true, overKm: 0, overMin: 0 })
  })
  it('returns null with no packages', () => {
    expect(recommendPackage([], 10, 10)).toBeNull()
  })
})
