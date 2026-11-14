import { describe, it, expect, vi, beforeEach } from 'vitest'

const loc = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  has: vi.fn(async () => true),
}))
vi.mock('expo-location', () => ({
  Accuracy: { High: 5, Balanced: 3 },
  startLocationUpdatesAsync: loc.start,
  stopLocationUpdatesAsync: loc.stop,
  hasStartedLocationUpdatesAsync: loc.has,
}))
vi.mock('expo-task-manager', () => ({ defineTask: vi.fn() }))
vi.mock('./locationSync', () => ({ emitLocationTick: vi.fn(), emitHeartbeat: vi.fn(async () => undefined) }))
vi.mock('./driverPositionStore', () => ({ useDriverPositionStore: { getState: () => ({ setPosition: vi.fn() }) } }))
vi.mock('@/services/location/persistedSession', () => ({ persistSessionId: vi.fn(), clearPersistedSessionId: vi.fn() }))

import { startBackgroundTracking } from './backgroundTask'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'

// Value: protects=a tracking start that finishes after the driver went offline stops again instead of leaving the foreground service
// running for an offline driver (the start takes seconds on a real phone and Go online no longer waits for it); fails_when=the
// "still online?" check after the start is removed; why_new=Go online used to hold the screen until the start finished, so the race could
// not happen; seam=none (expo-location is mocked); no_claim=that the Android service really stops.
describe('startBackgroundTracking after going offline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDriverSessionStore.getState().setOffline()
  })

  it('leaves tracking running for a driver who is still online', async () => {
    useDriverSessionStore.getState().setOnline({ id: 's1', vehicleId: 1, categoryId: 2 })
    await startBackgroundTracking()
    expect(loc.start).toHaveBeenCalledTimes(1)
    expect(loc.stop).not.toHaveBeenCalled()
  })

  it('stops again when the driver went offline while the start was in flight', async () => {
    useDriverSessionStore.getState().setOnline({ id: 's1', vehicleId: 1, categoryId: 2 })
    loc.start.mockImplementationOnce(async () => { useDriverSessionStore.getState().setOffline() })
    await startBackgroundTracking()
    expect(loc.stop).toHaveBeenCalledTimes(1)
  })
})
