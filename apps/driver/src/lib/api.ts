import axios, { type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/store/useAuthStore'
import { useMaintenanceStore } from '@/store/useMaintenanceStore'

type RetriableRequest = InternalAxiosRequestConfig & { _retry?: boolean }

class MissingRefreshTokenError extends Error {}

const api = axios.create({
  baseURL: import.meta.env['VITE_API_URL'],
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
})

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

function isRefreshAuthFailure(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 401
}

function shouldClearAfterRefreshFailure(err: unknown): boolean {
  return err instanceof MissingRefreshTokenError || isRefreshAuthFailure(err)
}

function clearAndRedirect() {
  useAuthStore.getState().clearAuth()
  window.location.href = '/login'
}

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const { refreshToken, driver } = useAuthStore.getState()
    if (!refreshToken) throw new MissingRefreshTokenError('Missing refresh token')
    const res = await axios.post(
      `${import.meta.env['VITE_API_URL']}/api/v1/auth/refresh`,
      { refreshToken },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    )
    const tokens = res.data.tokens as { accessToken: string; refreshToken: string }
    if (!driver) throw new MissingRefreshTokenError('Missing driver profile')
    useAuthStore.getState().setAuth(tokens.accessToken, tokens.refreshToken, driver)
    return tokens.accessToken
  })().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

api.interceptors.request.use(
  async (config) => {
    let token = useAuthStore.getState().token
    if (token && !isAuthEndpoint(config.url) && tokenExpiresSoon(token)) {
      try {
        token = await refreshAccessToken()
      } catch (err) {
        if (shouldClearAfterRefreshFailure(err)) {
          clearAndRedirect()
          return Promise.reject(err)
        }
      }
    }
    if (token) config.headers['Authorization'] = `Bearer ${token}`
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

    if (error.response?.status === 503 && code === 'MAINTENANCE_MODE') {
      const retryAfterHeader = Number(error.response.headers?.['retry-after'])
      useMaintenanceStore.getState().setMaintenance({
        isUnderMaintenance: true,
        message: error.response.data?.message,
        retryAfterSeconds: Number.isFinite(retryAfterHeader) ? retryAfterHeader : undefined,
      })
      return Promise.reject(error)
    }

    if (
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
        if (shouldClearAfterRefreshFailure(refreshErr)) clearAndRedirect()
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
