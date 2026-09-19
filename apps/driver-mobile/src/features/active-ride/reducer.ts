// One reducer keyed by server-confirmed ride status, with a single pending-
// optimistic overlay field -- replaces what would otherwise be four independent
// ad-hoc booleans for arrived/start-otp/end-otp/collect-cash (Eng review
// hidden-complexity finding). On any lifecycle POST rejection, the caller
// dispatches 'reverted', which clears the overlay and falls back to rendering
// confirmedStatus -- the UI never shows an unconfirmed state indefinitely.
//
//   accepted --markArrived--> driver_arrived --startOtp--> in_progress
//                                                                |
//                                        one_way/rental ---------+--------- round_trip
//                                              |                             |
//                                            endOtp                     returning --endOtp--> completed
//                                              |                             |
//                                              v                             v
//                                          completed                    (endOtp above)
//
// 'returning' added post-Day-10 (round-trip return leg) -- see
// docs/superpowers/specs/2026-09-19-post-day10-ride-flow-hardening-design.md.
export type RideStatus = 'accepted' | 'driver_arrived' | 'in_progress' | 'returning' | 'completed'

export type ActiveRideReducerState = {
  confirmedStatus: RideStatus
  pendingOptimisticStatus: RideStatus | null
  // Threaded from RideDetail.rideType (already fetched, never read until now).
  // 'one_way' | 'round_trip' | 'rental' in practice; kept as `string` here
  // to match RideDetail's own field type rather than re-declaring a union
  // that could drift from the shared type.
  rideType: string
}

export type ActiveRideReducerAction =
  | { type: 'optimistic_advance'; to: RideStatus }
  | { type: 'confirmed'; status: RideStatus }
  | { type: 'reverted' }

export function activeRideReducer(
  state: ActiveRideReducerState,
  action: ActiveRideReducerAction
): ActiveRideReducerState {
  switch (action.type) {
    case 'optimistic_advance':
      return { ...state, pendingOptimisticStatus: action.to }
    case 'confirmed':
      return { ...state, confirmedStatus: action.status, pendingOptimisticStatus: null }
    case 'reverted':
      return { ...state, pendingOptimisticStatus: null }
  }
}

export function displayStatus(state: ActiveRideReducerState): RideStatus {
  return state.pendingOptimisticStatus ?? state.confirmedStatus
}
