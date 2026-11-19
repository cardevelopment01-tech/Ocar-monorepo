import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { AT_PICKUP_M, LEFT_PICKUP_M, ageEta, driverAtPickup, formatEta, statusShowsEta } from './eta'

describe('formatEta', () => {
  it('never shows 0 min', () => {
    expect(formatEta(0, 0.4).time).toBe('1 min')
    expect(formatEta(0.4, 0.1).time).toBe('1 min')
    expect(formatEta(11, 4.2).time).toBe('11 min')
  })
  it('formats hours', () => {
    expect(formatEta(60, 30).time).toBe('1 h')
    expect(formatEta(65, 30).time).toBe('1 h 5 min')
  })
  it('reads short distances in metres, longer in km', () => {
    expect(formatEta(1, 0.02).distance).toBe('<50 m')
    expect(formatEta(1, 0.147).distance).toBe('150 m')
    expect(formatEta(1, 0.999).distance).toBe('1.0 km')
    expect(formatEta(11, 4.24).distance).toBe('4.2 km')
  })
})

describe('statusShowsEta', () => {
  it('shows on the pickup and trip legs only', () => {
    expect(['accepted', 'in_progress', 'returning'].every(statusShowsEta)).toBe(true)
    expect(['requested', 'driver_arrived', 'completed', 'cancelled'].some(statusShowsEta)).toBe(false)
  })
})

describe('driverAtPickup', () => {
  it('holds "here" out to LEFT_PICKUP_M once it is showing, so it does not flicker at the edge', () => {
    expect(driverAtPickup('accepted', AT_PICKUP_M + 20, false)).toBe(false)
    expect(driverAtPickup('accepted', AT_PICKUP_M + 20, true)).toBe(true)
    expect(driverAtPickup('accepted', LEFT_PICKUP_M + 1, true)).toBe(false)
  })
  it('matches the radius the driver app uses to prompt "mark arrived"', () => {
    const src = readFileSync(new URL('../../../apps/driver-mobile/src/features/active-ride/geo.ts', import.meta.url), 'utf8')
    expect(Number(/export const AT_PICKUP_M = (\d+)/.exec(src)?.[1])).toBe(AT_PICKUP_M)
  })
  it('is true only on the way to the pickup and within the radius', () => {
    expect(driverAtPickup('accepted', AT_PICKUP_M)).toBe(true)
    expect(driverAtPickup('accepted', AT_PICKUP_M + 1)).toBe(false)
    expect(driverAtPickup('in_progress', 10)).toBe(false)
    expect(driverAtPickup('driver_arrived', 10)).toBe(false)
  })
  it('is false when the driver position is unknown', () => {
    expect(driverAtPickup('accepted', null)).toBe(false)
    expect(driverAtPickup('accepted', undefined)).toBe(false)
  })
})

describe('ageEta', () => {
  it('counts the ETA and distance down by elapsed time', () => {
    const a = ageEta({ etaMin: 4, distanceKm: 2 }, 120_000)
    expect(a.etaMin).toBe(2)
    expect(a.distanceKm).toBeCloseTo(1, 5)
  })
  it('never goes negative and ignores a clock that ran backwards', () => {
    expect(ageEta({ etaMin: 1, distanceKm: 0.5 }, 600_000)).toEqual({ etaMin: 0, distanceKm: 0 })
    expect(ageEta({ etaMin: 3, distanceKm: 1 }, -5000)).toEqual({ etaMin: 3, distanceKm: 1 })
  })
})
