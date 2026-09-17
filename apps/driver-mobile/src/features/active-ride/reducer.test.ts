import { describe, expect, it } from 'vitest'
import { activeRideReducer, displayStatus, type ActiveRideReducerState } from './reducer'

const initial: ActiveRideReducerState = { confirmedStatus: 'accepted', pendingOptimisticStatus: null }

describe('activeRideReducer', () => {
  it('shows the optimistic status immediately on advance', () => {
    const state = activeRideReducer(initial, { type: 'optimistic_advance', to: 'driver_arrived' })
    expect(displayStatus(state)).toBe('driver_arrived')
  })

  it('promotes the optimistic status to confirmed and clears the overlay on success', () => {
    let state = activeRideReducer(initial, { type: 'optimistic_advance', to: 'driver_arrived' })
    state = activeRideReducer(state, { type: 'confirmed', status: 'driver_arrived' })
    expect(state).toEqual({ confirmedStatus: 'driver_arrived', pendingOptimisticStatus: null })
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
