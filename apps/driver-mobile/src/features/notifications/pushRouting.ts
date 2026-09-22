// Maps an FCM data payload's `type` (api/src/modules/notifications/notifications.service.ts's
// notifyOwner()/sendRideRequestPushOnce(), plus ride-chat.service.ts's own direct
// pushToTokens call) to a driver-mobile in-app route. Deliberately ignores the
// backend's `payload.path`/`payload.route` fields -- those are Next.js web-app
// paths (e.g. '/profile/documents' on the web driver app), not expo-router
// routes, and would 404 if navigated to directly here. Routing is keyed on
// `type` alone so this stays correct regardless of what the web apps' paths are.
//
// Full inventory of driver-owned push types, verified against every
// notifyOwner/notifyAllAdmins/pushToTokens call site in api/src (2026-09-22):
// ride_request, ride_manual_request, ride_force_assigned, stop_added,
// ride_chat_message, document_rejected, document_expiring, document_expired,
// profile_corrected, vehicle_corrected, account_suspended, driver_warning,
// session_ended_stale, wallet_low_balance.
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
      return null

    // Already-accepted rides -- no offer UI to show, go straight to the ride.
    case 'ride_force_assigned':
    case 'stop_added':
      return rideId ? `/active-ride/${rideId}` : null

    case 'ride_chat_message':
      return rideId ? `/active-ride/${rideId}/chat` : null

    case 'document_rejected':
    case 'document_expiring':
    case 'document_expired':
      return '/onboarding/documents'

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

    default:
      return null
  }
}
