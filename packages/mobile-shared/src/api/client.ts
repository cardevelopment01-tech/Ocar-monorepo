import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { tokenExpiresSoon } from './jwt'
import type { ApiError, TokenPair } from './types'

type RetriableRequest = InternalAxiosRequestConfig & { _retry?: boolean }

export class MissingRefreshTokenError extends Error {}

export type ApiClientConfig = {
  baseURL: string
  getAccessToken: () => string | null
  getRefreshToken: () => string | null
  onTokensRefreshed: (tokens: TokenPair) => void
  onAuthFailure: () => void
  isAuthEndpoint?: (url: string | undefined) => boolean
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
  const { baseURL, getAccessToken, getRefreshToken, onTokensRefreshed, onAuthFailure } = config
  const isAuthEndpoint = config.isAuthEndpoint ?? defaultIsAuthEndpoint

  const api = axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  })

  let refreshPromise: Promise<string> | null = null

  function isRefreshAuthFailure(err: unknown): boolean {
    return axios.isAxiosError(err) && err.response?.status === 401
  }

  function shouldClearAfterRefreshFailure(err: unknown): boolean {
    return err instanceof MissingRefreshTokenError || isRefreshAuthFailure(err)
  }

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

  api.interceptors.request.use(
    async (requestConfig) => {
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
    (response) => response,
    async (error) => {
      const code = axios.isAxiosError(error) ? (error.response?.data as ApiError | undefined)?.code : undefined
      const isTokenError = code === 'AUTH_UNAUTHORIZED' || code === 'AUTH_TOKEN_INVALID' || code === 'AUTH_TOKEN_EXPIRED'
      const original = error.config as RetriableRequest | undefined

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
