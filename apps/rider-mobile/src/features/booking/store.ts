import { create } from 'zustand'
import type { RideType } from './api'
import type { TripMode } from './cityRideRoute'
import { MAX_STOPS } from './constants'

export type BookingPlace = { address: string; lat: number; lng: number }

interface BookingDraftState {
  pickup: BookingPlace | null
  /** True while the pickup is the rider's current location filled in automatically: it follows the live fix until the rider
   *  picks a place themselves. */
  pickupAuto: boolean
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
  /** False when the rider never declared a ride type (search bar, saved places,
   *  recent trips, popular routes -- Home screen taps that skip the service
   *  tiles). Mirrors web's `rideType` URL param being absent: /booking's
   *  Continue then classifies the route itself instead of trusting the
   *  leftover/default value above. True once a tile (or the trip-type screen)
   *  has explicitly picked one. */
  rideTypeDeclared: boolean
  /** 'city' = the City Ride mode (a one-way ride priced on the city card). Always standard unless the City Ride tile, or the route, set it. */
  tripMode: TripMode
  /** Round-trip only -- how many hours the driver stays, chosen on /booking/round-trip. */
  tripHours: number | null
  /** Round-trip/rental only, up to MAX_STOPS -- matches web's stops[] URL-param carrying. */
  stops: BookingPlace[]
  /** ISO string, null means "now" -- matches web's PickupTimeChip/scheduledFor. */
  scheduledFor: string | null
  /** Empty strings mean "booking for myself" -- matches web's BookingForSheet contract. */
  riderName: string
  riderPhone: string
  setPickup: (place: BookingPlace, auto?: boolean) => void
  clearPickup: () => void
  setDrop: (place: BookingPlace) => void
  setRoute: (distanceKm: number, durationMin: number, originCityId: number | null, routePoints: [number, number][]) => void
  setSelectedCategoryId: (id: number) => void
  setRideType: (rideType: RideType, declared?: boolean, tripMode?: TripMode) => void
  /** Begins a new search from Home: sets the ride type like setRideType and clears everything the previous search left behind
   *  (destination, stops, route, chosen category, trip hours). The pickup, the scheduled time and who it is for are kept. */
  startSearch: (rideType: RideType, declared?: boolean, tripMode?: TripMode) => void
  setTripHours: (hours: number) => void
  addStop: (place: BookingPlace) => void
  removeStop: (index: number) => void
  swapStop: (index: number) => void
  setScheduledFor: (iso: string | null) => void
  setRider: (name: string, phone: string) => void
  clearRider: () => void
  reset: () => void
}

// Ephemeral, in-memory only -- the booking draft doesn't need to survive an
// app kill (crash-recovery mid-ride is handled separately via
// GET /rides/me/active-user, not this store), so no zustand/persist here.
export const useBookingDraftStore = create<BookingDraftState>()((set) => ({
  pickup: null,
  pickupAuto: false,
  drop: null,
  distanceKm: null,
  durationMin: null,
  originCityId: null,
  routePoints: [],
  selectedCategoryId: null,
  rideType: 'one_way',
  rideTypeDeclared: false,
  tripMode: 'standard',
  tripHours: null,
  stops: [],
  scheduledFor: null,
  riderName: '',
  riderPhone: '',
  setPickup: (place, auto = false) => set({ pickup: place, pickupAuto: auto }),
  clearPickup: () => set({ pickup: null, pickupAuto: false }),
  setDrop: (place) => set({ drop: place }),
  setRoute: (distanceKm, durationMin, originCityId, routePoints) => set({ distanceKm, durationMin, originCityId, routePoints }),
  setSelectedCategoryId: (id) => set({ selectedCategoryId: id }),
  // Any ride type picked without a trip mode is a standard ride, so a leftover City Ride choice never leaks into Rental or Outstation.
  setRideType: (rideType, declared = true, tripMode = 'standard') => set({ rideType, rideTypeDeclared: declared, tripMode }),
  startSearch: (rideType, declared = true, tripMode = 'standard') =>
    set({
      rideType,
      rideTypeDeclared: declared,
      tripMode,
      drop: null,
      distanceKm: null,
      durationMin: null,
      originCityId: null,
      routePoints: [],
      selectedCategoryId: null,
      tripHours: null,
      stops: [],
    }),
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
      pickupAuto: false,
      drop: null,
      distanceKm: null,
      durationMin: null,
      originCityId: null,
      routePoints: [],
      selectedCategoryId: null,
      rideType: 'one_way',
      rideTypeDeclared: false,
      tripMode: 'standard',
      tripHours: null,
      stops: [],
      scheduledFor: null,
      riderName: '',
      riderPhone: '',
    }),
}))
