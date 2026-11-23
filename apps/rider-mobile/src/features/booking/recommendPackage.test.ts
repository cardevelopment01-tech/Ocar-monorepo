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

  it('flags overage against the largest package, in full', () => {
    // largest = 360 min / 60 km: all 10 km and 40 min past it count
    const r = recommendPackage(PACKAGES, 70, 400)
    expect(r).toEqual({ packageId: 4, exceeds: true, overKm: 10, overMin: 40 })
  })

  it('a route inside the fit tolerance still picks the largest package, and reports what it runs over', () => {
    expect(recommendPackage(PACKAGES, 61, 362)).toEqual({ packageId: 4, exceeds: false, overKm: 1, overMin: 2 })
  })

  it('flags "exceeds" only once the route is past the largest package AND the fit tolerance', () => {
    expect(recommendPackage(PACKAGES, 62.1, 300)).toEqual({ packageId: 4, exceeds: true, overKm: 3, overMin: 0 })
    expect(recommendPackage(PACKAGES, 40, 366)).toEqual({ packageId: 4, exceeds: true, overKm: 0, overMin: 6 })
  })

  it('treats a route a little past a limit as fitting it, so the rider pays the small extra instead of a dearer package', () => {
    const small = [pkg(10, 60, 5, 100), pkg(11, 120, 10, 180)]
    expect(recommendPackage(small, 5.7, 30)).toMatchObject({ packageId: 10, exceeds: false, overKm: 1 }) // the 0.7 km is still charged
    expect(recommendPackage(small, 7, 30)?.packageId).toBe(10) // exactly limit + 2 km
    expect(recommendPackage(small, 7.1, 30)?.packageId).toBe(11) // past the tolerance: the bigger package
  })

  it('applies the same tolerance to time', () => {
    const small = [pkg(10, 60, 40, 100), pkg(11, 120, 40, 180)]
    expect(recommendPackage(small, 10, 64)?.packageId).toBe(10)
    expect(recommendPackage(small, 10, 65)?.packageId).toBe(10) // limit + 5 min
    expect(recommendPackage(small, 10, 66)?.packageId).toBe(11)
  })
})

describe('estimateOverage', () => {
  const p = { kmLimit: 60, durationMinutes: 360, extraPerKm: 10, extraPerMin: 2 }
  it('is zero when the trip is within the package', () => {
    expect(estimateOverage(p, 43.3, 99)).toEqual({ overKm: 0, overMin: 0, extra: 0 })
    expect(estimateOverage(p, 60, 360)).toEqual({ overKm: 0, overMin: 0, extra: 0 })
  })
  it('prices every km and minute past the package, with no free allowance', () => {
    // 70 km: 70 - 60 = 10 over. 380 min: 380 - 360 = 20 over.
    expect(estimateOverage(p, 70, 380)).toEqual({ overKm: 10, overMin: 20, extra: 10 * 10 + 20 * 2 })
    // a slight overrun is charged too: 62 km on a 60 km package is 2 km extra
    expect(estimateOverage(p, 62, 365)).toEqual({ overKm: 2, overMin: 5, extra: 2 * 10 + 5 * 2 })
  })
  it('counts a started km or minute', () => {
    expect(estimateOverage(p, 62.1, 360)).toEqual({ overKm: 3, overMin: 0, extra: 30 })
  })
  it("matches a client's ride: 16.19 km on a 1 h / 10 km package is 6.19 km extra, not 4.19", () => {
    const hourly = { kmLimit: 10, durationMinutes: 60, extraPerKm: 16, extraPerMin: 2 }
    expect(estimateOverage(hourly, 16.19, 24)).toEqual({ overKm: 7, overMin: 0, extra: 112 }) // started km rounds up; the bill is 6.19 x 16 = 99
  })
})
