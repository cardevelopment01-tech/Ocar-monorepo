import { describe, expect, it } from 'vitest'
import { resolvePushRoute } from './pushRouting'

describe('resolvePushRoute (driver-mobile)', () => {
  it('returns null for pending ride offers -- handled live by the socket overlay', () => {
    expect(resolvePushRoute({ type: 'ride_request', rideId: '1' })).toBeNull()
    expect(resolvePushRoute({ type: 'ride_manual_request', rideId: '1' })).toBeNull()
  })

  it('routes already-active-ride types straight to the active-ride screen', () => {
    expect(resolvePushRoute({ type: 'ride_force_assigned', rideId: '42' })).toBe('/active-ride/42')
    expect(resolvePushRoute({ type: 'stop_added', rideId: '42' })).toBe('/active-ride/42')
  })

  it('routes chat notifications into the chat sub-screen', () => {
    expect(resolvePushRoute({ type: 'ride_chat_message', rideId: '42' })).toBe('/active-ride/42/chat')
  })

  it('does not navigate when a ride-scoped type is missing rideId', () => {
    expect(resolvePushRoute({ type: 'stop_added' })).toBeNull()
    expect(resolvePushRoute({ type: 'ride_chat_message' })).toBeNull()
  })

  it('routes document notifications to the documents screen', () => {
    expect(resolvePushRoute({ type: 'document_rejected' })).toBe('/onboarding/documents')
    expect(resolvePushRoute({ type: 'document_expiring' })).toBe('/onboarding/documents')
    expect(resolvePushRoute({ type: 'document_expired' })).toBe('/onboarding/documents')
  })

  it('routes wallet and profile/vehicle correction notifications', () => {
    expect(resolvePushRoute({ type: 'wallet_low_balance' })).toBe('/wallet')
    expect(resolvePushRoute({ type: 'profile_corrected' })).toBe('/(tabs)/profile')
    expect(resolvePushRoute({ type: 'vehicle_corrected' })).toBe('/(tabs)/profile')
  })

  it('returns null for status-only types with no natural screen', () => {
    expect(resolvePushRoute({ type: 'account_suspended' })).toBeNull()
    expect(resolvePushRoute({ type: 'driver_warning' })).toBeNull()
    expect(resolvePushRoute({ type: 'session_ended_stale' })).toBeNull()
  })

  it('returns null for an unknown or missing type instead of throwing', () => {
    expect(resolvePushRoute({ type: 'something_new' })).toBeNull()
    expect(resolvePushRoute(undefined)).toBeNull()
    expect(resolvePushRoute({})).toBeNull()
  })

  it('ignores the backend-provided path/route fields -- those are web paths, not mobile routes', () => {
    expect(resolvePushRoute({ type: 'wallet_low_balance', path: '/wallet-web-only' })).toBe('/wallet')
  })
})
