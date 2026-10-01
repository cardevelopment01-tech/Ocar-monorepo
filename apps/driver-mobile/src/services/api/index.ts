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

// Wait at a stop is billed from the server's `arrived_at`, so on-screen timers must
// run on the server's clock: a phone clock that's off by minutes would otherwise
// show a stuck 0:00 or an instantly inflated wait. Offset comes from the `Date`
// header of every successful response (1s resolution, good enough for a timer).
let serverSkewMs = 0
api.interceptors.response.use((res) => {
  const serverTime = Date.parse(String(res.headers?.['date'] ?? ''))
  if (!Number.isNaN(serverTime)) serverSkewMs = serverTime - Date.now()
  return res
})
export const serverNow = (): number => Date.now() + serverSkewMs
