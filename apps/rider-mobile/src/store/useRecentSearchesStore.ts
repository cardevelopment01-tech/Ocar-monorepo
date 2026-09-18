import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { BookingPlace } from '@/features/booking/store'

const MAX_RECENTS = 5

type RecentSearchesState = {
  recents: BookingPlace[]
  addRecent: (place: BookingPlace) => void
}

// Web has no equivalent of this (its search page only has a static POPULAR
// list + real saved places, no persisted recent-searches) -- this is a new,
// mobile-only convenience: most-recent-first, deduped by address, capped at 5.
export const useRecentSearchesStore = create<RecentSearchesState>()(
  persist(
    (set) => ({
      recents: [],
      addRecent: (place) =>
        set((state) => ({
          recents: [place, ...state.recents.filter((r) => r.address !== place.address)].slice(0, MAX_RECENTS),
        })),
    }),
    {
      name: 'ocar_recent_searches',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
