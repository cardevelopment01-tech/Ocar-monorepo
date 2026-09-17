import { create } from 'zustand'
import type { PendingRideRequest, RideRequestPayload } from '@/features/ride-requests/types'

interface RideRequestState {
  pending: PendingRideRequest | null
  setPending: (payload: RideRequestPayload) => void
  // Optional rideId guard: a stale ride:request_expired event for a since-replaced
  // request must not clear the newer one that's now showing.
  clearPending: (rideId?: string) => void
}

export const useRideRequestStore = create<RideRequestState>()((set, get) => ({
  pending: null,

  setPending: (payload) => set({ pending: { ...payload, receivedAtMs: Date.now() } }),

  clearPending: (rideId) => {
    if (rideId && get().pending?.rideId !== rideId) return
    set({ pending: null })
  },
}))
