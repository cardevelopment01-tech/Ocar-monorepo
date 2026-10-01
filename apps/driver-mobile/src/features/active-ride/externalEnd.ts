export type ExternalEndInfo = { resolvedBy?: string; reason?: string; cancelledBy?: string }

// Ride ended by someone other than this driver's own in-screen action: rider/system cancel,
// admin or sweeper force-resolve, or an admin force-assign being reverted. Mirrors web's
// resolveRideExternally (apps/driver/src/App.tsx). Returns the message to show, or null when
// the update is part of the normal flow -- including the driver's own cancel (the cancel
// handler navigates itself) and a plain `completed` (verifyEndOtp never sets resolvedBy).
export function externalEndMessage(status: string, info: ExternalEndInfo = {}): string | null {
  if (status === 'cancelled') {
    if (info.cancelledBy === 'driver') return null
    return info.cancelledBy === 'system' ? 'This ride was cancelled' : 'The rider cancelled this ride'
  }
  if (status === 'completed' && info.resolvedBy) {
    return info.resolvedBy === 'timeout'
      ? 'This trip was automatically ended due to inactivity'
      : 'This trip was ended by support'
  }
  if (status === 'requested' && info.reason === 'force_assign_reverted') {
    return 'This ride was reassigned to another driver'
  }
  return null
}
