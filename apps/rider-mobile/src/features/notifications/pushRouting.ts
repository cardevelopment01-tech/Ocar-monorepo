// Maps an FCM data payload's `type` (api/src/modules/notifications/notifications.service.ts's
// notifyOwner(), plus ride-chat.service.ts's own direct pushToTokens call) to
// a rider-mobile in-app route.
//
// Full inventory of user-owned push types, verified against every notifyOwner
// call site in api/src (2026-09-22): ride_accepted, ride_completed,
// payment_failed, ride_chat_message.
export function resolvePushRoute(data: Record<string, string> | undefined): string | null {
  const type = data?.['type']
  if (!type) return null
  const rideId = data?.['rideId']

  switch (type) {
    case 'ride_accepted':
    case 'ride_completed':
      return rideId ? `/ride/${rideId}` : null

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
