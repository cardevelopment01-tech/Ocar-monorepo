import { createApiClient, reportApiCall } from '@ocar/mobile-shared'
import { useAuthStore } from '@/store/useAuthStore'
import { handleSessionReplaced } from '@/services/sessionReplaced'
import { tokenRefresher } from '@/services/tokenRefresher'
import { restrictionFromErrorCode } from '@/features/account/accountStanding'

const API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:4000'

export const api = createApiClient({
  baseURL: API_URL,
  getAccessToken: () => useAuthStore.getState().token,
  refresher: tokenRefresher,
  onAuthFailure: () => useAuthStore.getState().clearAuth(),
  onRequestDone: reportApiCall,
  onSessionReplaced: handleSessionReplaced,
})

// An account that is suspended or banned answers 403 with its own code. Record it so the app moves to the status
// screen (see useStandingSync) instead of showing a generic error on whatever the driver was doing.
api.interceptors.response.use(undefined, (error: { response?: { status?: number; data?: { code?: unknown } } }) => {
  const restriction = error.response?.status === 403 ? restrictionFromErrorCode(error.response.data?.code) : null
  const { driver, updateDriver } = useAuthStore.getState()
  if (restriction && driver && driver.status !== restriction) updateDriver({ status: restriction })
  return Promise.reject(error)
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
