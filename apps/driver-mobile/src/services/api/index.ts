import { createApiClient } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { tokenRefresher } from '@/services/tokenRefresher'

const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:4000'

export const api = createApiClient({
  baseURL: API_URL,
  getAccessToken: () => useAuthStore.getState().token,
  refresher: tokenRefresher,
  onAuthFailure: () => useAuthStore.getState().clearAuth(),
})
