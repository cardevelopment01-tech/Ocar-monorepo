import { describe, it, expect } from 'vitest'
import type { AssignCandidate } from '../admin-api'
import { markedDrivers, fmtDistance, boundsAround, MARKED_DRIVERS } from '../live-map-dispatch'

const cand = (over: Partial<AssignCandidate> & { driver_id: string }): AssignCandidate => ({
  driver_name: 'D', driver_phone: '+91', category_name: 'Sedan', city_billing_mode: 'commission',
  is_online: true, category_ok: true, wallet_ok: true, distance_metres: 1000, eligible: true, ...over,
})

describe('fmtDistance', () => {
  it('is kilometres with one decimal, like the driver list', () => {
    expect(fmtDistance(508)).toBe('0.5 km')
    expect(fmtDistance(984)).toBe('1.0 km')
    expect(fmtDistance(2400)).toBe('2.4 km')
    expect(fmtDistance(12_400)).toBe('12.4 km')
  })
})

describe('markedDrivers', () => {
  it('marks only drivers who are online, eligible and have a known distance', () => {
    const list = [
      cand({ driver_id: 'ok1', distance_metres: 500 }),
      cand({ driver_id: 'offline', is_online: false }),
      cand({ driver_id: 'wrongcat', eligible: false, category_ok: false }),
      cand({ driver_id: 'lowbal', eligible: false, wallet_ok: false }),
      cand({ driver_id: 'nopos', distance_metres: null }),
    ]
    expect(markedDrivers(list).map((m) => m.driverId)).toEqual(['ok1'])
  })

  it('ranks nearest first from 1 and keeps the distance label', () => {
    const m = markedDrivers([cand({ driver_id: 'far', distance_metres: 4200 }), cand({ driver_id: 'near', distance_metres: 800 }), cand({ driver_id: 'mid', distance_metres: 2400 })])
    expect(m.map((x) => [x.rank, x.driverId, x.label])).toEqual([[1, 'near', '0.8 km'], [2, 'mid', '2.4 km'], [3, 'far', '4.2 km']])
  })

  it('marks at most the nearest five, and a custom limit works', () => {
    const many = Array.from({ length: 12 }, (_, i) => cand({ driver_id: `d${i}`, distance_metres: 1000 + i * 100 }))
    expect(markedDrivers(many)).toHaveLength(MARKED_DRIVERS)
    expect(markedDrivers(many).at(-1)!.driverId).toBe('d4')
    expect(markedDrivers(many, 2)).toHaveLength(2)
  })

  it('does not change the list it is given', () => {
    const list = [cand({ driver_id: 'b', distance_metres: 900 }), cand({ driver_id: 'a', distance_metres: 100 })]
    markedDrivers(list)
    expect(list.map((c) => c.driver_id)).toEqual(['b', 'a'])
  })

  it('no candidates, nothing marked', () => expect(markedDrivers([])).toEqual([]))
})

describe('boundsAround', () => {
  it('holds the pickup and every point', () => {
    expect(boundsAround({ lat: 20.3, lng: 85.8 }, [{ lat: 20.4, lng: 85.7 }, { lat: 20.2, lng: 85.9 }])).toEqual({ north: 20.4, south: 20.2, east: 85.9, west: 85.7 })
  })
  it('is just the pickup with no points', () => {
    expect(boundsAround({ lat: 20.3, lng: 85.8 }, [])).toEqual({ north: 20.3, south: 20.3, east: 85.8, west: 85.8 })
  })
})
