import axios from 'axios'
import { createSocket } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'

const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:4000'

// Bare axios, not the `api` client -- avoids the response interceptor loop, mirrors
// apps/driver/src/lib/socket.ts's refreshSocketToken.
async function refreshSocketToken(): Promise<string> {
  const { refreshToken, user, setAuth } = useAuthStore.getState()
  if (!refreshToken || !user) throw new Error('no_refresh_token')
  const res = await axios.post<{ tokens: { accessToken: string; refreshToken: string } }>(
    `${API_URL}/api/v1/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
  )
  const tokens = res.data.tokens
  setAuth(tokens.accessToken, tokens.refreshToken, user)
  return tokens.accessToken
}

export const { socket, connect: connectSocket, disconnect: disconnectSocket } = createSocket({
  baseURL: API_URL,
  getToken: () => useAuthStore.getState().token,
  refreshToken: refreshSocketToken,
  onRefreshFailure: () => useAuthStore.getState().clearAuth(),
})
