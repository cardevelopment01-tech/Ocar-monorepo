import { describe, expect, it } from 'vitest'
import {
  a11yLabelFor,
  ageBucket,
  cameraMode,
  freshnessOf,
  isFresh,
  movedBeyondGeocodeReuse,
  partializeLocation,
  pickBest,
  pillTextFor,
  type Fix,
} from './locationPolicy'

const NOW = 1_800_000_000_000
const MIN = 60_000
const fix = (ageMs: number, source: Fix['source'] = 'cache'): Fix => ({ lat: 20.29, lng: 85.82, fixedAt: NOW - ageMs, source })

describe('pickBest', () => {
  it('returns the only fix available', () => {
    expect(pickBest(null, null, NOW)).toBeNull()
    const a = fix(10 * MIN)
    expect(pickBest(a, null, NOW)).toBe(a)
    expect(pickBest(null, a, NOW)).toBe(a)
  })
  it('a newer OS fix replaces the cache', () => {
    const cache = fix(20 * MIN, 'cache')
    const os = fix(5 * MIN, 'os')
    expect(pickBest(cache, os, NOW)).toBe(os)
  })
  it('an older incoming fix never replaces a newer one', () => {
    const gps = fix(1000, 'gps')
    const oldOs = fix(10 * MIN, 'os')
    expect(pickBest(gps, oldOs, NOW)).toBe(gps)
  })
  it('equal timestamps prefer the better source', () => {
    const cache = fix(MIN, 'cache')
    const gps = fix(MIN, 'gps')
    expect(pickBest(cache, gps, NOW)).toBe(gps)
    expect(pickBest(gps, cache, NOW)).toBe(gps)
  })
  it('a future timestamp never wins', () => {
    const real = fix(10 * MIN, 'os')
    const future = { ...fix(0, 'gps'), fixedAt: NOW + 5 * MIN }
    expect(pickBest(real, future, NOW)).toBe(real)
  })
})

describe('isFresh', () => {
  it('a gps fix is fresh regardless of age', () => expect(isFresh(fix(3 * 60 * MIN, 'gps'), NOW)).toBe(true))
  it('cache/os are fresh only under 2 minutes', () => {
    expect(isFresh(fix(119_000, 'cache'), NOW)).toBe(true)
    expect(isFresh(fix(120_000, 'cache'), NOW)).toBe(false)
    expect(isFresh(fix(121_000, 'os'), NOW)).toBe(false)
  })
  it('no fix is not fresh; a future timestamp is not fresh', () => {
    expect(isFresh(null, NOW)).toBe(false)
    expect(isFresh({ ...fix(0, 'cache'), fixedAt: NOW + MIN }, NOW)).toBe(false)
  })
})

describe('ageBucket', () => {
  it('splits at 2 and 30 minutes', () => {
    expect(ageBucket(NOW - (2 * MIN - 1), NOW)).toBe('live')
    expect(ageBucket(NOW - 2 * MIN, NOW)).toBe('recent')
    expect(ageBucket(NOW - (30 * MIN - 1), NOW)).toBe('recent')
    expect(ageBucket(NOW - 30 * MIN, NOW)).toBe('old')
  })
  it('a future timestamp is old', () => expect(ageBucket(NOW + MIN, NOW)).toBe('old'))
})

describe('freshnessOf', () => {
  const base = { permission: 'granted' as const, timedOut: false, now: NOW }
  it('denied wins over everything', () => {
    expect(freshnessOf({ ...base, permission: 'denied', fix: fix(1000, 'gps') })).toBe('denied')
  })
  it('live for a gps fix or a fix under 2 minutes', () => {
    expect(freshnessOf({ ...base, fix: fix(0, 'gps') })).toBe('live')
    expect(freshnessOf({ ...base, fix: fix(MIN, 'cache') })).toBe('live')
  })
  it('recent for 2-30 minute cache, old for 30+ or none', () => {
    expect(freshnessOf({ ...base, fix: fix(10 * MIN) })).toBe('recent')
    expect(freshnessOf({ ...base, fix: fix(31 * MIN) })).toBe('old')
    expect(freshnessOf({ ...base, fix: null })).toBe('old')
    expect(freshnessOf({ ...base, permission: 'unknown', fix: null })).toBe('old')
  })
  it('timeout replaces recent/old once the fix cap passed, but not live', () => {
    expect(freshnessOf({ ...base, timedOut: true, fix: fix(10 * MIN) })).toBe('timeout')
    expect(freshnessOf({ ...base, timedOut: true, fix: null })).toBe('timeout')
    expect(freshnessOf({ ...base, timedOut: true, fix: fix(0, 'gps') })).toBe('live')
  })
  it('a future-dated cache is old', () => {
    expect(freshnessOf({ ...base, fix: { ...fix(0), fixedAt: NOW + MIN } })).toBe('old')
  })
})

describe('pillTextFor', () => {
  it('live shows the street, or Current location when there is none', () => {
    expect(pillTextFor('live', 'MG Road, Puri')).toEqual({ text: 'MG Road, Puri', tappable: false, muted: false })
    expect(pillTextFor('live', '').text).toBe('Current location')
  })
  it('recent shows the cached street muted; without an address it says Finding', () => {
    expect(pillTextFor('recent', 'MG Road')).toEqual({ text: 'MG Road', tappable: false, muted: true })
    expect(pillTextFor('recent', '')).toEqual({ text: 'Finding your location…', tappable: false, muted: false })
  })
  it('old never shows the street', () => {
    expect(pillTextFor('old', 'MG Road').text).toBe('Finding your location…')
  })
  it('timeout and denied are tappable exits', () => {
    expect(pillTextFor('timeout', 'x')).toEqual({ text: 'Set pickup location', tappable: true, muted: false })
    expect(pillTextFor('denied', 'x')).toEqual({ text: 'Location off · Set pickup location', tappable: true, muted: false })
  })
})

describe('a11yLabelFor', () => {
  it('speaks each state without the ellipsis or the middle dot', () => {
    expect(a11yLabelFor('live', 'MG Road')).toBe('Pickup: MG Road')
    expect(a11yLabelFor('old', 'MG Road')).toBe('Pickup: Finding your location')
    expect(a11yLabelFor('denied', '')).toBe('Pickup: Location off, Set pickup location')
  })
})

describe('cameraMode', () => {
  it('glides under 1 km and snaps from 1 km', () => {
    expect(cameraMode(999)).toBe('glide')
    expect(cameraMode(1000)).toBe('snap')
    expect(cameraMode(1001)).toBe('snap')
  })
})

describe('movedBeyondGeocodeReuse', () => {
  const a = { lat: 20.2961, lng: 85.8245 }
  // ~0.00135 deg of latitude is ~150 m
  it('reuses the address inside 150 m and refetches from 150 m', () => {
    expect(movedBeyondGeocodeReuse(a, { lat: a.lat + 0.00130, lng: a.lng })).toBe(false)
    expect(movedBeyondGeocodeReuse(a, { lat: a.lat + 0.00140, lng: a.lng })).toBe(true)
  })
  it('refetches when there is nothing to compare', () => expect(movedBeyondGeocodeReuse(null, a)).toBe(true))
})

describe('partializeLocation', () => {
  it('keeps only the four persisted fields (never initialized/ready/permission)', () => {
    const state = { lat: 1, lng: 2, address: 'x', fixedAt: 3, initialized: true, ready: true, permission: 'granted', init: () => {} }
    expect(partializeLocation(state)).toEqual({ lat: 1, lng: 2, address: 'x', fixedAt: 3 })
  })
})
