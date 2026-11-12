import { describe, it, expect } from 'vitest'
import { resolveSearchRoute, tripModeFromParams, type Classification } from '../lib/city-ride-route'

const IN_ON: Classification = { scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar', city_ride_available: true }
const IN_OFF: Classification = { scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar', city_ride_available: false }
const IN_OLD: Classification = { scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar' } // older server: no hint field
const OUT: Classification = { scope: 'outstation', cityId: null, cityName: null }

// What the search page did before City ride existed, for every case. With City ride off, or an older server, nothing may change.
describe.each([['switch off', IN_OFF], ['older server', IN_OLD]])('legacy behaviour (%s)', (_n, inCity) => {
  it('backTo select-ride', () => {
    expect(resolveSearchRoute({ backTo: 'select-ride', rideType: 'one_way', classification: inCity })).toEqual({ path: '/rental', toast: 'to_rental' })
    expect(resolveSearchRoute({ backTo: 'select-ride', rideType: 'round_trip', classification: inCity })).toEqual({ path: '/rental', toast: 'to_rental' })
    expect(resolveSearchRoute({ backTo: 'select-ride', rideType: 'one_way', classification: OUT })).toEqual({ path: '/select-ride', toast: null })
  })
  it('backTo round_trip and rental', () => {
    expect(resolveSearchRoute({ backTo: 'round_trip', classification: inCity })).toEqual({ path: '/rental', toast: 'to_rental' })
    expect(resolveSearchRoute({ backTo: 'round_trip', classification: OUT })).toEqual({ path: '/round-trip', toast: null })
    expect(resolveSearchRoute({ backTo: 'rental', classification: inCity })).toEqual({ path: '/rental', toast: null })
    expect(resolveSearchRoute({ backTo: 'rental', classification: OUT })).toEqual({ path: '/trip-type', toast: 'to_outstation' })
  })
  it('a declared one-way, and no declared ride type', () => {
    expect(resolveSearchRoute({ rideType: 'one_way', classification: inCity })).toEqual({ path: '/rental', toast: 'to_rental' })
    expect(resolveSearchRoute({ rideType: 'one_way', classification: OUT })).toEqual({ path: '/select-ride', toast: null })
    expect(resolveSearchRoute({ classification: inCity })).toEqual({ path: '/rental', toast: null })
    expect(resolveSearchRoute({ classification: OUT })).toEqual({ path: '/trip-type', toast: null })
  })
})

describe('City ride on', () => {
  it('an in-city trip with no declared ride type, or a declared one-way, becomes a city ride', () => {
    expect(resolveSearchRoute({ classification: IN_ON })).toEqual({ path: '/select-ride', tripMode: 'city', toast: 'to_city' })
    expect(resolveSearchRoute({ rideType: 'one_way', classification: IN_ON })).toEqual({ path: '/select-ride', tripMode: 'city', toast: 'to_city' })
    expect(resolveSearchRoute({ backTo: 'select-ride', rideType: 'one_way', classification: IN_ON })).toEqual({ path: '/select-ride', tripMode: 'city', toast: 'to_city' })
  })

  it('a round trip inside the city still goes to Rental (never offered inside the city)', () => {
    expect(resolveSearchRoute({ backTo: 'select-ride', rideType: 'round_trip', classification: IN_ON })).toEqual({ path: '/rental', toast: 'to_rental' })
    expect(resolveSearchRoute({ backTo: 'round_trip', classification: IN_ON })).toEqual({ path: '/rental', toast: 'to_rental' })
  })

  it('Rental and trips that leave the city are unchanged', () => {
    expect(resolveSearchRoute({ backTo: 'rental', classification: IN_ON })).toEqual({ path: '/rental', toast: null })
    expect(resolveSearchRoute({ classification: OUT })).toEqual({ path: '/trip-type', toast: null })
    expect(resolveSearchRoute({ rideType: 'one_way', classification: OUT })).toEqual({ path: '/select-ride', toast: null })
  })
})

describe('the City Ride tile (tripMode city)', () => {
  const a = { rideType: 'one_way', tripMode: 'city' as const }
  it('stays on the city ride inside the city when it is on', () => {
    expect(resolveSearchRoute({ ...a, classification: IN_ON })).toEqual({ path: '/select-ride', tripMode: 'city', toast: null })
  })
  it('falls back to Rental inside the city when it is off or the server is older', () => {
    expect(resolveSearchRoute({ ...a, classification: IN_OFF })).toEqual({ path: '/rental', toast: 'to_rental' })
    expect(resolveSearchRoute({ ...a, classification: IN_OLD })).toEqual({ path: '/rental', toast: 'to_rental' })
  })
  it('a trip that leaves the city is sent to Outstation, without the city mode', () => {
    expect(resolveSearchRoute({ ...a, classification: OUT })).toEqual({ path: '/trip-type', toast: 'to_outstation' })
  })
  it('a failed classification keeps the city ride (the server judges the trip), with no false toast', () => {
    expect(resolveSearchRoute({ ...a, classification: null })).toEqual({ path: '/select-ride', tripMode: 'city', toast: null })
  })
})

describe('a stale tripMode never pulls another picker into a city ride', () => {
  it('Rental and round-trip pickers keep their own routes even when the URL still says tripMode=city', () => {
    expect(resolveSearchRoute({ backTo: 'rental', tripMode: 'city', classification: IN_ON })).toEqual({ path: '/rental', toast: null })
    expect(resolveSearchRoute({ backTo: 'round_trip', tripMode: 'city', classification: IN_ON })).toEqual({ path: '/rental', toast: 'to_rental' })
    expect(resolveSearchRoute({ backTo: 'round_trip', tripMode: 'city', classification: OUT })).toEqual({ path: '/round-trip', toast: null })
  })
  it('editing from the ride list keeps the city ride', () => {
    expect(resolveSearchRoute({ backTo: 'select-ride', rideType: 'one_way', tripMode: 'city', classification: IN_ON })).toEqual({ path: '/select-ride', tripMode: 'city', toast: null })
  })
})

describe('tripModeFromParams', () => {
  it('is city only for a one-way (or undeclared) trip', () => {
    expect(tripModeFromParams('city', 'one_way')).toBe('city')
    expect(tripModeFromParams('city', null)).toBe('city')
    expect(tripModeFromParams('city', 'round_trip')).toBeUndefined()
    expect(tripModeFromParams('city', 'rental')).toBeUndefined()
    expect(tripModeFromParams(null, 'one_way')).toBeUndefined()
    expect(tripModeFromParams('bogus', 'one_way')).toBeUndefined()
  })
})
