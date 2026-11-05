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
let watchers: Array<{ emit: (f: Fix) => void; fail: () => void; removed: boolean }>
let currentFixCalls: number
let currentFixResult: Fix | null
let lastKnownDelay: Promise<void> | null
let tracked: Array<[string, Record<string, unknown>]>
let geocodeCalls: Array<{ lat: number; lng: number; resolve: (a: string) => void; reject: () => void }>
let lastKnownResult: Fix | null

const empty = (): LocationSlice => ({ lat: null, lng: null, address: '', fixedAt: null, source: null, timedOut: false, ready: false, accuracy: null })
const fix = (northM: number, source: Fix['source'] = 'gps', fixedAt = clock): Fix => ({ lat: 20.29 + northM * DEG_PER_M, lng: 85.82, fixedAt, source })

function build() {
  const deps: LocationDeps = {
    watch: async (onFix, onError) => {
      const w = { emit: onFix, fail: onError, removed: false }
      watchers.push(w)
      return { remove: () => { w.removed = true } }
    },
    lastKnown: async () => { if (lastKnownDelay) await lastKnownDelay; return lastKnownResult },
    currentFix: async () => { currentFixCalls++; if (!currentFixResult) throw new Error('none'); return currentFixResult },
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
  currentFixCalls = 0
  currentFixResult = null
  lastKnownDelay = null
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

describe('a quiet or dead watcher', () => {
  it('asks for a fix directly once the watcher has been silent for 30 s (iOS reports nothing while stationary)', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.emit(fix(0, 'gps', T0))
    const atStart = currentFixCalls // the launch itself asks once: there was no fix yet
    currentFixResult = fix(0, 'gps', T0 + 31_000)
    await advance(15_000)
    expect(currentFixCalls).toBe(atStart)
    await advance(16_000)
    expect(currentFixCalls).toBeGreaterThan(atStart)
    expect(slice.fixedAt).toBe(T0 + 31_000)
  })

  it('restarts a watcher whose native subscription died', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.fail()
    expect(watchers[0]!.removed).toBe(true)
    await advance(3_000)
    expect(watchers).toHaveLength(2)
    expect(watchers[1]!.removed).toBe(false)
  })

  it('does not restart after deactivate', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.fail()
    e.deactivate()
    await advance(10_000)
    expect(watchers).toHaveLength(1)
  })
})

describe('ensure (screen focus)', () => {
  it('leaves a running tracker and its timeout state alone', async () => {
    const e = build()
    await e.activate()
    await advance(8_000)
    expect(slice.timedOut).toBe(true)
    await e.ensure()
    expect(slice.timedOut).toBe(true) // focusing a screen must not flip "Set pickup location" back to "Finding..."
    expect(watchers).toHaveLength(1)
  })
  it('starts the tracker when it is not running', async () => {
    const e = build()
    await e.ensure()
    expect(watchers).toHaveLength(1)
  })
})

describe('sign-out', () => {
  it('an OS last-known answer that lands after reset does not put the previous rider back', async () => {
    let release!: () => void
    lastKnownDelay = new Promise<void>((r) => { release = r })
    lastKnownResult = fix(0, 'os', T0)
    const e = build()
    void e.activate()
    await flush()
    e.deactivate()
    e.reset()
    release()
    await flush()
    expect(slice.lat).toBeNull()
    expect(geocodeCalls).toHaveLength(0)
  })
})

describe('a rough fix', () => {
  it('does not replace a precise live one just because it is newer', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.emit({ ...fix(0, 'gps', T0), accuracy: 15 })
    clock += 2_000
    watchers[0]!.emit({ ...fix(1500, 'os', clock), accuracy: 1500 })
    expect(slice.lat).toBeCloseTo(20.29, 4)
  })
  it('is accepted when there is no precise live fix to protect', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.emit({ ...fix(1500, 'os', T0), accuracy: 1500 })
    expect(slice.lat).not.toBeNull()
  })
})

describe('accuracy', () => {
  it('is held with the fix so the UI can tell a rough location from a precise one, and cleared by a fix with none', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.emit({ ...fix(0, 'gps', T0), accuracy: 18 })
    expect(slice.accuracy).toBe(18)
    clock += 5_000
    watchers[0]!.emit(fix(40, 'gps', clock))
    expect(slice.accuracy).toBeNull()
  })
})

describe('review fixes', () => {
  it('a saved address is checked against the saved spot: a 1 km walk in small steps clears it', async () => {
    slice = { ...empty(), lat: 20.29, lng: 85.82, address: 'Home Street', fixedAt: T0 - 5_000, source: 'cache', ready: true }
    const e = build()
    await e.activate()
    let t = T0
    for (let m = 7; m <= 1000; m += 7) { t += 1_000; clock = t; watchers[0]!.emit(fix(m, 'gps', t)) }
    expect(slice.address).not.toBe('Home Street')
    expect(geocodeCalls.length).toBeGreaterThan(0)
  })

  it('shows "still looking" even while the watcher keeps dying, and gives up restarting it after five tries', async () => {
    const e = build()
    await e.activate()
    for (let i = 0; i < 8; i++) {
      watchers[watchers.length - 1]!.fail()
      await advance(60_000)
    }
    expect(slice.timedOut).toBe(true)
    expect(watchers.length).toBeLessThanOrEqual(6) // the first plus five restarts
  })

  it('a provider timestamp slightly ahead of the clock still counts as now, and later fixes still win', async () => {
    const e = build()
    await e.activate()
    watchers[0]!.emit(fix(0, 'gps', T0 + 400))
    expect(slice.fixedAt).toBe(T0)
    clock += 5_000
    watchers[0]!.emit(fix(60, 'gps', clock + 400))
    expect(slice.fixedAt).toBe(clock)
  })

  it('has one outstanding direct request at a time', async () => {
    let settle!: (f: Fix) => void
    const calls: number[] = []
    const e = createLocationEngine({
      get: () => slice,
      set: (p) => { slice = { ...slice, ...p } },
      deps: {
        watch: async () => ({ remove() {} }),
        lastKnown: async () => null,
        currentFix: () => { calls.push(1); return new Promise<Fix>((r) => { settle = r }) },
        geocode: () => new Promise<string>(() => {}),
        now: () => clock,
        track: () => {},
      },
    })
    await e.activate()
    await advance(60_000)
    await e.ensure()
    expect(calls).toHaveLength(1)
    settle(fix(0, 'gps', clock))
    await flush()
  })
})
