import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NavPrefsState {
  // Default-on per product decision — most drivers expect voice by default and
  // mute if unwanted, matching Google/Uber navigation's own default.
  voiceEnabled: boolean
  language: 'hi' | 'en'
  hindiHintShown: boolean

  setVoiceEnabled: (enabled: boolean) => void
  setLanguage: (language: 'hi' | 'en') => void
  markHindiHintShown: () => void
}

export const useNavPrefsStore = create<NavPrefsState>()(
  persist(
    (set) => ({
      voiceEnabled:   true,
      language:       'hi',
      hindiHintShown: false,

      setVoiceEnabled:     (voiceEnabled) => set({ voiceEnabled }),
      setLanguage:         (language) => set({ language }),
      markHindiHintShown:  () => set({ hindiHintShown: true }),
    }),
    { name: 'ocar_driver_nav_prefs' }
  )
)
