import { describe, it, expect } from 'vitest'
import type { ActiveDriverSession } from '../admin-api'
import { stageOf, matchesQuery, visibleDrivers, stageCounts } from '../live-map-model'

const NOW = Date.parse('2026-11-25T10:00:00Z')
const fresh = new Date(NOW - 10_000).toISOString()
const old = new Date(NOW - 10 * 60_000).toISOString()

const base: ActiveDriverSession = {
  session_id: '1', driver_id: '1', driver_name: 'Asha', driver_phone: '+919811100101', driver_code: 'DRV001',
  session_status: 'online', lat: 20.3, lng: 85.8, heading: 0, speed_kmph: 0, location_updated_at: fresh,
  ride_id: null, ride_status: null, rider_name: null, origin_address: null, destination_address: null,
  origin_lat: null, origin_lng: null, dest_lat: null, dest_lng: null, vehicle_category: null, vehicle_name: null, number_plate: 'OD02 AB-1101',
}
const d = (over: Partial<ActiveDriverSession>): ActiveDriverSession => ({ ...base, ...over })

describe('stageOf', () => {
  it('idle for an online driver with a fresh fix', () => expect(stageOf(base, NOW)).toBe('idle'))
  it('maps each ride status to its stage', () => {
    const trip = { session_status: 'on_trip' as const, ride_id: '9' }
    expect(stageOf(d({ ...trip, ride_status: 'accepted' }), NOW)).toBe('to_pickup')
    expect(stageOf(d({ ...trip, ride_status: 'driver_arrived' }), NOW)).toBe('waiting')
    expect(stageOf(d({ ...trip, ride_status: 'in_progress' }), NOW)).toBe('on_trip')
    expect(stageOf(d({ ...trip, ride_status: 'returning' }), NOW)).toBe('on_trip')
  })
  it('an on-trip session with no ride row yet is on_trip', () => expect(stageOf(d({ session_status: 'on_trip' }), NOW)).toBe('on_trip'))
  it('no location beats every other stage', () => {
    expect(stageOf(d({ location_updated_at: old }), NOW)).toBe('no_location')
    expect(stageOf(d({ session_status: 'on_trip', ride_status: 'in_progress', location_updated_at: old }), NOW)).toBe('no_location')
    expect(stageOf(d({ location_updated_at: null }), NOW)).toBe('no_location')
  })
})

describe('matchesQuery', () => {
  const x = d({ driver_name: 'Tapas Ray', ride_id: '1212', rider_name: 'Bikash Nayak' })
  it('an empty search matches everyone', () => expect(matchesQuery(x, '  ')).toBe(true))
  it('matches name, phone, code, plate, ride number and rider, ignoring case, spaces and dashes', () => {
    for (const q of ['tapas', 'RAY', '98111 00101', '+919811100101', 'drv001', 'od02ab1101', 'od02 ab-1101', '1212', 'bikash']) expect(matchesQuery(x, q)).toBe(true)
  })
  it('does not match unrelated text', () => expect(matchesQuery(x, 'zzz')).toBe(false))
  it('survives null fields', () => expect(matchesQuery(d({ driver_name: null, number_plate: null }), 'asha')).toBe(false))
})

describe('visibleDrivers and stageCounts', () => {
  const silent = d({ driver_id: 's', driver_name: 'Zed', session_status: 'on_trip', ride_status: 'in_progress', location_updated_at: old })
  const waiting = d({ driver_id: 'w', driver_name: 'Wally', session_status: 'on_trip', ride_status: 'driver_arrived' })
  const trip = d({ driver_id: 't', driver_name: 'Tia', session_status: 'on_trip', ride_status: 'in_progress' })
  const idleB = d({ driver_id: 'b', driver_name: 'Bob' })
  const idleA = d({ driver_id: 'a', driver_name: 'Abe' })
  const idleSilent = d({ driver_id: 'i', driver_name: 'Ivy', location_updated_at: old })
  const all = [idleB, trip, idleSilent, waiting, idleA, silent]

  it('puts problems first, then the rest by name', () => {
    expect(visibleDrivers(all, '', 'all', NOW).map((v) => v.d.driver_id)).toEqual(['s', 'w', 't', 'a', 'b', 'i'])
  })
  it('filters by stage', () => expect(visibleDrivers(all, '', 'idle', NOW).map((v) => v.d.driver_id)).toEqual(['a', 'b']))
  it('combines search and filter', () => expect(visibleDrivers(all, 'zed', 'no_location', NOW).map((v) => v.d.driver_id)).toEqual(['s']))
  it('counts every stage', () => expect(stageCounts(all, NOW)).toEqual({ idle: 2, to_pickup: 0, waiting: 1, on_trip: 1, no_location: 2 }))
})
