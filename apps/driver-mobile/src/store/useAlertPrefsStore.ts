import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AnnouncementLang } from '@/features/ride-requests/buildAnnouncement'

// How a new ride request alerts the driver. Not sensitive: plain AsyncStorage.
interface AlertPrefsState {
  /** Read the request aloud (type, pickup, drop, distance, fare) after the first ring. */
  voiceEnabled: boolean
  language: AnnouncementLang
  /** The spoken turn-by-turn directions on the guided map are muted. */
  guidanceMuted: boolean
  /** Show the floating Ocar icon over other apps while online and Ocar is not in front (Android; on by default, needs the overlay permission). */
  floatingIconEnabled: boolean
  /** Open Ocar by itself when a request arrives and Ocar is in the background (on by default; needs the icon; gated by speed and idle). */
  autoOpenEnabled: boolean
  /** The driver has already been asked once to allow "Display over other apps" (the prompt never repeats on its own). */
  overlayPermissionAsked: boolean
  /** The saved values have loaded from storage: until then the defaults must not drive a live request. */
  hasHydrated: boolean
  setVoiceEnabled: (on: boolean) => void
  setLanguage: (lang: AnnouncementLang) => void
  setGuidanceMuted: (muted: boolean) => void
  setFloatingIconEnabled: (on: boolean) => void
  setAutoOpenEnabled: (on: boolean) => void
  setOverlayPermissionAsked: (asked: boolean) => void
}

export const useAlertPrefsStore = create<AlertPrefsState>()(
  persist(
    (set) => ({
      voiceEnabled: true,
      language: 'en',
      guidanceMuted: false,
      // On by default (the client's feature); drivers can switch them off in Notification settings. The icon still only shows once
      // the driver has granted the Android overlay permission, which cannot be granted for them.
      floatingIconEnabled: true,
      autoOpenEnabled: true,
      overlayPermissionAsked: false,
      hasHydrated: false,
      setVoiceEnabled: (voiceEnabled) => set({ voiceEnabled }),
      setLanguage: (language) => set({ language }),
      setGuidanceMuted: (guidanceMuted) => set({ guidanceMuted }),
      // Turning the icon off also turns auto-open off: auto-open needs the icon's overlay permission and the opt-in behind it.
      setFloatingIconEnabled: (floatingIconEnabled) => set(floatingIconEnabled ? { floatingIconEnabled } : { floatingIconEnabled, autoOpenEnabled: false }),
      setAutoOpenEnabled: (autoOpenEnabled) => set({ autoOpenEnabled }),
      setOverlayPermissionAsked: (overlayPermissionAsked) => set({ overlayPermissionAsked }),
    }),
    {
      name: 'ocar_driver_alert_prefs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        voiceEnabled: s.voiceEnabled, language: s.language, guidanceMuted: s.guidanceMuted,
        floatingIconEnabled: s.floatingIconEnabled, autoOpenEnabled: s.autoOpenEnabled, overlayPermissionAsked: s.overlayPermissionAsked,
      }),
      onRehydrateStorage: () => () => useAlertPrefsStore.setState({ hasHydrated: true }),
    }
  )
)
