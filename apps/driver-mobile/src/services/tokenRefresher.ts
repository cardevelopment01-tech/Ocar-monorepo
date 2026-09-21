import { createTokenRefresher } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'

const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:4000'

// Shared between services/api (REST) and services/socket (realtime) -- see
// createTokenRefresher's own doc comment for why these two transports must
// never run independent refreshes: a rotating-refresh-token reuse-detection
// race between them was the root cause of the equivalent bug found on
// rider-mobile (its socket auto-connects at launch, racing the REST refresh
// its home/trips screens fire on mount). driver-mobile doesn't auto-connect
// its socket at launch (only on "Go Online"), so it rarely hit the race in
// practice, but the same two-independent-refreshers shape existed here too.
export const tokenRefresher = createTokenRefresher({
  baseURL: API_URL,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokensRefreshed: (tokens) => {
    const { driver } = useAuthStore.getState()
    if (driver) useAuthStore.getState().setAuth(tokens.accessToken, tokens.refreshToken, driver)
  },
})
