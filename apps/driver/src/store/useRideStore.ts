import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface RideStop {
  id: string
  sequence: number
  lat: number
  lng: number
  address: string | null
  status: 'pending' | 'reached' | 'skipped'
  reached_at: string | null
}

export interface ActiveRide {
  id: string
  status: string
  pickup: string
  drop: string
  pickupLat: number
  pickupLng: number
  dropLat?: number
  dropLng?: number
  fare: number
  rideType: string
  userPhone?: string
  userName?: string
  returnAt?: string
  tripHours?: number
  rideStartedAt?: string
  stops?: RideStop[]
}

interface RideState {
  activeRide: ActiveRide | null
  incomingRequest: {
    rideId: string
    pickup: string
    drop: string
    pickupDistance: number
    tripDistance: number
    fare: number
    timeoutSeconds: number
    pickupLat: number
    pickupLng: number
    rideType: string
    tripHours?: number
    returnAt?: string
    stopCount?: number
  } | null

  setActiveRide:     (ride: ActiveRide) => void
  updateRideStatus:  (status: string) => void
  setRideStartedAt:  (ts: string) => void
  updateStop:        (sequence: number, status: 'reached' | 'skipped', reachedAt: string | null) => void
  clearRide:         () => void
  setIncomingRequest: (req: RideState['incomingRequest']) => void
  clearIncomingRequest: () => void
}

export const useRideStore = create<RideState>()(
  persist(
    (set) => ({
      activeRide:       null,
      incomingRequest:  null,

      setActiveRide: (ride) =>
        set({ activeRide: ride }),

      updateRideStatus: (status) =>
        set((s) => ({ activeRide: s.activeRide ? { ...s.activeRide, status } : null })),

      setRideStartedAt: (ts) =>
        set((s) => ({ activeRide: s.activeRide ? { ...s.activeRide, rideStartedAt: ts } : null })),

      updateStop: (sequence, status, reachedAt) =>
        set((s) => ({
          activeRide: s.activeRide ? {
            ...s.activeRide,
            stops: (s.activeRide.stops ?? []).map(stop =>
              stop.sequence === sequence ? { ...stop, status, reached_at: reachedAt } : stop
            ),
          } : null,
        })),

      clearRide: () =>
        set({ activeRide: null, incomingRequest: null }),

      setIncomingRequest: (req) =>
        set({ incomingRequest: req }),

      clearIncomingRequest: () =>
        set({ incomingRequest: null }),
    }),
    {
      name: 'ocar_driver_ride',
      partialize: (s) => ({ activeRide: s.activeRide }),
    }
  )
)
