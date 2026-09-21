import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createHybridStorage, createSecurePersistStorage } from '@ocar/mobile-shared'
import { clearLoggedFixes, stopBackgroundTracking } from '@/services/location/backgroundTask'

export interface DriverProfile {
  id: string
  code: string
  phone: string
  full_name: string | null
  email: string | null
  status: string
  onboarding_step: string
  rating: number | null
}

interface AuthState {
  token: string | null
  refreshToken: string | null
  driver: DriverProfile | null
  isAuthenticated: boolean
  hasHydrated: boolean
  pushPermissionGranted: boolean | null
  setAuth: (token: string, refreshToken: string, driver: DriverProfile) => void
  clearAuth: () => void
  updateDriver: (updates: Partial<DriverProfile>) => void
  setPushPermissionGranted: (granted: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      driver: null,
      isAuthenticated: false,
      hasHydrated: false,
      pushPermissionGranted: null,

      setAuth: (token, refreshToken, driver) => set({ token, refreshToken, driver, isAuthenticated: true }),

      clearAuth: () => {
        // Lifecycle ownership (Section 3): the auth store owns stopping anything that
        // depends on a live session -- an orphaned background-location task after
        // logout has no session to justify it (battery drain, Play Store risk) and
        // leaves the spike's location log for the next driver on a shared device.
        stopBackgroundTracking().catch(() => {})
        clearLoggedFixes().catch(() => {})
        set({ token: null, refreshToken: null, driver: null, isAuthenticated: false })
      },

      updateDriver: (updates) =>
        set((state) => ({
          driver: state.driver ? { ...state.driver, ...updates } : null,
        })),

      setPushPermissionGranted: (granted) => set({ pushPermissionGranted: granted }),
    }),
    {
      name: 'ocar_driver_auth',
      // token/refreshToken -> SecureStore, everything else -> AsyncStorage (2048-byte
      // ceiling on SecureStore values; see hybridStorage.ts).
      storage: createJSONStorage(() =>
        createHybridStorage(createSecurePersistStorage(), AsyncStorage, ['token', 'refreshToken'])
      ),
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        driver: state.driver,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (_state, _error) => {
        // Don't clearAuth() here -- that actively deletes the persisted token.
        // A rehydration error can be a transient SecureStore read failure (e.g.
        // Android Keystore decrypt glitch after an abrupt process kill racing an
        // in-flight write), not necessarily a signal the driver should be logged
        // out. Failing soft (unauthenticated in memory only, storage untouched)
        // lets a clean read on the next launch silently restore the session
        // instead of permanently destroying it on what may be a one-off glitch.
        useAuthStore.setState({ hasHydrated: true })
      },
    }
  )
)
