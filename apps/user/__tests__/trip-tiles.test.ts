import { describe, it, expect } from 'vitest'
import { TRIP_TILES, searchParamsForTile } from '../lib/trip-tiles'

describe('the three home tiles', () => {
  it('are Outstation, City Ride and Rental, in that order', () => {
    expect(TRIP_TILES.map(t => t.id)).toEqual(['outstation', 'city', 'rental'])
    expect(TRIP_TILES.map(t => t.label)).toEqual(['Outstation', 'City Ride', 'Rental'])
  })
})

describe('searchParamsForTile', () => {
  const origin = { lat: 20.29, lng: 85.82, address: 'Home' }

  it('Outstation declares no ride type: the trip is classified, then One way or Round trip is chosen', () => {
    const p = searchParamsForTile('outstation', origin)
    expect(p.has('rideType')).toBe(false)
    expect(p.has('tripMode')).toBe(false)
    expect(p.get('originAddress')).toBe('Home')
  })

  it('City Ride is a one-way in trip mode city', () => {
    const p = searchParamsForTile('city', origin)
    expect(p.get('rideType')).toBe('one_way')
    expect(p.get('tripMode')).toBe('city')
    expect(p.get('originLat')).toBe('20.29')
  })

  it('leaves the origin out until it is known', () => {
    const p = searchParamsForTile('city', null)
    expect(p.has('originLat')).toBe(false)
    expect(p.get('tripMode')).toBe('city')
  })
})
