import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { tokenExpiresSoon } from './jwt'
import type { ApiError, TokenPair } from './types'

type RetriableRequest = InternalAxiosRequestConfig & { _retry?: boolean }

export class MissingRefreshTokenError extends Error {}

export type TokenRefresherConfig = {
  baseURL: string
  getRefreshToken: () => string | null
  onTokensRefreshed: (tokens: TokenPair) => void
}

export type TokenRefresher = {
  refreshAccessToken: () => Promise<string>
}

// A single shared in-flight-refresh guard for one app's auth session --
// create ONE of these per app and pass it to both createApiClient and
// createSocket, so a refresh triggered by either transport (a REST 401, or
// the socket's own "Invalid token" connect_error) shares one outstanding
// POST /auth/refresh instead of each transport firing its own.
//
// Refresh tokens rotate and reuse-detect server-side (api/src/modules/auth/
// auth.service.ts's refreshTokens: a second use of an already-consumed
// refresh token revokes the WHOLE token family, not just that one request).
// Two independent refreshers racing the same stale refresh token isn't just
// wasted work -- the losing call gets treated as token theft and wipes out
// the winning call's brand-new tokens too, force-logging-out the session
// even though a refresh had just succeeded. This was rider-mobile's "logged
// out on every launch" bug: its socket auto-connects at app launch
// (services/socket/index.ts) at the same moment its home/trips screens fire
// their own REST calls (services/api/index.ts) -- two separate refreshers,
// same stale token, real race. Sharing one refresher between both closes it.
export function createTokenRefresher(config: TokenRefresherConfig): TokenRefresher {
  const { baseURL, getRefreshToken, onTokensRefreshed } = config
  let refreshPromise: Promise<string> | null = null

  async function refreshAccessToken(): Promise<string> {
    if (refreshPromise) return refreshPromise
    refreshPromise = (async () => {
      const refreshToken = getRefreshToken()
      if (!refreshToken) throw new MissingRefreshTokenError('Missing refresh token')
      const res = await axios.post<{ tokens: TokenPair }>(
        `${baseURL}/api/v1/auth/refresh`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
      )
      onTokensRefreshed(res.data.tokens)
      return res.data.tokens.accessToken
    })().finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  return { refreshAccessToken }
}

export type ApiClientConfig = {
  baseURL: string
  getAccessToken: () => string | null
  refresher: TokenRefresher
  onAuthFailure: () => void
  /** Driver logged in on another device (401 AUTH_SESSION_REPLACED). Falls back to onAuthFailure. */
  onSessionReplaced?: () => void
  isAuthEndpoint?: (url: string | undefined) => boolean
  /** Called once per finished request (success or failure) so the app can report slow and failing calls. Never throws into the request. */
  onRequestDone?: (info: ApiCallInfo) => void
}

export type ApiCallInfo = {
  method: string
  url: string
  /** null = no response (offline, timeout, DNS). */
  status: number | null
  /** Server error code (e.g. DRIVER_DOCS_REJECTED) when the body has one. */
  code?: string
  ms: number
}

function defaultIsAuthEndpoint(url?: string): boolean {
  return (
    !!url &&
    (url.includes('/api/v1/auth/refresh') ||
      url.includes('/api/v1/auth/otp/request') ||
      url.includes('/api/v1/auth/otp/verify'))
  )
}

// Mirrors apps/driver/src/lib/api.ts's proven refresh-interceptor pattern (single in-flight
// refresh promise, retry-once via _retry, code-based 401 detection), generalized over
// per-app auth storage since rider and driver each keep tokens in their own store shape.
export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const { baseURL, getAccessToken, onAuthFailure } = config
  const onSessionReplaced = config.onSessionReplaced ?? onAuthFailure
  const isAuthEndpoint = config.isAuthEndpoint ?? defaultIsAuthEndpoint
  const { refreshAccessToken } = config.refresher
  const startedAt = new WeakMap<object, number>()

  function done(cfg: InternalAxiosRequestConfig | undefined, status: number | null, code?: string) {
    if (!config.onRequestDone || !cfg) return
    const t0 = startedAt.get(cfg)
    try {
      const info: ApiCallInfo = {
        method: (cfg.method ?? 'get').toUpperCase(),
        url: cfg.url ?? '',
        status,
        ms: t0 === undefined ? 0 : Date.now() - t0,
      }
      if (code) info.code = code
      config.onRequestDone(info)
    } catch {
      /* reporting must never break a request */
    }
  }

  const api = axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  })

  function isRefreshAuthFailure(err: unknown): boolean {
    return axios.isAxiosError(err) && err.response?.status === 401
  }

  function shouldClearAfterRefreshFailure(err: unknown): boolean {
    return err instanceof MissingRefreshTokenError || isRefreshAuthFailure(err)
  }

  api.interceptors.request.use(
    async (requestConfig) => {
      startedAt.set(requestConfig, Date.now())
      let token = getAccessToken()
      if (token && !isAuthEndpoint(requestConfig.url) && tokenExpiresSoon(token)) {
        try {
          token = await refreshAccessToken()
        } catch (err) {
          if (shouldClearAfterRefreshFailure(err)) {
            onAuthFailure()
            return Promise.reject(err)
          }
        }
      }
      if (token) requestConfig.headers['Authorization'] = `Bearer ${token}`
      return requestConfig
    },
    (error) => Promise.reject(error)
  )

  api.interceptors.response.use(
    (response) => {
      done(response.config, response.status)
      return response
    },
    async (error) => {
      const code = axios.isAxiosError(error) ? (error.response?.data as ApiError | undefined)?.code : undefined
      done(error.config as InternalAxiosRequestConfig | undefined, axios.isAxiosError(error) ? (error.response?.status ?? null) : null, code)
      const isTokenError = code === 'AUTH_UNAUTHORIZED' || code === 'AUTH_TOKEN_INVALID' || code === 'AUTH_TOKEN_EXPIRED'
      const original = error.config as RetriableRequest | undefined

      if (code === 'AUTH_SESSION_REPLACED') {
        onSessionReplaced()
        return Promise.reject(error)
      }

      if (
        axios.isAxiosError(error) &&
        error.response?.status === 401 &&
        isTokenError &&
        original &&
        !original._retry &&
        !isAuthEndpoint(original.url)
      ) {
        original._retry = true
        try {
          const newToken = await refreshAccessToken()
          original.headers = original.headers ?? {}
          original.headers['Authorization'] = `Bearer ${newToken}`
          return api(original)
        } catch (refreshErr) {
          if (shouldClearAfterRefreshFailure(refreshErr)) onAuthFailure()
          return Promise.reject(refreshErr)
        }
      }
      return Promise.reject(error)
    }
  )

  return api
}

export type { ApiError, TokenPair }
