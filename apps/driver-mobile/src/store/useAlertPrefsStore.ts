import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AnnouncementLang } from '@/features/ride-requests/buildAnnouncement'

// How a new ride request alerts the driver. Not sensitive: plain AsyncStorage.
interface AlertPrefsState {
  /** Read the request aloud (type, pickup, drop, distance, fare) after the first ring. */
  voiceEnabled: boolean
  language: AnnouncementLang
  /** The saved values have loaded from storage: until then the defaults must not drive a live request. */
  hasHydrated: boolean
  setVoiceEnabled: (on: boolean) => void
  setLanguage: (lang: AnnouncementLang) => void
}

export const useAlertPrefsStore = create<AlertPrefsState>()(
  persist(
    (set) => ({
      voiceEnabled: true,
      language: 'en',
      hasHydrated: false,
      setVoiceEnabled: (voiceEnabled) => set({ voiceEnabled }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'ocar_driver_alert_prefs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ voiceEnabled: s.voiceEnabled, language: s.language }),
      onRehydrateStorage: () => () => useAlertPrefsStore.setState({ hasHydrated: true }),
    }
  )
)
