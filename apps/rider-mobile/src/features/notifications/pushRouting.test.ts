import { describe, expect, it } from 'vitest'
import { resolvePushRoute } from './pushRouting'

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

  it('returns null for an unknown or missing type instead of throwing', () => {
    expect(resolvePushRoute({ type: 'something_new' })).toBeNull()
    expect(resolvePushRoute(undefined)).toBeNull()
    expect(resolvePushRoute({})).toBeNull()
  })
})
