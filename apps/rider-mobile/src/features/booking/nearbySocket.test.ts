import { describe, expect, it, vi } from 'vitest'
import { attachNearbyCars } from './nearbySocket'

// Value: protects=a searching ride is subscribed to the live cars on open AND after every reconnect (a socket forgets its
// rooms), only well-formed cars reach the map, and leaving cleans up fully; fails_when=a reconnect loses the subscription,
// listeners leak after the screen closes, or a hostile payload is passed through; why_new=live nearby-cars push;
// seam=fake socket; no_claim=the server side (api/tests/unit/websocket).
function fakeSocket() {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>()
  return {
    emit: vi.fn(),
    on: vi.fn((ev: string, cb: (...a: unknown[]) => void) => { (handlers.get(ev) ?? handlers.set(ev, new Set()).get(ev)!).add(cb) }),
    off: vi.fn((ev: string, cb: (...a: unknown[]) => void) => { handlers.get(ev)?.delete(cb) }),
    fire: (ev: string, ...a: unknown[]) => { for (const cb of [...(handlers.get(ev) ?? [])]) cb(...a) },
    count: (ev: string) => handlers.get(ev)?.size ?? 0,
  }
}

describe('attachNearbyCars', () => {
  it('subscribes the ride straight away, naming only the ride (the server derives the area itself)', () => {
    const s = fakeSocket()
    attachNearbyCars(s as never, '597', vi.fn())
    expect(s.emit).toHaveBeenCalledWith('nearby:subscribe', { rideId: '597' })
  })

  it('subscribes again on every (re)connect: a socket forgets its rooms', () => {
    const s = fakeSocket()
    attachNearbyCars(s as never, '597', vi.fn())
    s.fire('connect')
    s.fire('connect')
    expect(s.emit.mock.calls.filter((c) => c[0] === 'nearby:subscribe')).toHaveLength(3)
  })

  it('passes well-formed cars on, and ignores malformed or hostile payloads', () => {
    const s = fakeSocket()
    const onCar = vi.fn()
    attachNearbyCars(s as never, '597', onCar)
    s.fire('nearby:car', { id: 'abc', lat: 20.3, lng: 85.8, heading: 90, categoryId: 2 })
    s.fire('nearby:car', { id: 'abc', lat: 999, lng: 85.8 })
    s.fire('nearby:car', null)
    s.fire('nearby:car', 'x')
    expect(onCar).toHaveBeenCalledTimes(1)
    expect(onCar).toHaveBeenCalledWith({ id: 'abc', lat: 20.3, lng: 85.8, heading: 90 })
  })

  it('detaching unsubscribes and leaves no listener behind, so a closed screen hears nothing more', () => {
    const s = fakeSocket()
    const onCar = vi.fn()
    const detach = attachNearbyCars(s as never, '597', onCar)
    expect(s.count('connect')).toBe(1)
    expect(s.count('nearby:car')).toBe(1)
    detach()
    expect(s.count('connect')).toBe(0)
    expect(s.count('nearby:car')).toBe(0)
    expect(s.emit).toHaveBeenLastCalledWith('nearby:unsubscribe')
    s.fire('nearby:car', { id: 'abc', lat: 20.3, lng: 85.8 })
    expect(onCar).not.toHaveBeenCalled()
  })
})
