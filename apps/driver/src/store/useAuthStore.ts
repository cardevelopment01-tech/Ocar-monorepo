import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  setAuth: (token: string, refreshToken: string, driver: DriverProfile) => void
  clearAuth: () => void
  updateDriver: (updates: Partial<DriverProfile>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      driver: null,
      isAuthenticated: false,

      setAuth: (token, refreshToken, driver) =>
        set({ token, refreshToken, driver, isAuthenticated: true }),

      clearAuth: () =>
        set({ token: null, refreshToken: null, driver: null, isAuthenticated: false }),

      updateDriver: (updates) =>
        set((state) => ({
          driver: state.driver ? { ...state.driver, ...updates } : null,
        })),
    }),
    {
      name: 'ocar_driver_auth',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        driver: state.driver,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
