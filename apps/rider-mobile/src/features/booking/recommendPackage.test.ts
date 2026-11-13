import { describe, it, expect } from 'vitest'
import type { RentalPackage } from '@ocar/mobile-shared'
import { estimateOverage, recommendPackage } from './recommendPackage'

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

  it('a route inside the grace still fits the largest package, so nothing is flagged as over', () => {
    expect(recommendPackage(PACKAGES, 61, 362)).toEqual({ packageId: 4, exceeds: false, overKm: 0, overMin: 0 })
  })

  it('flags overage only once the route is past the largest package AND its grace', () => {
    expect(recommendPackage(PACKAGES, 62.1, 300)).toEqual({ packageId: 4, exceeds: true, overKm: 1, overMin: 0 })
    expect(recommendPackage(PACKAGES, 40, 366)).toEqual({ packageId: 4, exceeds: true, overKm: 0, overMin: 1 })
  })

  it('treats a route a little past a limit as fitting it, because the server bills only beyond limit + grace', () => {
    const small = [pkg(10, 60, 5, 100), pkg(11, 120, 10, 180)]
    expect(recommendPackage(small, 5.7, 30)?.packageId).toBe(10) // 5.7 km is "the same as 5 km": no extra charge
    expect(recommendPackage(small, 7, 30)?.packageId).toBe(10) // exactly limit + 2 km
    expect(recommendPackage(small, 7.1, 30)?.packageId).toBe(11) // past the grace: the bigger package
  })

  it('applies the same grace to time', () => {
    const small = [pkg(10, 60, 40, 100), pkg(11, 120, 40, 180)]
    expect(recommendPackage(small, 10, 64)?.packageId).toBe(10)
    expect(recommendPackage(small, 10, 65)?.packageId).toBe(10) // limit + 5 min
    expect(recommendPackage(small, 10, 66)?.packageId).toBe(11)
  })
})

describe('estimateOverage', () => {
  const p = { kmLimit: 60, durationMinutes: 360, extraPerKm: 10, extraPerMin: 2 }
  it('is zero when the trip fits, grace included', () => {
    expect(estimateOverage(p, 43.3, 99)).toEqual({ overKm: 0, overMin: 0, extra: 0 })
    expect(estimateOverage(p, 62, 365)).toEqual({ overKm: 0, overMin: 0, extra: 0 })
  })
  it('prices km and minutes past limit plus grace', () => {
    // 70 km: 70 - 60 - 2 = 8 over. 380 min: 380 - 360 - 5 = 15 over.
    expect(estimateOverage(p, 70, 380)).toEqual({ overKm: 8, overMin: 15, extra: 8 * 10 + 15 * 2 })
  })
  it('counts a started km or minute', () => {
    expect(estimateOverage(p, 62.1, 360)).toEqual({ overKm: 1, overMin: 0, extra: 10 })
  })
})
