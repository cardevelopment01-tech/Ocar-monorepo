import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  startOtp?: string
  endOtp?: string
  userPhone?: string
  userName?: string
  returnAt?: string
  tripHours?: number
  rideStartedAt?: string
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
  } | null

  setActiveRide:     (ride: ActiveRide) => void
  updateRideStatus:  (status: string) => void
  setStartOtp:       (otp: string) => void
  setEndOtp:         (otp: string) => void
  setRideStartedAt:  (ts: string) => void
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

      setStartOtp: (otp) =>
        set((s) => ({ activeRide: s.activeRide ? { ...s.activeRide, startOtp: otp } : null })),

      setEndOtp: (otp) =>
        set((s) => ({ activeRide: s.activeRide ? { ...s.activeRide, endOtp: otp } : null })),

      setRideStartedAt: (ts) =>
        set((s) => ({ activeRide: s.activeRide ? { ...s.activeRide, rideStartedAt: ts } : null })),

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
