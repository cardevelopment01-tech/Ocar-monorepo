import { create } from 'zustand'
import type { PendingRideRequest, RideRequestPayload } from '@/features/ride-requests/types'

interface RideRequestState {
  pending: PendingRideRequest | null
  setPending: (payload: RideRequestPayload) => void
  // Optional rideId guard: a stale ride:request_expired event for a since-replaced
  // request must not clear the newer one that's now showing.
  clearPending: (rideId?: string) => void
}

// Offers this device has already shown (ride + round), so a re-delivery of the same offer -- the 2 s ack-check re-emit, the fallback push, a
// socket reconnect -- never restarts the countdown or re-rings a card the driver already answered or let lapse. A new round for the same ride
// is a genuinely new offer and shows. Memory only: after an app restart the server's reconnect sync shows what is still open.
const seenOffers = new Set<string>()
const SEEN_LIMIT = 50
const offerKey = (p: RideRequestPayload) => `${p.rideId}:${p.offerRound ?? 'x'}`

export function resetSeenOffers(): void { seenOffers.clear() }

export const useRideRequestStore = create<RideRequestState>()((set, get) => ({
  pending: null,

  setPending: (payload) => {
    // Servers that send no round cannot be told apart, so they keep the old behaviour (every delivery shows).
    if (payload.offerRound !== undefined) {
      const key = offerKey(payload)
      if (seenOffers.has(key)) return
      seenOffers.add(key)
      if (seenOffers.size > SEEN_LIMIT) seenOffers.delete(seenOffers.values().next().value as string)
    }
    set({ pending: { ...payload, receivedAtMs: Date.now() } })
  },

  clearPending: (rideId) => {
    if (rideId && get().pending?.rideId !== rideId) return
    set({ pending: null })
  },
}))
