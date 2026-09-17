import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createHybridStorage, createSecurePersistStorage } from '@ocar/mobile-shared'

// Lazy require, not a static import: services/socket/index.ts imports useAuthStore
// (for its own getToken/refreshToken callbacks) and createSocket() calls getToken()
// synchronously at module-eval time -- a static import here would create a real
// circular-init crash ("Cannot read property 'getState' of undefined"), since
// whichever module loads first would see the other's exports still unassigned.
// require()'d lazily inside the actions below, both modules are fully loaded by
// the time either function actually runs.
function getSocketActions(): { connectSocket: () => void; disconnectSocket: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy require, see above
  return require('@/services/socket')
}

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

      setAuth: (token, refreshToken, user) => {
        set({ token, refreshToken, user, isAuthenticated: true })
        getSocketActions().connectSocket()
      },

      clearAuth: () => {
        getSocketActions().disconnectSocket()
        set({ token: null, refreshToken: null, user: null, isAuthenticated: false })
      },

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
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          useAuthStore.getState().clearAuth()
        } else if (state?.isAuthenticated) {
          // Restored an already-logged-in session (app relaunch) -- setAuth() only
          // fires on a fresh login, so the socket connect has to happen here too.
          getSocketActions().connectSocket()
        }
        useAuthStore.setState({ hasHydrated: true })
      },
    }
  )
)
