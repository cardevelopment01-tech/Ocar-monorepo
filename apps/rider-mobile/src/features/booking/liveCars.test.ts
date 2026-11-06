import { describe, expect, it } from 'vitest'
import { LIVE_FRESH_MS, LIVE_TTL_MS, SNAPSHOT_TTL_MS, applyLive, applySnapshot, carsNear, expireCars, liveIsFlowing, parseCarEvent, sameCars, type LiveCars } from './liveCars'

// Value: protects=the cars on a searching rider's map are the freshest word on each driver: live positions win, the REST
// snapshot fills in and takes over when the push is not arriving, silent cars drop out, and a hostile or malformed socket
// payload cannot put anything on the map; fails_when=a stale snapshot overwrites a fresh live position, a push-less phone
// loses its cars between polls, or a bad payload is accepted; why_new=live nearby-cars push; seam=none (pure rules);
// no_claim=socket delivery or marker animation.
const T0 = 1_000_000
const P: [number, number] = [20.2961, 85.8245]
const DEG_PER_M = 1 / 111_320
const snap = (id: string, northM = 100) => ({ driverId: id, lat: P[0] + northM * DEG_PER_M, lng: P[1], categoryId: 2 })
const empty: LiveCars = new Map()

describe('parseCarEvent (untrusted socket payload)', () => {
  it('accepts a well-formed position, with or without a heading', () => {
    expect(parseCarEvent({ id: 'abc123def456', lat: 20.3, lng: 85.8, heading: 90, categoryId: 2 })).toEqual({ id: 'abc123def456', lat: 20.3, lng: 85.8, heading: 90 })
    expect(parseCarEvent({ id: 'abc123def456', lat: 20.3, lng: 85.8 })).toEqual({ id: 'abc123def456', lat: 20.3, lng: 85.8 })
  })
  it('drops a heading that is not a compass bearing but keeps the position', () => {
    expect(parseCarEvent({ id: 'a', lat: 1, lng: 2, heading: 400 })).toEqual({ id: 'a', lat: 1, lng: 2 })
    expect(parseCarEvent({ id: 'a', lat: 1, lng: 2, heading: NaN })).toEqual({ id: 'a', lat: 1, lng: 2 })
  })
  it.each([
    undefined, null, 0, 'x', [], {}, { id: 5, lat: 1, lng: 2 }, { id: '', lat: 1, lng: 2 }, { id: 'x'.repeat(65), lat: 1, lng: 2 },
    { id: 'a b', lat: 1, lng: 2 }, { id: 'a', lat: 91, lng: 2 }, { id: 'a', lat: 1, lng: -181 }, { id: 'a', lat: '1', lng: 2 },
    { id: 'a', lat: NaN, lng: 2 }, { id: 'a', lat: Infinity, lng: 2 }, { id: 'a', lat: 1 },
  ])('ignores a malformed payload: %j', (raw) => {
    expect(parseCarEvent(raw)).toBeNull()
  })
})

describe('applyLive / applySnapshot', () => {
  it('a live position adds or moves a car and is never overwritten by a fresher-looking snapshot of the same instant', () => {
    let cars = applyLive(empty, { id: 'a', lat: 20.3, lng: 85.8, heading: 10 }, T0)
    expect(cars.get('a')).toMatchObject({ lat: 20.3, heading: 10, source: 'live', seenAt: T0 })
    cars = applySnapshot(cars, [snap('a', 500)], T0 + 1000) // live is 1 s old: fresher than any snapshot
    expect(cars.get('a')).toMatchObject({ lat: 20.3, source: 'live' })
  })

  it('a snapshot fills in cars not heard live, and replaces a live position that has gone stale', () => {
    let cars = applySnapshot(empty, [snap('a'), snap('b')], T0)
    expect([...cars.keys()].sort()).toEqual(['a', 'b'])
    expect(cars.get('a')!.source).toBe('snapshot')
    cars = applyLive(cars, { id: 'a', lat: 20.3, lng: 85.8 }, T0 + 1000)
    cars = applySnapshot(cars, [snap('a', 700)], T0 + 1000 + LIVE_FRESH_MS + 1)
    expect(cars.get('a')).toMatchObject({ source: 'snapshot' })
  })

  it('does not mutate the previous map', () => {
    const before = applyLive(empty, { id: 'a', lat: 1, lng: 1 }, T0)
    applyLive(before, { id: 'b', lat: 2, lng: 2 }, T0)
    expect(before.size).toBe(1)
  })
})

describe('expireCars / liveIsFlowing', () => {
  it('drops a live car after three missed pings, and a snapshot car only after it has outlived the polling interval', () => {
    let cars = applyLive(empty, { id: 'live', lat: 1, lng: 1 }, T0)
    cars = applySnapshot(cars, [snap('snap')], T0)
    expect([...expireCars(cars, T0 + LIVE_TTL_MS).keys()].sort()).toEqual(['live', 'snap'])
    expect([...expireCars(cars, T0 + LIVE_TTL_MS + 1).keys()]).toEqual(['snap']) // 8 s polling keeps snapshot cars alive
    expect([...expireCars(cars, T0 + SNAPSHOT_TTL_MS + 1).keys()]).toEqual([])
  })

  it('returns the same map when nothing expired (no needless work)', () => {
    const cars = applyLive(empty, { id: 'a', lat: 1, lng: 1 }, T0)
    expect(expireCars(cars, T0 + 1000)).toBe(cars)
  })

  it('knows whether the live push is reaching the phone: recent live positions yes, snapshot-only or silence no', () => {
    expect(liveIsFlowing(applySnapshot(empty, [snap('a')], T0), T0)).toBe(false)
    const live = applyLive(empty, { id: 'a', lat: 1, lng: 1 }, T0)
    expect(liveIsFlowing(live, T0 + 2000)).toBe(true)
    expect(liveIsFlowing(live, T0 + LIVE_TTL_MS + 1)).toBe(false)
    expect(liveIsFlowing(empty, T0)).toBe(false)
  })
})

describe('carsNear / sameCars', () => {
  it('keeps only cars within the shown distance of the pickup, nearest first, carrying the heading', () => {
    let cars = applyLive(empty, { id: 'far', lat: P[0] + 4000 * DEG_PER_M, lng: P[1] }, T0)
    cars = applyLive(cars, { id: 'mid', lat: P[0] + 900 * DEG_PER_M, lng: P[1], heading: 45 }, T0)
    cars = applyLive(cars, { id: 'near', lat: P[0] + 100 * DEG_PER_M, lng: P[1] }, T0)
    const list = carsNear(cars, P)
    expect(list.map((c) => c.driverId)).toEqual(['near', 'mid'])
    expect(list[1]!.heading).toBe(45)
    expect(list[0]).not.toHaveProperty('heading')
  })

  it('compares lists by what they would draw', () => {
    const a = [{ driverId: 'a', lat: 1, lng: 2, heading: 3 }]
    expect(sameCars(a, [{ driverId: 'a', lat: 1, lng: 2, heading: 3 }])).toBe(true)
    expect(sameCars(a, [{ driverId: 'a', lat: 1.0001, lng: 2, heading: 3 }])).toBe(false)
    expect(sameCars(a, [])).toBe(false)
  })
})
