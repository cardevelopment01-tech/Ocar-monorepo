import { create } from 'zustand'
import type { SegmentKey } from '@/features/ride-requests/buildAnnouncement'

// What the voice is doing right now, for the ride-request pop-up to show. Written only by useRideAlertSound.
// Not persisted. `segment` changes a handful of times per request, so the pop-up re-renders only on those.
interface AnnouncementState {
  /** The voice is on and a request is being read (or is about to be). */
  speaking: boolean
  segment: SegmentKey | null
  set: (patch: Partial<Pick<AnnouncementState, 'speaking' | 'segment'>>) => void
  reset: () => void
}

export const useAnnouncementStore = create<AnnouncementState>()((set) => ({
  speaking: false,
  segment: null,
  set: (patch) => set(patch),
  reset: () => set({ speaking: false, segment: null }),
}))
