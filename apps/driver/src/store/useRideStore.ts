import { create } from 'zustand'

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
  startOtp?: string
  endOtp?: string
  userPhone?: string
  userName?: string
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
  } | null

  setActiveRide:     (ride: ActiveRide) => void
  updateRideStatus:  (status: string) => void
  setStartOtp:       (otp: string) => void
  setEndOtp:         (otp: string) => void
  clearRide:         () => void
  setIncomingRequest: (req: RideState['incomingRequest']) => void
  clearIncomingRequest: () => void
}

export const useRideStore = create<RideState>((set) => ({
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

  clearRide: () =>
    set({ activeRide: null, incomingRequest: null }),

  setIncomingRequest: (req) =>
    set({ incomingRequest: req }),

  clearIncomingRequest: () =>
    set({ incomingRequest: null }),
}))
