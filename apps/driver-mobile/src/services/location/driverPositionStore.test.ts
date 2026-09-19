import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDriverPositionStore, STALE_AFTER_MS } from './driverPositionStore'

describe('useDriverPositionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useDriverPositionStore.getState().reset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with no position and not stale', () => {
    const state = useDriverPositionStore.getState()
    expect(state.position).toBeNull()
    expect(state.isStale).toBe(false)
  })

  it('setPosition records the position and lastUpdatedAt, and clears staleness', () => {
    useDriverPositionStore.getState().setPosition({ lat: 20.29, lng: 85.82 })
    const state = useDriverPositionStore.getState()
    expect(state.position).toEqual({ lat: 20.29, lng: 85.82 })
    expect(state.lastUpdatedAt).toBe(Date.now())
    expect(state.isStale).toBe(false)
  })

  it('flips isStale to true after STALE_AFTER_MS with no new position', () => {
    useDriverPositionStore.getState().setPosition({ lat: 20.29, lng: 85.82 })
    useDriverPositionStore.getState().startStaleWatch()
    vi.advanceTimersByTime(STALE_AFTER_MS + 1000)
    expect(useDriverPositionStore.getState().isStale).toBe(true)
  })

  it('a fresh setPosition after going stale clears isStale again', () => {
    useDriverPositionStore.getState().setPosition({ lat: 20.29, lng: 85.82 })
    useDriverPositionStore.getState().startStaleWatch()
    vi.advanceTimersByTime(STALE_AFTER_MS + 1000)
    expect(useDriverPositionStore.getState().isStale).toBe(true)
    useDriverPositionStore.getState().setPosition({ lat: 20.3, lng: 85.83 })
    expect(useDriverPositionStore.getState().isStale).toBe(false)
  })
})
