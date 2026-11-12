import { describe, expect, it } from 'vitest'
import { resolveInCityRoute, type TripClassification } from './cityRideRoute'

const IN_CITY_ON: TripClassification = { scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar', cityRideAvailable: true }
const IN_CITY_OFF: TripClassification = { scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar', cityRideAvailable: false }
const IN_CITY_OLD_SERVER: TripClassification = { scope: 'in_city', cityId: 1, cityName: 'Bhubaneswar' } // no hint field at all
const OUTSIDE: TripClassification = { scope: 'outstation' }

describe('City Ride tile (declared one-way with trip mode city)', () => {
  const args = { rideTypeDeclared: true, rideType: 'one_way' as const, tripMode: 'city' as const }

  it('goes straight to Choose a ride as a city ride when the trip is in the city and City ride is on', () => {
    expect(resolveInCityRoute({ ...args, classification: IN_CITY_ON })).toEqual({
      path: '/booking/fare', rideType: 'one_way', rideTypeDeclared: true, tripMode: 'city', toast: null,
    })
  })

  it('a trip that leaves the city is sent to Outstation with a toast', () => {
    expect(resolveInCityRoute({ ...args, classification: OUTSIDE })).toEqual({
      path: '/booking/trip-type', rideType: 'one_way', rideTypeDeclared: false, tripMode: 'standard', toast: 'to_outstation',
    })
  })

  it('falls back to Rental (exactly today) when City ride is off or the server does not know it', () => {
    for (const c of [IN_CITY_OFF, IN_CITY_OLD_SERVER]) {
      expect(resolveInCityRoute({ ...args, classification: c })).toEqual({
        path: '/booking/rental', rideType: 'rental', rideTypeDeclared: true, tripMode: 'standard', toast: 'to_rental',
      })
    }
  })

  it('a failed classification is treated as outstation, like the booking screen always did', () => {
    expect(resolveInCityRoute({ ...args, classification: null }).path).toBe('/booking/trip-type')
  })
})

describe('Outstation tile / search (no declared ride type)', () => {
  const args = { rideTypeDeclared: false, rideType: 'one_way' as const, tripMode: 'standard' as const }

  it('an in-city trip becomes a city ride with a toast when City ride is on', () => {
    expect(resolveInCityRoute({ ...args, classification: IN_CITY_ON })).toEqual({
      path: '/booking/fare', rideType: 'one_way', rideTypeDeclared: true, tripMode: 'city', toast: 'to_city',
    })
  })

  it('an in-city trip becomes a rental when City ride is off, as today', () => {
    expect(resolveInCityRoute({ ...args, classification: IN_CITY_OFF })).toMatchObject({ path: '/booking/rental', rideType: 'rental', toast: 'to_rental' })
  })

  it('a trip that leaves the city opens the Outstation chooser (One way / Round trip), no toast', () => {
    expect(resolveInCityRoute({ ...args, classification: OUTSIDE })).toEqual({
      path: '/booking/trip-type', rideType: 'one_way', rideTypeDeclared: false, tripMode: 'standard', toast: null,
    })
  })
})

describe('declared outstation and rental choices keep working', () => {
  it('a declared round trip inside the city still goes to Rental (never offered inside the city)', () => {
    expect(resolveInCityRoute({ rideTypeDeclared: true, rideType: 'round_trip', tripMode: 'standard', classification: IN_CITY_ON }))
      .toMatchObject({ path: '/booking/rental', rideType: 'rental', toast: 'to_rental' })
  })

  it('a declared one-way inside the city becomes a city ride when it is on', () => {
    expect(resolveInCityRoute({ rideTypeDeclared: true, rideType: 'one_way', tripMode: 'standard', classification: IN_CITY_ON }))
      .toMatchObject({ path: '/booking/fare', tripMode: 'city', toast: 'to_city' })
  })

  it('declared one-way and round trip outside the city go to their own screens', () => {
    expect(resolveInCityRoute({ rideTypeDeclared: true, rideType: 'one_way', tripMode: 'standard', classification: OUTSIDE }))
      .toEqual({ path: '/booking/fare', rideType: 'one_way', rideTypeDeclared: true, tripMode: 'standard', toast: null })
    expect(resolveInCityRoute({ rideTypeDeclared: true, rideType: 'round_trip', tripMode: 'standard', classification: OUTSIDE }))
      .toMatchObject({ path: '/booking/round-trip', rideType: 'round_trip', tripMode: 'standard', toast: null })
  })

  it('Rental inside the city is unchanged, and outside the city is sent to One Way with a toast', () => {
    expect(resolveInCityRoute({ rideTypeDeclared: true, rideType: 'rental', tripMode: 'standard', classification: IN_CITY_ON }))
      .toEqual({ path: '/booking/rental', rideType: 'rental', rideTypeDeclared: true, tripMode: 'standard', toast: null })
    expect(resolveInCityRoute({ rideTypeDeclared: true, rideType: 'rental', tripMode: 'standard', classification: OUTSIDE }))
      .toEqual({ path: '/booking/fare', rideType: 'one_way', rideTypeDeclared: true, tripMode: 'standard', toast: 'to_one_way' })
  })
})
