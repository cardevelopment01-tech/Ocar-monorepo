import { describe, expect, it } from 'vitest'
import { FADE_FROM, FADE_MS, FADE_TICK_MS, REMOVE_AFTER_MS, fleetOpacity, hasRetired, nextFleetWake, pruneFleet, reconcileFleet, retireAll, type FleetEntry } from './nearbyFleet'

// Value: protects=a nearby car is never removed from the map while it may still be gliding (the stray cars left behind after a
// driver was assigned), and is invisible long before it is removed; fails_when=a car that left the feed is removed at once,
// stays visible, or is never removed; why_new=searching-map nearby cars hand-over; seam=none (pure rules); no_claim=the native
// marker removal itself.
const car = (id: string, lat = 20.3, lng = 85.8) => ({ driverId: id, lat, lng })
const T0 = 1_000_000

describe('reconcileFleet', () => {
  it('adds new cars as live and refreshes the position of a live car', () => {
    const a = reconcileFleet([], [car('a'), car('b')], T0)
    expect(a.map((e) => [e.car.driverId, e.retiredAt])).toEqual([['a', null], ['b', null]])
    const b = reconcileFleet(a, [car('a', 20.31, 85.8), car('b')], T0 + 8000)
    expect(b.find((e) => e.car.driverId === 'a')!.car.lat).toBe(20.31)
  })

  it('retires a car that left the feed instead of removing it, and keeps the time it was first retired', () => {
    const a = reconcileFleet([], [car('a'), car('b')], T0)
    const b = reconcileFleet(a, [car('a')], T0 + 1000)
    expect(b).toHaveLength(2)
    expect(b.find((e) => e.car.driverId === 'b')!.retiredAt).toBe(T0 + 1000)
    const c = reconcileFleet(b, [car('a')], T0 + 3000)
    expect(c.find((e) => e.car.driverId === 'b')!.retiredAt).toBe(T0 + 1000) // not reset by the next poll
  })

  it('revives a retired car that comes back in the feed', () => {
    const a = reconcileFleet([], [car('a')], T0)
    const b = reconcileFleet(a, [], T0 + 1000)
    expect(b[0]!.retiredAt).toBe(T0 + 1000)
    expect(reconcileFleet(b, [car('a')], T0 + 2000)[0]!.retiredAt).toBeNull()
  })

  it('removes a retired car only after no glide can still be running', () => {
    const a = reconcileFleet([], [car('a')], T0)
    const b = reconcileFleet(a, [], T0 + 100)
    expect(reconcileFleet(b, [], T0 + 100 + REMOVE_AFTER_MS - 1)).toHaveLength(1)
    expect(reconcileFleet(b, [], T0 + 100 + REMOVE_AFTER_MS)).toHaveLength(0)
  })
})

describe('retireAll (a driver was assigned)', () => {
  it('retires every live car at once and keeps earlier retirement times', () => {
    const live = reconcileFleet([], [car('a'), car('b')], T0)
    const mixed = reconcileFleet(live, [car('a')], T0 + 500) // b already retired
    const all = retireAll(mixed, T0 + 900)
    expect(all.find((e) => e.car.driverId === 'a')!.retiredAt).toBe(T0 + 900)
    expect(all.find((e) => e.car.driverId === 'b')!.retiredAt).toBe(T0 + 500)
    expect(hasRetired(all)).toBe(true)
  })
})

describe('fleetOpacity and pruneFleet', () => {
  const live: FleetEntry = { car: car('a'), retiredAt: null }
  const retired: FleetEntry = { car: car('a'), retiredAt: T0 }
  it('a live car is fully visible; a retired one fades out over FADE_MS and is then invisible while it stays mounted', () => {
    expect(fleetOpacity(live, T0)).toBe(1)
    expect(fleetOpacity(retired, T0)).toBeCloseTo(FADE_FROM)
    expect(fleetOpacity(retired, T0 + FADE_MS / 2)).toBeCloseTo(FADE_FROM / 2)
    expect(fleetOpacity(retired, T0 + FADE_MS)).toBe(0)
    expect(fleetOpacity(retired, T0 + REMOVE_AFTER_MS - 1)).toBe(0) // still mounted, invisible
  })
  it('opacity is zero before removal, so a marker that fails to unmount cleanly is still not seen', () => {
    expect(fleetOpacity(retired, T0 + FADE_MS + 1)).toBe(0)
    expect(pruneFleet([live, retired], T0 + REMOVE_AFTER_MS)).toEqual([live])
  })
})

describe('nextFleetWake', () => {
  const live: FleetEntry = { car: car('a'), retiredAt: null }
  it('never needs waking while every car is live', () => {
    expect(nextFleetWake([live], T0)).toBeNull()
    expect(nextFleetWake([], T0)).toBeNull()
  })
  it('ticks every FADE_TICK_MS while a retired car is still fading, so the fade is drawn', () => {
    const fading: FleetEntry = { car: car('b'), retiredAt: T0 }
    expect(nextFleetWake([live, fading], T0 + 100)).toBe(FADE_TICK_MS)
  })
  it('once everything retired is invisible, sleeps until the first removal instead of redrawing for 9 s', () => {
    const early: FleetEntry = { car: car('b'), retiredAt: T0 }
    const late: FleetEntry = { car: car('c'), retiredAt: T0 + 2000 }
    const now = T0 + FADE_MS + 3000 // both invisible by now
    expect(nextFleetWake([early, late], now)).toBe(T0 + REMOVE_AFTER_MS - now)
    expect(nextFleetWake([early, late], T0 + REMOVE_AFTER_MS + 5)).toBe(0) // overdue: wake at once
  })
})
