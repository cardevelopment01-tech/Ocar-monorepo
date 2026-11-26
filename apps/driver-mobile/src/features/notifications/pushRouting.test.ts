import { describe, expect, it } from 'vitest'
import { foregroundPresentation, resolvePushRoute, resolveTapRoute } from './pushRouting'

describe('resolvePushRoute (driver-mobile)', () => {
  it('returns null for pending ride offers -- handled live by the socket overlay', () => {
    expect(resolvePushRoute({ type: 'ride_request', rideId: '1' })).toBeNull()
    expect(resolvePushRoute({ type: 'ride_manual_request', rideId: '1' })).toBeNull()
  })

  it('routes already-active-ride types straight to the active-ride screen', () => {
    expect(resolvePushRoute({ type: 'ride_force_assigned', rideId: '42' })).toBe('/active-ride/42')
    // a reserved advance booking, its reminders and being taken off the driver all open the upcoming-bookings screen
    for (const type of ['advance_reserved', 'advance_reserve_reminder', 'advance_reserve_released']) {
      expect(resolvePushRoute({ type, rideId: '42' })).toBe('/reservations')
      expect(resolveTapRoute({ type, rideId: '42' })).toBe('/reservations')
    }
    expect(resolvePushRoute({ type: 'stop_added', rideId: '42' })).toBe('/active-ride/42')
    expect(resolvePushRoute({ type: 'pickup_updated', rideId: '42' })).toBe('/active-ride/42')
  })

  it('opens the active ride for booked-time nudges, which are sent to the driver too', () => {
    expect(resolvePushRoute({ type: 'trip_window_ending', rideId: '42' })).toBe('/active-ride/42')
    expect(resolvePushRoute({ type: 'trip_window_ended', rideId: '42' })).toBe('/active-ride/42')
    expect(resolveTapRoute({ type: 'trip_window_ended' })).toBe('/notifications')
  })

  it('routes chat notifications into the chat sub-screen', () => {
    expect(resolvePushRoute({ type: 'ride_chat_message', rideId: '42' })).toBe('/active-ride/42/chat')
  })

  it('does not navigate when a ride-scoped type is missing rideId', () => {
    expect(resolvePushRoute({ type: 'stop_added' })).toBeNull()
    expect(resolvePushRoute({ type: 'ride_chat_message' })).toBeNull()
  })

  it('routes document notifications to the documents screen', () => {
    expect(resolvePushRoute({ type: 'document_rejected' })).toBe('/documents')
    expect(resolvePushRoute({ type: 'kyc_reminder' })).toBe('/') // opens the app root, which resumes the saved onboarding step
    expect(resolvePushRoute({ type: 'document_expiring' })).toBe('/documents')
    expect(resolvePushRoute({ type: 'document_expired' })).toBe('/documents')
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
    expect(resolvePushRoute({ type: 'idle_paused' })).toBe('/(tabs)/home')
  })

  it('returns null for an unknown or missing type instead of throwing', () => {
    expect(resolvePushRoute({ type: 'something_new' })).toBeNull()
    expect(resolvePushRoute(undefined)).toBeNull()
    expect(resolvePushRoute({})).toBeNull()
  })

  it('ignores the backend-provided path/route fields -- those are web paths, not mobile routes', () => {
    expect(resolvePushRoute({ type: 'wallet_low_balance', path: '/wallet-web-only' })).toBe('/wallet')
  })

  it('sends a cancelled ride back to Home', () => {
    expect(resolvePushRoute({ type: 'ride_cancelled', rideId: '9' })).toBe('/(tabs)/home')
  })

  it('a broadcast opens the screen the admin chose; with none, or one this app does not know, the notification center', () => {
    expect(resolveTapRoute({ type: 'announcement', link: 'documents' })).toBe('/documents')
    expect(resolveTapRoute({ type: 'offer', link: 'wallet' })).toBe('/wallet')
    expect(resolveTapRoute({ type: 'announcement', link: 'earnings' })).toBe('/(tabs)/earnings')
    expect(resolveTapRoute({ type: 'announcement', link: 'home' })).toBe('/(tabs)/home')
    expect(resolveTapRoute({ type: 'announcement' })).toBe('/notifications')
    expect(resolveTapRoute({ type: 'announcement', link: 'offers' })).toBe('/notifications') // a rider screen
    expect(resolveTapRoute({ type: 'announcement', link: '../../x' })).toBe('/notifications')
    expect(resolveTapRoute({ type: 'ride_force_assigned', rideId: '9', link: 'wallet' })).toBe('/active-ride/9')
  })

  it('a tap falls back to the notification center, except for live ride offers', () => {
    expect(resolveTapRoute({ type: 'account_suspended' })).toBe('/notifications')
    expect(resolveTapRoute({ type: 'something_new' })).toBe('/notifications')
    expect(resolveTapRoute({ type: 'ride_request', rideId: '9' })).toBeNull()
    expect(resolveTapRoute({})).toBeNull()
  })
})

describe('ride_request_gone (the silent replacement for a ride request that is over)', () => {
  it('goes nowhere on arrival and on tap', () => {
    expect(resolvePushRoute({ type: 'ride_request_gone', rideId: '5' })).toBeNull()
    expect(resolveTapRoute({ type: 'ride_request_gone', rideId: '5' })).toBeNull()
  })
})

describe('foregroundPresentation (how a push shows while the app is open)', () => {
  const SHOWN = { banner: true, list: true, sound: true }
  const SILENT = { banner: false, list: false, sound: false }

  it('a ride request push for the request already on screen is silent and not shown: the pop-up rings and reads it, the push must not ring over the voice', () => {
    expect(foregroundPresentation({ type: 'ride_request', rideId: '42' }, '42')).toEqual(SILENT)
    expect(foregroundPresentation({ type: 'ride_manual_request', rideId: '42' }, '42')).toEqual(SILENT)
    expect(foregroundPresentation({ type: 'ride_request', rideId: 42 }, '42')).toEqual(SILENT) // an id sent as a number still matches
  })

  it('a ride request push that is NOT on screen still rings: that is the push doing its job', () => {
    expect(foregroundPresentation({ type: 'ride_request', rideId: '42' }, null)).toEqual(SHOWN)
    expect(foregroundPresentation({ type: 'ride_request', rideId: '42' }, '7')).toEqual(SHOWN) // another request is on screen
    expect(foregroundPresentation({ type: 'ride_request' }, '42')).toEqual(SHOWN) // no ride id: cannot be the one on screen
  })

  it('every other notification is presented as before, even with a request on screen', () => {
    expect(foregroundPresentation({ type: 'ride_chat_message', rideId: '42' }, '42')).toEqual(SHOWN)
    expect(foregroundPresentation({ type: 'stop_added', rideId: '42' }, '42')).toEqual(SHOWN)
    expect(foregroundPresentation({ type: 'ring_test' }, null)).toEqual(SHOWN)
    expect(foregroundPresentation(undefined, null)).toEqual(SHOWN)
  })

  it('"ride request ended" stays the silent swap it was', () => {
    expect(foregroundPresentation({ type: 'ride_request_gone', rideId: '42' }, null)).toEqual(SILENT)
    expect(foregroundPresentation({ type: 'ride_request_gone', rideId: '42' }, '42')).toEqual(SILENT)
  })
})
