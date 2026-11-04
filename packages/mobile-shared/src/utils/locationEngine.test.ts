import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocationEngine, type LocationDeps, type LocationSlice } from './locationEngine'
import type { Fix } from './locationPolicy'

// Value: protects=the two rider-location bugs (a slow first fix is never lost; an old place never stays "live") plus the
// watcher lifecycle and address reuse; fails_when=a late fix is dropped, a fix older than a minute counts as current, or two
// watchers run; why_new=location rework; seam=fake watcher/geocoder/clock injected into the engine; no_claim=real GPS timing.

const T0 = 1_800_000_000_000
const DEG_PER_M = 1 / 111_320 // metres of latitude

let clock = T0
let slice: LocationSlice
let watchers: Array<{ emit: (f: Fix) => void; removed: boolean }>
let tracked: Array<[string, Record<string, unknown>]>
let geocodeCalls: Array<{ lat: number; lng: number; resolve: (a: string) => void; reject: () => void }>
let lastKnownResult: Fix | null

const empty = (): LocationSlice => ({ lat: null, lng: null, address: '', fixedAt: null, source: null, timedOut: false, ready: false })
const fix = (northM: number, source: Fix['source'] = 'gps', fixedAt = clock): Fix => ({ lat: 20.29 + northM * DEG_PER_M, lng: 85.82, fixedAt, source })

function build() {
  const deps: LocationDeps = {
    watch: async (onFix) => {
      const w = { emit: onFix, removed: false }
      watchers.push(w)
      return { remove: () => { w.removed = true } }
    },
    lastKnown: async () => lastKnownResult,
    geocode: (lat, lng) => new Promise<string>((resolve, reject) => { geocodeCalls.push({ lat, lng, resolve, reject: () => reject(new Error('x')) }) }),
    now: () => clock,
    track: (event, props) => { tracked.push([event, props]) },
  }
  return createLocationEngine({ get: () => slice, set: (p) => { slice = { ...slice, ...p } }, deps })
}

const flush = () => vi.advanceTimersByTimeAsync(0)
const advance = async (ms: number) => { clock += ms; await vi.advanceTimersByTimeAsync(ms) }

beforeEach(() => {
  vi.useFakeTimers()
  clock = T0
  slice = empty()
  watchers = []
  tracked = []
  geocodeCalls = []
  lastKnownResult = null
})
afterEach(() => { vi.useRealTimers() })

describe('a slow first fix', () => {
  it('is still applied when it arrives after the "still looking" cap, and clears the timeout state', async () => {
    const e = build()
    await e.activate()
    await advance(8_000)
    expect(slice.timedOut).toBe(true)
    expect(tracked.some(([n]) => n === 'location_timeout')).toBe(true)

    await advance(7_000) // the fix arrives 15 s after launch
    watchers[0]!.emit(fix(0))
    expect(slice.timedOut).toBe(false)
    expect(slice.lat).not.toBeNull()
    const ready = tracked.find(([n]) => n === 'location_fix_ready')!
    expect(ready[1]).toMatchObject({ ms: 15_000, after_timeout: true, had_saved: false })
  })
})

describe('an old place', () => {
  it('a saved fix from hours ago is not current on resume: the cap flags a timeout until a new fix arrives', async () => {
    slice = { ...empty(), lat: 20.5, lng: 85.9, fixedAt: T0 - 3 * 3600_000, source: 'gps', ready: true }
    const e = build()
    await e.activate()
    await advance(8_000)
    expect(slice.timedOut).toBe(true) // before the rework an old "gps" fix counted as fresh and nothing was flagged
    watchers[0]!.emit(fix(0))
    expect(slice.lat).toBeCloseTo(20.29, 4)
    expect(slice.timedOut).toBe(false)
  })

  it('an older fix never replaces a newer one', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.emit(fix(0, 'gps', T0))
    watchers[0]!.emit(fix(500, 'os', T0 - 60_000))
    expect(slice.lat).toBeCloseTo(20.29, 4)
  })
})

describe('the watcher', () => {
  it('runs once however many times activate is called, and stops on deactivate', async () => {
    const e = build()
    await Promise.all([e.activate(), e.activate(), e.activate()])
    expect(watchers).toHaveLength(1)
    e.deactivate()
    expect(watchers[0]!.removed).toBe(true)
  })

  it('stop then start while the first watcher is still starting leaves exactly one running', async () => {
    const e = build()
    const first = e.activate()
    e.deactivate()
    const second = e.activate()
    await Promise.all([first, second])
    expect(watchers.filter((w) => !w.removed)).toHaveLength(1)
  })
})

describe('jitter', () => {
  it('a fix a few metres away refreshes the timestamp but not lat/lng', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.emit(fix(0, 'gps', T0))
    const { lat } = slice
    await advance(5_000)
    watchers[0]!.emit(fix(4, 'gps', clock))
    expect(slice.lat).toBe(lat)
    expect(slice.fixedAt).toBe(clock)
    clock += 1_000
    watchers[0]!.emit(fix(30, 'gps', clock))
    expect(slice.lat).not.toBe(lat)
  })
})

describe('the address', () => {
  it('is looked up for a device fix, including the instant OS one, not for the saved one', async () => {
    slice = { ...empty(), lat: 20.29, lng: 85.82, fixedAt: T0 - 5 * 60_000, source: 'cache', ready: true }
    lastKnownResult = fix(0, 'os', T0 - 2_000)
    const e = build()
    await e.activate()
    await flush()
    expect(geocodeCalls).toHaveLength(1)
    geocodeCalls[0]!.resolve('Saheed Nagar')
    await flush()
    expect(slice.address).toBe('Saheed Nagar')
  })

  it('is reused within 150 m and re-looked-up once the rider is 150 m from where it was looked up (slow walk included)', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.emit(fix(0, 'gps', T0))
    geocodeCalls[0]!.resolve('A')
    await flush()
    let t = T0
    for (const m of [60, 120]) { t += 5_000; clock = t; watchers[0]!.emit(fix(m, 'gps', t)) } // each step under 150 m from the last fix
    expect(slice.address).toBe('A')
    expect(geocodeCalls).toHaveLength(1)
    t += 5_000; clock = t
    watchers[0]!.emit(fix(180, 'gps', t)) // 180 m from where 'A' was looked up
    expect(slice.address).toBe('')
    expect(geocodeCalls).toHaveLength(2)
  })

  it('one request at a time while a slow lookup is pending; a failed one is retried after the back-off, not on every fix', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.emit(fix(0, 'gps', T0))
    clock += 5_000; watchers[0]!.emit(fix(0, 'gps', clock))
    clock += 5_000; watchers[0]!.emit(fix(0, 'gps', clock))
    expect(geocodeCalls).toHaveLength(1)
    geocodeCalls[0]!.reject()
    await flush()
    clock += 5_000; watchers[0]!.emit(fix(0, 'gps', clock)) // inside the 15 s back-off
    expect(geocodeCalls).toHaveLength(1)
    clock += 15_000; watchers[0]!.emit(fix(0, 'gps', clock))
    expect(geocodeCalls).toHaveLength(2)
  })
})
