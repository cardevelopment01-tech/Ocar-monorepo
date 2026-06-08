import axios from 'axios'

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
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('ocar_user_token')
      localStorage.removeItem('ocar_user_data')
      document.cookie = 'ocar_user_token=; path=/; max-age=0'
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
