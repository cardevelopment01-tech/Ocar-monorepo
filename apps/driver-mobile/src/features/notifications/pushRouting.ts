// Maps an FCM data payload's `type` (api/src/modules/notifications/notifications.service.ts's
// notifyOwner()/sendRideRequestPushOnce(), plus ride-chat.service.ts's own direct
// pushToTokens call) to a driver-mobile in-app route. Deliberately ignores the
// backend's `payload.path`/`payload.route` fields -- those are Next.js web-app
// paths (e.g. '/profile/documents' on the web driver app), not expo-router
// routes, and would 404 if navigated to directly here. Routing is keyed on
// `type` alone so this stays correct regardless of what the web apps' paths are.
//
// Full inventory of driver-owned push types, verified against every
// notifyOwner/notifyAllAdmins/pushToTokens call site in api/src (2026-09-28):
// ride_request, ride_manual_request, ride_force_assigned, stop_added,
// pickup_updated, trip_window_ending, trip_window_ended, ride_chat_message, document_rejected, document_expiring,
// document_expired, profile_corrected, vehicle_corrected, account_suspended,
// driver_warning, session_ended_stale, wallet_low_balance.
// The screens an admin broadcast can ask a tap to open (BROADCAST_LINKS.driver in the API). A key this app does not know falls
// through to the notification center (see resolveTapRoute).
const BROADCAST_ROUTES: Record<string, string> = {
  home: '/(tabs)/home',
  wallet: '/wallet',
  earnings: '/(tabs)/earnings',
  documents: '/documents',
}

export function resolvePushRoute(data: Record<string, string> | undefined): string | null {
  const type = data?.['type']
  if (!type) return null
  const rideId = data?.['rideId']

  switch (type) {
    // Pending ride offers -- deliberately NOT navigated. The root-mounted
    // RideRequestOverlay (features/ride-requests) already shows these live
    // over the socket, and the backend replays any still-pending assignment
    // to a freshly (re)connected socket on its own (socket.server.ts's
    // getPendingAssignmentsForDriver call in the connection handler) --
    // simply bringing the app to the foreground is already sufficient. A
    // navigation here would fight the overlay for the screen.
    case 'ride_request':
    case 'ride_manual_request':
    case 'ride_request_gone':
      return null

    // Already-accepted rides -- no offer UI to show, go straight to the ride.
    case 'ride_force_assigned':
    case 'stop_added':
    case 'pickup_updated':
    // Booked-time nudges go to the driver as well as the rider; the trip clock lives on this screen.
    case 'trip_window_ending':
    case 'trip_window_ended':
      return rideId ? `/active-ride/${rideId}` : null

    // A booking an admin reserved for this driver, its reminders, and it being taken off them: the upcoming-bookings screen has all three.
    case 'advance_reserved':
    case 'advance_reserve_reminder':
    case 'advance_reserve_released':
      return '/reservations'

    // The ride is over; nothing to open on it. Home shows the driver's current state.
    case 'ride_cancelled':
      return '/(tabs)/home'

    case 'ride_chat_message':
      return rideId ? `/active-ride/${rideId}/chat` : null

    case 'document_rejected':
    case 'document_expiring':
    case 'document_expired':
      // Standalone screen (not the onboarding wizard route), an active driver fixing one flagged
      // document shouldn't be dropped into 'Step 3 of 4' wizard chrome.
      return '/documents'

    case 'wallet_low_balance':
      return '/wallet'

    case 'profile_corrected':
      return '/(tabs)/profile'

    // ponytail: no dedicated vehicle-management screen exists in driver-mobile
    // yet (only the onboarding-time vehicle step) -- routes to profile as the
    // closest existing screen. Upgrade to a real vehicle detail route if one
    // ever gets built.
    case 'vehicle_corrected':
      return '/(tabs)/profile'

    // No screen naturally represents these -- the home screen's own status
    // banners already surface suspension/warning state, and there's nothing
    // for session_ended_stale to deep-link to. Bringing the app to the
    // foreground (default OS tap behavior) is enough.
    case 'account_suspended':
    case 'driver_warning':
    case 'session_ended_stale':
      return null

    // Admin broadcasts: the screen the admin chose, else (via resolveTapRoute) the notification center.
    case 'announcement':
    case 'offer': {
      const link = data?.['link']
      return link ? (BROADCAST_ROUTES[link] ?? null) : null
    }

    // "You're paused": the home screen is where the tracking card says what is wrong and how to fix it.
    case 'idle_paused':
      return '/(tabs)/home'

    default:
      return null
  }
}

// What a push/notification TAP should do: the type's own screen, else the notification
// center for any type we have no screen for (so a tap is never a dead end). Ride offers
// are the one deliberate exception -- the live overlay owns them (see resolvePushRoute).
export function resolveTapRoute(data: Record<string, string> | undefined): string | null {
  const type = data?.['type']
  if (type === 'ride_request' || type === 'ride_manual_request' || type === 'ride_request_gone') return null
  return resolvePushRoute(data) ?? (type ? '/notifications' : null)
}

/**
 * How a notification is presented while the app is open. A ride request that arrives as a push for the request whose pop-up is already
 * on screen (the socket delivered it first; the push is the late fallback after an unacknowledged 4 s) must be silent and bannerless: the
 * pop-up already rings and reads it aloud, and the push's 22 s alarm ring would play over that voice. Not shown at all rather than listed,
 * so no stale "New ride request" is left in the tray. A request that is NOT on screen still rings: that is the push doing its job.
 * `ride_request_gone` is the silent swap for a ringing push that is over.
 */
export function foregroundPresentation(
  data: Record<string, unknown> | undefined,
  pendingRideId: string | null,
): { banner: boolean; list: boolean; sound: boolean } {
  const type = data?.['type']
  if (type === 'ride_request_gone') return { banner: false, list: false, sound: false }
  const isRequest = type === 'ride_request' || type === 'ride_manual_request'
  if (isRequest && pendingRideId != null && String(data?.['rideId']) === pendingRideId) return { banner: false, list: false, sound: false }
  return { banner: true, list: true, sound: true }
}
