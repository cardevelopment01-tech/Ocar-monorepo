import { create } from 'zustand'
import type { RideType } from './api'

export type BookingPlace = { address: string; lat: number; lng: number }

interface BookingDraftState {
  pickup: BookingPlace | null
  drop: BookingPlace | null
  distanceKm: number | null
  durationMin: number | null
  originCityId: number | null
  routePoints: [number, number][]
  selectedCategoryId: number | null
  /** Which service tile the trip started from -- set by the Home screen before
   *  pushing to /booking, drives search's post-Continue routing (one_way -> fare,
   *  round_trip -> round-trip, rental -> rental). Matches web's SERVICES tiles. */
  rideType: RideType
  /** Round-trip only -- how many hours the driver stays, chosen on /booking/round-trip. */
  tripHours: number | null
  /** Round-trip/rental only, up to 3 -- matches web's stops[] URL-param carrying. */
  stops: BookingPlace[]
  /** ISO string, null means "now" -- matches web's PickupTimeChip/scheduledFor. */
  scheduledFor: string | null
  /** Empty strings mean "booking for myself" -- matches web's BookingForSheet contract. */
  riderName: string
  riderPhone: string
  setPickup: (place: BookingPlace) => void
  setDrop: (place: BookingPlace) => void
  setRoute: (distanceKm: number, durationMin: number, originCityId: number | null, routePoints: [number, number][]) => void
  setSelectedCategoryId: (id: number) => void
  setRideType: (rideType: RideType) => void
  setTripHours: (hours: number) => void
  addStop: (place: BookingPlace) => void
  removeStop: (index: number) => void
  swapStop: (index: number) => void
  setScheduledFor: (iso: string | null) => void
  setRider: (name: string, phone: string) => void
  clearRider: () => void
  reset: () => void
}

const MAX_STOPS = 3

// Ephemeral, in-memory only -- the booking draft doesn't need to survive an
// app kill (crash-recovery mid-ride is handled separately via
// GET /rides/me/active-user, not this store), so no zustand/persist here.
export const useBookingDraftStore = create<BookingDraftState>()((set) => ({
  pickup: null,
  drop: null,
  distanceKm: null,
  durationMin: null,
  originCityId: null,
  routePoints: [],
  selectedCategoryId: null,
  rideType: 'one_way',
  tripHours: null,
  stops: [],
  scheduledFor: null,
  riderName: '',
  riderPhone: '',
  setPickup: (place) => set({ pickup: place }),
  setDrop: (place) => set({ drop: place }),
  setRoute: (distanceKm, durationMin, originCityId, routePoints) => set({ distanceKm, durationMin, originCityId, routePoints }),
  setSelectedCategoryId: (id) => set({ selectedCategoryId: id }),
  setRideType: (rideType) => set({ rideType }),
  setTripHours: (hours) => set({ tripHours: hours }),
  addStop: (place) => set((s) => (s.stops.length >= MAX_STOPS ? s : { stops: [...s.stops, place] })),
  removeStop: (index) => set((s) => ({ stops: s.stops.filter((_, i) => i !== index) })),
  // Swaps a stop with the one after it -- same reordering affordance as web's swapAt.
  swapStop: (index) =>
    set((s) => {
      if (index >= s.stops.length - 1) return s
      const next = [...s.stops]
      const a = next[index]!
      next[index] = next[index + 1]!
      next[index + 1] = a
      return { stops: next }
    }),
  setScheduledFor: (iso) => set({ scheduledFor: iso }),
  setRider: (name, phone) => set({ riderName: name, riderPhone: phone }),
  clearRider: () => set({ riderName: '', riderPhone: '' }),
  reset: () =>
    set({
      pickup: null,
      drop: null,
      distanceKm: null,
      durationMin: null,
      originCityId: null,
      routePoints: [],
      selectedCategoryId: null,
      rideType: 'one_way',
      tripHours: null,
      stops: [],
      scheduledFor: null,
      riderName: '',
      riderPhone: '',
    }),
}))
