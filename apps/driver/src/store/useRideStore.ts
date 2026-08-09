import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface RideStop {
  id: string
  sequence: number
  lat: number
  lng: number
  address: string | null
  status: 'pending' | 'reached' | 'skipped'
  arrived_at: string | null
  reached_at: string | null
  stop_charge_applied: string | null
  wait_charge: string | null
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
  userRating?: number
  returnAt?: string
  tripHours?: number
  rideStartedAt?: string
  stops?: RideStop[]
  paymentChannel?: 'cash' | 'online' | 'wallet'
}

interface RideState {
  activeRide: ActiveRide | null
  // True once the session-restore fetch in App.tsx has definitively determined
  // there is (or isn't) an active ride. Pages gate hard "no ride, go home"
  // redirects on this so a refresh can't evict a driver before restore finishes.
  restoreChecked: boolean
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
    rideCategoryName?: string
    assignedByOps?: boolean
  } | null
  unreadChatCount: number

  setActiveRide:     (ride: ActiveRide) => void
  setRestoreChecked: () => void
  updateRideStatus:  (status: string) => void
  setFare:           (fare: number) => void
  setRideStartedAt:  (ts: string) => void
  arriveStop:        (sequence: number, arrivedAt: string | null, waitCharge?: string | null) => void
  updateStop:        (sequence: number, status: 'reached' | 'skipped', reachedAt: string | null, waitCharge?: string | null) => void
  addStop:           (stop: RideStop) => void
  clearRide:         () => void
  setIncomingRequest: (req: RideState['incomingRequest']) => void
  clearIncomingRequest: () => void
  setUnreadChatCount: (count: number) => void
  incrementUnreadChatCount: () => void
}

export const useRideStore = create<RideState>()(
  persist(
    (set) => ({
      activeRide:       null,
      restoreChecked:   false,
      incomingRequest:  null,
      unreadChatCount:  0,

      setActiveRide: (ride) =>
        set({ activeRide: ride }),

      setRestoreChecked: () =>
        set({ restoreChecked: true }),

      updateRideStatus: (status) =>
        set((s) => ({ activeRide: s.activeRide ? { ...s.activeRide, status } : null })),

      setFare: (fare) =>
        set((s) => ({ activeRide: s.activeRide ? { ...s.activeRide, fare } : null })),

      setRideStartedAt: (ts) =>
        set((s) => ({ activeRide: s.activeRide ? { ...s.activeRide, rideStartedAt: ts } : null })),

      arriveStop: (sequence, arrivedAt, waitCharge) =>
        set((s) => ({
          activeRide: s.activeRide ? {
            ...s.activeRide,
            stops: (s.activeRide.stops ?? []).map(stop =>
              stop.sequence === sequence
                ? { ...stop, arrived_at: arrivedAt, ...(waitCharge !== undefined ? { wait_charge: waitCharge } : {}) }
                : stop
            ),
          } : null,
        })),

      updateStop: (sequence, status, reachedAt, waitCharge) =>
        set((s) => ({
          activeRide: s.activeRide ? {
            ...s.activeRide,
            stops: (s.activeRide.stops ?? []).map(stop =>
              stop.sequence === sequence
                ? { ...stop, status, reached_at: reachedAt, ...(waitCharge !== undefined ? { wait_charge: waitCharge } : {}) }
                : stop
            ),
          } : null,
        })),

      addStop: (stop) =>
        set((s) => ({
          activeRide: s.activeRide ? {
            ...s.activeRide,
            stops: [...(s.activeRide.stops ?? []), stop],
          } : null,
        })),

      clearRide: () =>
        set({ activeRide: null, incomingRequest: null, unreadChatCount: 0 }),

      setIncomingRequest: (req) =>
        set({ incomingRequest: req }),

      clearIncomingRequest: () =>
        set({ incomingRequest: null }),

      setUnreadChatCount: (count) =>
        set({ unreadChatCount: count }),

      incrementUnreadChatCount: () =>
        set((s) => ({ unreadChatCount: s.unreadChatCount + 1 })),
    }),
    {
      name: 'ocar_driver_ride',
      partialize: (s) => ({ activeRide: s.activeRide }),
    }
  )
)
