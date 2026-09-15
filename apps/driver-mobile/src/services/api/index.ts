import { createApiClient } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'

const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3000'

export const api = createApiClient({
  baseURL: API_URL,
  getAccessToken: () => useAuthStore.getState().token,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokensRefreshed: (tokens) => {
    const { driver } = useAuthStore.getState()
    if (driver) useAuthStore.getState().setAuth(tokens.accessToken, tokens.refreshToken, driver)
  },
  onAuthFailure: () => useAuthStore.getState().clearAuth(),
})
