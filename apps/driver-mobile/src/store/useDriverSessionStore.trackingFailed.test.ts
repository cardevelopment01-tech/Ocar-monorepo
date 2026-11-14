import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/location/persistedSession', () => ({ persistSessionId: vi.fn(), clearPersistedSessionId: vi.fn() }))

import { useDriverSessionStore } from './useDriverSessionStore'

// Value: protects=the "location tracking did not start" warning on Home is only ever shown for a driver who is online, and clears when they
// go offline; fails_when=the flag survives going offline (a stale warning on the next session); why_new=new state; seam=none;
// no_claim=how Home renders it.
describe('trackingFailed', () => {
  beforeEach(() => { useDriverSessionStore.getState().setOffline() })

  it('starts false and can be set and cleared', () => {
    expect(useDriverSessionStore.getState().trackingFailed).toBe(false)
    useDriverSessionStore.getState().setTrackingFailed(true)
    expect(useDriverSessionStore.getState().trackingFailed).toBe(true)
    useDriverSessionStore.getState().setTrackingFailed(false)
    expect(useDriverSessionStore.getState().trackingFailed).toBe(false)
  })

  it('is cleared when the driver goes offline', () => {
    useDriverSessionStore.getState().setOnline({ id: 's1', vehicleId: 1, categoryId: 2 })
    useDriverSessionStore.getState().setTrackingFailed(true)
    useDriverSessionStore.getState().setOffline()
    expect(useDriverSessionStore.getState().trackingFailed).toBe(false)
  })

  it('is cleared when a new session goes online', () => {
    useDriverSessionStore.getState().setTrackingFailed(true)
    useDriverSessionStore.getState().setOnline({ id: 's2', vehicleId: 1, categoryId: 2 })
    expect(useDriverSessionStore.getState().trackingFailed).toBe(false)
  })
})
