import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createHybridStorage, createSecurePersistStorage } from '@ocar/mobile-shared'

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

      clearAuth: () => set({ token: null, refreshToken: null, driver: null, isAuthenticated: false }),

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
      onRehydrateStorage: () => (_state, error) => {
        if (error) useAuthStore.getState().clearAuth()
        useAuthStore.setState({ hasHydrated: true })
      },
    }
  )
)
