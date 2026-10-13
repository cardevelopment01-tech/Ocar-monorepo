// Maps an FCM data payload's `type` (api/src/modules/notifications/notifications.service.ts's
// notifyOwner(), plus ride-chat.service.ts's own direct pushToTokens call) to
// a rider-mobile in-app route.
//
// Full inventory of user-owned push types, verified against every notifyOwner
// call site in api/src: ride_accepted, driver_arrived, ride_started, ride_completed,
// ride_cancelled, ride_no_drivers, payment_failed, stop_unreachable, trip_window_*,
// ride_chat_message.
export function resolvePushRoute(data: Record<string, string> | undefined): string | null {
  const type = data?.['type']
  if (!type) return null
  const rideId = data?.['rideId']

  switch (type) {
    case 'ride_accepted':
    case 'driver_arrived':
    case 'ride_started':
    case 'ride_completed':
    case 'ride_cancelled':
    case 'stop_unreachable':
    case 'trip_window_ending':
    case 'trip_window_ended':
      return rideId ? `/ride/${rideId}` : null

    // The booking didn't land a driver -- nothing ride-specific to open, back to Home to rebook.
    case 'ride_no_drivers':
      return '/(tabs)/home'

    case 'ride_chat_message':
      return rideId ? `/ride/${rideId}/chat` : null

    // No dedicated payment-retry or wallet screen exists in rider-mobile
    // (cash-only for now, per CLAUDE.md's Known UI Caveats) -- the ride
    // screen itself is the most relevant context a failed-payment push can
    // land on. Revisit if a payment retry flow ever ships.
    case 'payment_failed':
      return rideId ? `/ride/${rideId}` : null

    default:
      return null
  }
}

// What a push/notification TAP should do: the type's own screen. There is no in-app notification
// list in the rider app (ride updates live on the ride and Trips screens), so a type with no screen
// (offers, announcements) just opens the app.
export function resolveTapRoute(data: Record<string, string> | undefined): string | null {
  return resolvePushRoute(data)
}
