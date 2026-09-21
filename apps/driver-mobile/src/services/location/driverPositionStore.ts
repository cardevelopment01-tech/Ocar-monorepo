import { create } from 'zustand'

export type DriverPosition = { lat: number; lng: number; heading?: number; speed?: number }

// Locked during /plan-design-review: a frozen marker that still LOOKS live
// is more misleading than one that visibly says "signal lost" -- 15s chosen
// as long enough to absorb normal GPS jitter/tunnel dropouts on the existing
// 3s-interval background task (backgroundTask.ts's timeInterval), short
// enough that a rider/driver isn't staring at a stale pin for a minute.
export const STALE_AFTER_MS = 15_000

interface DriverPositionState {
  position: DriverPosition | null
  lastUpdatedAt: number | null
  isStale: boolean
  _staleTimer: ReturnType<typeof setTimeout> | null
  setPosition: (position: DriverPosition) => void
  // Locked during follow-up /plan-eng-review: the staleness check lives in
  // ONE timer here, not duplicated per subscribing map screen (stages 2/4).
  startStaleWatch: () => void
  stopStaleWatch: () => void
  reset: () => void
}

export const useDriverPositionStore = create<DriverPositionState>()((set, get) => ({
  position: null,
  lastUpdatedAt: null,
  isStale: false,
  _staleTimer: null,

  setPosition: (position) => {
    const { _staleTimer } = get()
    if (_staleTimer) clearTimeout(_staleTimer)
    set({ position, lastUpdatedAt: Date.now(), isStale: false, _staleTimer: null })
  },

  startStaleWatch: () => {
    const { _staleTimer } = get()
    if (_staleTimer) clearTimeout(_staleTimer)
    const timer = setTimeout(() => set({ isStale: true }), STALE_AFTER_MS)
    set({ _staleTimer: timer })
  },

  stopStaleWatch: () => {
    const { _staleTimer } = get()
    if (_staleTimer) clearTimeout(_staleTimer)
    set({ _staleTimer: null })
  },

  reset: () => {
    const { _staleTimer } = get()
    if (_staleTimer) clearTimeout(_staleTimer)
    set({ position: null, lastUpdatedAt: null, isStale: false, _staleTimer: null })
  },
}))
