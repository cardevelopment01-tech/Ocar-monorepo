import { describe, it, expect } from 'vitest'
import type { RentalPackage } from '@ocar/mobile-shared'
import { recommendPackage } from './recommendPackage'

// Only the fields recommendPackage reads; the rest of RentalPackage is irrelevant here.
const pkg = (id: number, durationMinutes: number, kmLimit: number, packageFare: number) =>
  ({ id, durationMinutes, kmLimit, packageFare }) as unknown as RentalPackage

const PACKAGES = [
  pkg(1, 60, 10, 150),
  pkg(2, 120, 30, 280),
  pkg(3, 240, 40, 420),
  pkg(4, 360, 60, 600),
]

describe('recommendPackage', () => {
  it('returns null when there are no packages', () => {
    expect(recommendPackage([], 10, 20)).toBeNull()
  })

  it('picks the cheapest package that covers both distance and time', () => {
    // 26.8 km / 42 min needs the 120 min / 30 km package (the 1 hour one is too short)
    expect(recommendPackage(PACKAGES, 26.8, 42)).toEqual({ packageId: 2, exceeds: false, overKm: 0, overMin: 0 })
  })

  it('picks the smallest package for a short trip', () => {
    expect(recommendPackage(PACKAGES, 5, 20)?.packageId).toBe(1)
  })

  it('accepts a trip exactly at a package limit', () => {
    expect(recommendPackage(PACKAGES, 30, 120)?.packageId).toBe(2)
  })

  it('moves up a tier when only time exceeds the smaller package', () => {
    expect(recommendPackage(PACKAGES, 8, 90)?.packageId).toBe(2)
  })

  it('flags overage against the largest package, ignoring the grace', () => {
    // largest = 360 min / 60 km; grace is 2 km and 5 min
    const r = recommendPackage(PACKAGES, 70, 400)
    expect(r).toEqual({ packageId: 4, exceeds: true, overKm: 8, overMin: 35 })
  })

  it('does not charge inside the grace window', () => {
    const r = recommendPackage(PACKAGES, 61, 362)
    expect(r?.exceeds).toBe(true)
    expect(r?.overKm).toBe(0)
    expect(r?.overMin).toBe(0)
  })
})
