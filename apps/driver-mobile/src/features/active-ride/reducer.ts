// One reducer keyed by server-confirmed ride status, with a single pending-
// optimistic overlay field -- replaces what would otherwise be four independent
// ad-hoc booleans for arrived/start-otp/end-otp/collect-cash (Eng review
// hidden-complexity finding). On any lifecycle POST rejection, the caller
// dispatches 'reverted', which clears the overlay and falls back to rendering
// confirmedStatus -- the UI never shows an unconfirmed state indefinitely.
export type RideStatus = 'accepted' | 'driver_arrived' | 'in_progress' | 'completed'

export type ActiveRideReducerState = {
  confirmedStatus: RideStatus
  pendingOptimisticStatus: RideStatus | null
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
      return { confirmedStatus: action.status, pendingOptimisticStatus: null }
    case 'reverted':
      return { ...state, pendingOptimisticStatus: null }
  }
}

export function displayStatus(state: ActiveRideReducerState): RideStatus {
  return state.pendingOptimisticStatus ?? state.confirmedStatus
}
