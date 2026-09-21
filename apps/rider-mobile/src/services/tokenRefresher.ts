import { createTokenRefresher } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'

const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:4000'

// Shared between services/api (REST) and services/socket (realtime) -- see
// createTokenRefresher's own doc comment for why these two transports must
// never run independent refreshes: a rotating-refresh-token reuse-detection
// race between them was the root cause of rider-mobile logging the user out
// on nearly every cold launch (the socket auto-connects at launch, racing
// whatever REST call the just-mounted home/trips screen fires).
export const tokenRefresher = createTokenRefresher({
  baseURL: API_URL,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokensRefreshed: (tokens) => {
    const { user } = useAuthStore.getState()
    if (user) useAuthStore.getState().setAuth(tokens.accessToken, tokens.refreshToken, user)
  },
})
