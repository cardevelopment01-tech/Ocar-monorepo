import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env['VITE_API_URL'] ?? 'http://localhost:4000',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('driver-auth')
  if (token) {
    try {
      const parsed = JSON.parse(token) as { state?: { token?: string } }
      if (parsed.state?.token) {
        config.headers['Authorization'] = `Bearer ${parsed.state.token}`
      }
    } catch {
      // ignore malformed storage
    }
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('driver-auth')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
