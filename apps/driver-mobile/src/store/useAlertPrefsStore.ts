import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AnnouncementLang } from '@/features/ride-requests/buildAnnouncement'

// How a new ride request alerts the driver. Not sensitive: plain AsyncStorage.
interface AlertPrefsState {
  /** Read the request aloud (type, pickup, drop, distance, fare) after the first ring. */
  voiceEnabled: boolean
  language: AnnouncementLang
  setVoiceEnabled: (on: boolean) => void
  setLanguage: (lang: AnnouncementLang) => void
}

export const useAlertPrefsStore = create<AlertPrefsState>()(
  persist(
    (set) => ({
      voiceEnabled: true,
      language: 'en',
      setVoiceEnabled: (voiceEnabled) => set({ voiceEnabled }),
      setLanguage: (language) => set({ language }),
    }),
    { name: 'ocar_driver_alert_prefs', storage: createJSONStorage(() => AsyncStorage) }
  )
)
