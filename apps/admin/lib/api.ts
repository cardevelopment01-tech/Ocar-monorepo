import axios from 'axios'
import { getAdminRefreshToken, storeAdminAuth, clearAdminAuth, getStoredAdmin } from './auth'

const api = axios.create({
  baseURL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000',
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
})

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('ocar_admin_token')
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
  }
  return config
})

let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

function drainQueue(newToken: string) {
  refreshQueue.forEach(cb => cb(newToken))
  refreshQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/admin/login')
    const isRefreshRequest = error.config?.url?.includes('/auth/refresh')

    if (error.response?.status === 401 && !isLoginRequest && !isRefreshRequest && typeof window !== 'undefined') {
      const refreshToken = getAdminRefreshToken()

      if (!refreshToken) {
        clearAdminAuth()
        window.location.href = '/login'
        return Promise.reject(error)
      }

      // If a refresh is already in flight, queue this request to retry after
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push((newToken: string) => {
            error.config.headers['Authorization'] = `Bearer ${newToken}`
            resolve(api(error.config))
          })
          void reject
        })
      }

      isRefreshing = true
      try {
        const res = await axios.post(
          `${process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000'}/api/v1/auth/refresh`,
          { refreshToken },
          { headers: { 'Content-Type': 'application/json' } }
        )
        const { accessToken, refreshToken: newRefreshToken } = res.data.tokens as { accessToken: string; refreshToken: string }

        const admin = getStoredAdmin()
        if (admin) storeAdminAuth(accessToken, admin, newRefreshToken)

        drainQueue(accessToken)
        error.config.headers['Authorization'] = `Bearer ${accessToken}`
        return api(error.config)
      } catch {
        clearAdminAuth()
        window.location.href = '/login'
        return Promise.reject(error)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  }
)

export default api
