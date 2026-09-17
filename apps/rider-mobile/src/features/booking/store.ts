import { create } from 'zustand'

export type BookingPlace = { address: string; lat: number; lng: number }

interface BookingDraftState {
  pickup: BookingPlace | null
  drop: BookingPlace | null
  distanceKm: number | null
  durationMin: number | null
  originCityId: number | null
  selectedCategoryId: number | null
  setPickup: (place: BookingPlace) => void
  setDrop: (place: BookingPlace) => void
  setRoute: (distanceKm: number, durationMin: number, originCityId: number | null) => void
  setSelectedCategoryId: (id: number) => void
  reset: () => void
}

// Ephemeral, in-memory only -- the booking draft doesn't need to survive an
// app kill (crash-recovery mid-ride is handled separately via
// GET /rides/me/active-user, not this store), so no zustand/persist here.
export const useBookingDraftStore = create<BookingDraftState>()((set) => ({
  pickup: null,
  drop: null,
  distanceKm: null,
  durationMin: null,
  originCityId: null,
  selectedCategoryId: null,
  setPickup: (place) => set({ pickup: place }),
  setDrop: (place) => set({ drop: place }),
  setRoute: (distanceKm, durationMin, originCityId) => set({ distanceKm, durationMin, originCityId }),
  setSelectedCategoryId: (id) => set({ selectedCategoryId: id }),
  reset: () =>
    set({
      pickup: null,
      drop: null,
      distanceKm: null,
      durationMin: null,
      originCityId: null,
      selectedCategoryId: null,
    }),
}))
