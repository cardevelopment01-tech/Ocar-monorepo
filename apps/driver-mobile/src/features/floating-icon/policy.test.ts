import { describe, it, expect } from 'vitest'
import { shouldShowIcon, shouldAutoOpen, speedKmhFromMps, AUTO_OPEN_MAX_SPEED_KMH, SPEED_MAX_AGE_MS, type AutoOpenInputs } from './policy'

const base: AutoOpenInputs = {
  iconEnabled: true, hasPermission: true, isOnline: true, appState: 'background',
  autoOpenEnabled: true, hasActiveRide: false, speedKmh: 0, speedAgeMs: 1000,
}

describe('shouldShowIcon', () => {
  it('shows only for an online driver who has left Ocar, with the opt-in and the permission', () => {
    expect(shouldShowIcon(base)).toBe(true)
    expect(shouldShowIcon({ ...base, appState: 'inactive' })).toBe(true)
  })
  it.each([
    ['Ocar is in front', { appState: 'active' as const }],
    ['the driver is offline', { isOnline: false }],
    ['the permission is missing', { hasPermission: false }],
    ['the driver has not opted in', { iconEnabled: false }],
  ])('hides when %s', (_n, patch) => {
    expect(shouldShowIcon({ ...base, ...patch })).toBe(false)
  })
})

describe('shouldAutoOpen', () => {
  it('opens for a stationary online driver who opted in', () => {
    expect(shouldAutoOpen(base)).toBe(true)
  })
  it('opens right up to the speed limit and not beyond it', () => {
    expect(shouldAutoOpen({ ...base, speedKmh: AUTO_OPEN_MAX_SPEED_KMH })).toBe(true)
    expect(shouldAutoOpen({ ...base, speedKmh: AUTO_OPEN_MAX_SPEED_KMH + 0.1 })).toBe(false)
  })
  it('fails closed on every unknown', () => {
    expect(shouldAutoOpen({ ...base, speedKmh: null })).toBe(false)
    expect(shouldAutoOpen({ ...base, speedAgeMs: null })).toBe(false)
    expect(shouldAutoOpen({ ...base, speedAgeMs: SPEED_MAX_AGE_MS + 1 })).toBe(false)
    expect(shouldAutoOpen({ ...base, speedAgeMs: -5 })).toBe(false)
    expect(shouldAutoOpen({ ...base, speedKmh: Number.NaN })).toBe(false)
    expect(shouldAutoOpen({ ...base, speedKmh: -1 })).toBe(false)
  })
  it('never opens during an active ride, without the opt-in, or when the icon would not show', () => {
    expect(shouldAutoOpen({ ...base, hasActiveRide: true })).toBe(false)
    expect(shouldAutoOpen({ ...base, autoOpenEnabled: false })).toBe(false)
    expect(shouldAutoOpen({ ...base, appState: 'active' })).toBe(false)
    expect(shouldAutoOpen({ ...base, isOnline: false })).toBe(false)
    expect(shouldAutoOpen({ ...base, hasPermission: false })).toBe(false)
    expect(shouldAutoOpen({ ...base, iconEnabled: false })).toBe(false)
  })
})

describe('speedKmhFromMps', () => {
  it('converts metres per second to km/h', () => { expect(speedKmhFromMps(10)).toBeCloseTo(36) })
  it('treats a missing or invalid reading as unknown', () => {
    for (const v of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(speedKmhFromMps(v)).toBeNull()
  })
})
