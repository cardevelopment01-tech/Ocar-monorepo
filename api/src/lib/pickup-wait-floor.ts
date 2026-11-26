// Waiting at the pickup is charged for the rider's wait, not for a driver being early. For an advance booking the wait clock therefore cannot
// start before the pickup time the rider booked: a driver who arrives 15 minutes early and waits has not made the rider wait. Ordinary rides
// have no booked time (scheduled_for is NULL), so nothing changes for them.
//
// Returned as an optional trailing argument for repo.getPickupWaitMinutes / getPickupWaitStartedAt, so a ride with no booked time calls
// them exactly as before.
export function pickupWaitFloor(ride: { scheduled_for?: string | Date | null }): [] | [Date] {
  if (!ride.scheduled_for) return []
  const at = new Date(ride.scheduled_for)
  return Number.isNaN(at.getTime()) ? [] : [at]
}
