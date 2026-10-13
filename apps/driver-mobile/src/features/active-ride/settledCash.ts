import type { RideDetailSettled } from './useActiveRide'

/** What the completed-trip screen should show once the trip is over.
 *  null = cash still has to be collected (show the collection card);
 *  otherwise there is nothing left to collect and the summary can show.
 *  The ride record wins over this session's own result so a ride opened later (a stale notification,
 *  a relaunch) does not ask for cash that was already collected. */
export function settledCash(
  ride: Pick<RideDetailSettled, 'paymentChannel' | 'cashCollectedAt' | 'cashCollectedAmount'>,
  sessionResult: { collected: number } | null,
): { collected: number | null } | null {
  if (sessionResult) return sessionResult
  if (ride.cashCollectedAt) return { collected: parseFloat(ride.cashCollectedAmount ?? '0') }
  // Online and wallet rides have no cash to collect (the server rejects collect-cash with NOT_CASH_RIDE).
  if ((ride.paymentChannel ?? 'cash') !== 'cash') return { collected: null }
  return null
}
