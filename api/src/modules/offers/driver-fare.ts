/**
 * What a driver sees as the fare of a ride: the payable when a rider offer lowered it (review decision D20), else the
 * estimate. One definition for the request card, the broadcast, the reconnect replay and the admin assignment.
 */
export function driverFare(r: { cash_due?: string | null; driver_fare?: string | null; total_estimated?: string | null }): number {
  const v = r.cash_due ?? r.driver_fare ?? r.total_estimated
  return v != null ? parseFloat(v) : 0
}
