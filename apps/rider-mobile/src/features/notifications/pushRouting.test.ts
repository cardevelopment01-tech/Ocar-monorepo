import { describe, expect, it } from 'vitest'
import { resolvePushRoute, resolveTapRoute } from './pushRouting'

describe('resolvePushRoute (rider-mobile)', () => {
  it('routes ride_accepted/ride_completed to the ride tracking screen', () => {
    expect(resolvePushRoute({ type: 'ride_accepted', rideId: '7' })).toBe('/ride/7')
    expect(resolvePushRoute({ type: 'ride_completed', rideId: '7' })).toBe('/ride/7')
  })

  it('routes ride_chat_message into the chat sub-screen', () => {
    expect(resolvePushRoute({ type: 'ride_chat_message', rideId: '7' })).toBe('/ride/7/chat')
  })

  it('routes payment_failed to the ride screen (no payment-retry screen exists)', () => {
    expect(resolvePushRoute({ type: 'payment_failed', rideId: '7' })).toBe('/ride/7')
  })

  it('does not navigate when a ride-scoped type is missing rideId', () => {
    expect(resolvePushRoute({ type: 'ride_accepted' })).toBeNull()
    expect(resolvePushRoute({ type: 'ride_chat_message' })).toBeNull()
    expect(resolvePushRoute({ type: 'payment_failed' })).toBeNull()
  })

  it('opens the ride for every advance-booking notice', () => {
    for (const type of ['advance_booked', 'advance_reminder', 'advance_rescheduled', 'advance_searching', 'advance_cancelled', 'advance_no_drivers']) {
      expect(resolvePushRoute({ type, rideId: '9' })).toBe('/ride/9')
    }
  })

  it('does not navigate for an advance notice with no ride, except the no-driver one which falls back to Home', () => {
    expect(resolvePushRoute({ type: 'advance_reminder' })).toBeNull()
    expect(resolvePushRoute({ type: 'advance_no_drivers' })).toBe('/(tabs)/home')
  })

  it('returns null for an unknown or missing type instead of throwing', () => {
    expect(resolvePushRoute({ type: 'something_new' })).toBeNull()
    expect(resolvePushRoute(undefined)).toBeNull()
    expect(resolvePushRoute({})).toBeNull()
  })

  it('routes the ride lifecycle pushes to the ride screen (or Home when no driver was found)', () => {
    for (const type of ['driver_arrived', 'ride_started', 'ride_cancelled', 'stop_unreachable', 'trip_window_ending']) {
      expect(resolvePushRoute({ type, rideId: '9' })).toBe('/ride/9')
    }
    expect(resolvePushRoute({ type: 'ride_no_drivers', rideId: '9' })).toBe('/(tabs)/home')
  })

  it('a broadcast opens the screen the admin chose; one without a screen, or with a key this app does not know, just opens the app', () => {
    expect(resolveTapRoute({ type: 'offer', link: 'offers' })).toBe('/offers')
    expect(resolveTapRoute({ type: 'announcement', link: 'trips' })).toBe('/(tabs)/trips')
    expect(resolveTapRoute({ type: 'offer', link: 'home' })).toBe('/(tabs)/home')
    expect(resolveTapRoute({ type: 'offer' })).toBeNull()
    expect(resolveTapRoute({ type: 'offer', link: 'wallet' })).toBeNull() // a driver screen, not a rider one
    expect(resolveTapRoute({ type: 'offer', link: '../../admin' })).toBeNull() // a key, never a path
    expect(resolveTapRoute({ type: 'ride_accepted', rideId: '7', link: 'offers' })).toBe('/ride/7') // link only matters for broadcasts
  })

  it('a tap on a type with no screen (an offer or announcement sent without one) just opens the app', () => {
    expect(resolveTapRoute({ type: 'something_new' })).toBeNull()
    expect(resolveTapRoute({ type: 'offer' })).toBeNull()
    expect(resolveTapRoute({ type: 'driver_arrived', rideId: '9' })).toBe('/ride/9')
    expect(resolveTapRoute({})).toBeNull()
  })
})
