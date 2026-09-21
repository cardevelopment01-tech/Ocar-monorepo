import { createSocket } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { tokenRefresher } from '@/services/tokenRefresher'

const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:4000'

export const { socket, connect: connectSocket, disconnect: disconnectSocket } = createSocket({
  baseURL: API_URL,
  getToken: () => useAuthStore.getState().token,
  refreshToken: tokenRefresher.refreshAccessToken,
  onRefreshFailure: () => useAuthStore.getState().clearAuth(),
})
