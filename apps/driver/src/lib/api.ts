import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env['VITE_API_URL'],
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
})

api.interceptors.request.use(
  (config) => {
    const raw = localStorage.getItem('ocar_driver_auth')
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { state?: { token?: string } }
        if (parsed.state?.token) {
          config.headers['Authorization'] = `Bearer ${parsed.state.token}`
        }
      } catch {
        // ignore malformed storage
      }
    }
    return config
  },
  (error) => Promise.reject(error)
)

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const code = error.response?.data?.code
    const isTokenError = code === 'AUTH_UNAUTHORIZED' || code === 'AUTH_TOKEN_INVALID' || code === 'AUTH_TOKEN_EXPIRED'
    if (error.response?.status === 401 && isTokenError) {
      localStorage.removeItem('ocar_driver_auth')
      window.location.href = '/login'
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
