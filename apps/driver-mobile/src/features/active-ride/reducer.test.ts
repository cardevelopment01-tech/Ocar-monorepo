import { describe, expect, it } from 'vitest'
import { activeRideReducer, displayStatus, type ActiveRideReducerState } from './reducer'

const initial: ActiveRideReducerState = { confirmedStatus: 'accepted', pendingOptimisticStatus: null, rideType: 'one_way' }

describe('activeRideReducer', () => {
  it('shows the optimistic status immediately on advance', () => {
    const state = activeRideReducer(initial, { type: 'optimistic_advance', to: 'driver_arrived' })
    expect(displayStatus(state)).toBe('driver_arrived')
  })

  it('promotes the optimistic status to confirmed and clears the overlay on success', () => {
    let state = activeRideReducer(initial, { type: 'optimistic_advance', to: 'driver_arrived' })
    state = activeRideReducer(state, { type: 'confirmed', status: 'driver_arrived' })
    expect(state).toEqual({ confirmedStatus: 'driver_arrived', pendingOptimisticStatus: null, rideType: 'one_way' })
  })

  it('reverts to the last confirmed status on rejection, never leaving the UI on an unconfirmed state', () => {
    let state = activeRideReducer(initial, { type: 'optimistic_advance', to: 'driver_arrived' })
    state = activeRideReducer(state, { type: 'reverted' })
    expect(displayStatus(state)).toBe('accepted')
    expect(state.pendingOptimisticStatus).toBeNull()
  })

  it('walks the full lifecycle: accepted -> driver_arrived -> in_progress -> completed', () => {
    let state = initial
    for (const status of ['driver_arrived', 'in_progress', 'completed'] as const) {
      state = activeRideReducer(state, { type: 'optimistic_advance', to: status })
      state = activeRideReducer(state, { type: 'confirmed', status })
      expect(displayStatus(state)).toBe(status)
    }
  })
})

describe('activeRideReducer: new round_trip returning status', () => {
  it('walks in_progress -> returning -> completed for a round_trip ride', () => {
    let state: ActiveRideReducerState = { confirmedStatus: 'in_progress', pendingOptimisticStatus: null, rideType: 'round_trip' }
    state = activeRideReducer(state, { type: 'confirmed', status: 'returning' })
    expect(displayStatus(state)).toBe('returning')
    state = activeRideReducer(state, { type: 'confirmed', status: 'completed' })
    expect(displayStatus(state)).toBe('completed')
  })

  it('rideType is preserved unchanged across every transition', () => {
    let state: ActiveRideReducerState = { confirmedStatus: 'accepted', pendingOptimisticStatus: null, rideType: 'rental' }
    state = activeRideReducer(state, { type: 'optimistic_advance', to: 'driver_arrived' })
    expect(state.rideType).toBe('rental')
    state = activeRideReducer(state, { type: 'reverted' })
    expect(state.rideType).toBe('rental')
  })
})

describe('activeRideReducer: confirmed action can optionally update rideType', () => {
  it('updates rideType when the confirmed action provides one', () => {
    const state: ActiveRideReducerState = { confirmedStatus: 'accepted', pendingOptimisticStatus: null, rideType: '' }
    const next = activeRideReducer(state, { type: 'confirmed', status: 'driver_arrived', rideType: 'round_trip' })
    expect(next.rideType).toBe('round_trip')
  })

  it('leaves rideType unchanged when the confirmed action omits it', () => {
    const state: ActiveRideReducerState = { confirmedStatus: 'driver_arrived', pendingOptimisticStatus: null, rideType: 'round_trip' }
    const next = activeRideReducer(state, { type: 'confirmed', status: 'in_progress' })
    expect(next.rideType).toBe('round_trip')
  })
})
