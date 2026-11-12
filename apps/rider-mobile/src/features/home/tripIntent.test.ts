import { describe, expect, it } from 'vitest'
import { TRIP_INTENTS, draftForIntent } from './tripIntent'

describe('the three home tiles', () => {
  it('are Outstation, City Ride and Rental, in that order', () => {
    expect(TRIP_INTENTS.map((t) => t.intent)).toEqual(['outstation', 'city', 'rental'])
    expect(TRIP_INTENTS.map((t) => t.title)).toEqual(['Outstation', 'City Ride', 'Rental'])
  })
})

describe('draftForIntent', () => {
  it('Outstation declares no ride type: the trip is classified, then the rider picks One way or Round trip', () => {
    expect(draftForIntent('outstation')).toEqual({ rideType: 'one_way', declared: false, tripMode: 'standard' })
  })

  it('City Ride is a declared one-way ride in trip mode city', () => {
    expect(draftForIntent('city')).toEqual({ rideType: 'one_way', declared: true, tripMode: 'city' })
  })

  it('Rental is the hourly mode, as before', () => {
    expect(draftForIntent('rental')).toEqual({ rideType: 'rental', declared: true, tripMode: 'standard' })
  })
})
