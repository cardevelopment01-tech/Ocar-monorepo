import axios, { type InternalAxiosRequestConfig } from 'axios'
import { clearAuth, getRefreshToken, storeTokens } from './auth'

type RetriableRequest = InternalAxiosRequestConfig & { _retry?: boolean }

class MissingRefreshTokenError extends Error {}

const api = axios.create({
  baseURL: process.env['NEXT_PUBLIC_API_URL'],
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
})

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL']
let refreshPromise: Promise<string> | null = null

function isAuthEndpoint(url?: string): boolean {
  return !!url && (
    url.includes('/api/v1/auth/refresh') ||
    url.includes('/api/v1/auth/otp/request') ||
    url.includes('/api/v1/auth/otp/verify')
  )
}

function tokenExpiresSoon(token: string, skewSeconds = 60): boolean {
  try {
    const [, payload] = token.split('.')
    if (!payload) return false
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return typeof decoded.exp === 'number' && decoded.exp - Math.floor(Date.now() / 1000) <= skewSeconds
  } catch {
    return false
  }
}

function redirectToLogin() {
  clearAuth()
  window.location.href = '/login'
}

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
    const res = await axios.post(
      `${API_BASE_URL}/api/v1/auth/refresh`,
      { refreshToken },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    )
    const tokens = res.data.tokens as { accessToken: string; refreshToken: string }
    storeTokens(tokens.accessToken, tokens.refreshToken)
    return tokens.accessToken
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

api.interceptors.request.use(
  async (config) => {
    if (typeof window !== 'undefined') {
      let token = localStorage.getItem('ocar_user_token')
      if (token && !isAuthEndpoint(config.url) && tokenExpiresSoon(token)) {
        try {
          token = await refreshAccessToken()
        } catch (err) {
          if (shouldClearAfterRefreshFailure(err)) {
            redirectToLogin()
            return Promise.reject(err)
          }
        }
      }
      if (token) config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const code = error.response?.data?.code
    const isTokenError = code === 'AUTH_UNAUTHORIZED' || code === 'AUTH_TOKEN_INVALID' || code === 'AUTH_TOKEN_EXPIRED'
    const original = error.config as RetriableRequest | undefined

    if (
      error.response?.status === 401 &&
      isTokenError &&
      original &&
      !original._retry &&
      !isAuthEndpoint(original.url) &&
      typeof window !== 'undefined'
    ) {
      original._retry = true
      try {
        const newToken = await refreshAccessToken()
        original.headers = original.headers ?? {}
        original.headers['Authorization'] = `Bearer ${newToken}`
        return api(original)
      } catch (refreshErr) {
        if (shouldClearAfterRefreshFailure(refreshErr)) redirectToLogin()
        return Promise.reject(refreshErr)
      }
    }
    return Promise.reject(error)
  }
)

export default api

export type ApiError = {
  error: string
  code: string
  requestId?: string
}
