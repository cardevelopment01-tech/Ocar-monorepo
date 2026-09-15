import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createHybridStorage, createSecurePersistStorage } from '@ocar/mobile-shared'

export interface UserProfile {
  id: string
  code: string
  phone: string
  name: string | null
  email: string | null
  status: string
  referral_code: string
}

interface AuthState {
  token: string | null
  refreshToken: string | null
  user: UserProfile | null
  isAuthenticated: boolean
  hasHydrated: boolean
  pushPermissionGranted: boolean | null
  setAuth: (token: string, refreshToken: string, user: UserProfile) => void
  clearAuth: () => void
  updateUser: (updates: Partial<UserProfile>) => void
  setPushPermissionGranted: (granted: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
      hasHydrated: false,
      pushPermissionGranted: null,

      setAuth: (token, refreshToken, user) => set({ token, refreshToken, user, isAuthenticated: true }),

      clearAuth: () => set({ token: null, refreshToken: null, user: null, isAuthenticated: false }),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      setPushPermissionGranted: (granted) => set({ pushPermissionGranted: granted }),
    }),
    {
      name: 'ocar_user_auth',
      // token/refreshToken -> SecureStore, everything else -> AsyncStorage (2048-byte
      // ceiling on SecureStore values; see hybridStorage.ts).
      storage: createJSONStorage(() =>
        createHybridStorage(createSecurePersistStorage(), AsyncStorage, ['token', 'refreshToken'])
      ),
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) useAuthStore.getState().clearAuth()
        useAuthStore.setState({ hasHydrated: true })
      },
    }
  )
)
