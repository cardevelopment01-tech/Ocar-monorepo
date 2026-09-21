import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Whether this device has swiped through the first-launch intro carousel.
// Not sensitive, so plain AsyncStorage (no secure/hybrid storage needed like
// useAuthStore's tokens).
interface OnboardingIntroState {
  hasSeenIntro: boolean
  hasHydrated: boolean
  markIntroSeen: () => void
}

export const useOnboardingIntroStore = create<OnboardingIntroState>()(
  persist(
    (set) => ({
      hasSeenIntro: false,
      hasHydrated: false,
      markIntroSeen: () => set({ hasSeenIntro: true }),
    }),
    {
      name: 'ocar_rider_intro',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => () => {
        useOnboardingIntroStore.setState({ hasHydrated: true })
      },
    }
  )
)
