import axios from 'axios'
import { clearAuth } from './auth'

const api = axios.create({
  baseURL: process.env['NEXT_PUBLIC_API_URL'],
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
})

api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('ocar_user_token')
      if (token) config.headers['Authorization'] = `Bearer ${token}`
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
    if (error.response?.status === 401 && isTokenError && typeof window !== 'undefined') {
      clearAuth()
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
