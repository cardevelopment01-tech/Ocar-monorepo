import api from './api'

export interface UserProfile {
  id: string
  code: string
  phone: string
  name: string | null
  email: string | null
  status: string
  referral_code: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface VerifyOtpResponse {
  tokens: AuthTokens
  principal: UserProfile
  isNew: boolean
}

export function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 10) return `+91${digits}`
  return `+${digits}`
}

export function isValidIndianPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone.replace(/\D/g, ''))
}

export function storeAuth(accessToken: string, refreshToken: string, user: UserProfile) {
  localStorage.setItem('ocar_user_token', accessToken)
  localStorage.setItem('ocar_user_refresh', refreshToken)
  localStorage.setItem('ocar_user_data', JSON.stringify(user))
  // Cookie for Next.js middleware (30 days)
  document.cookie = `ocar_user_token=${accessToken}; path=/; max-age=2592000; SameSite=Lax`
}

export function clearAuth() {
  localStorage.removeItem('ocar_user_token')
  localStorage.removeItem('ocar_user_refresh')
  localStorage.removeItem('ocar_user_data')
  document.cookie = 'ocar_user_token=; path=/; max-age=0'
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('ocar_user_token')
}

export function getStoredUser(): UserProfile | null {
  if (typeof window === 'undefined') return null
  const data = localStorage.getItem('ocar_user_data')
  if (!data) return null
  try { return JSON.parse(data) as UserProfile }
  catch { return null }
}

export function isAuthenticated(): boolean {
  return !!getToken()
}

export const authApi = {
  requestOtp: async (phone: string) => {
    const response = await api.post('/api/v1/auth/otp/request', {
      phone,
      role: 'user',
      purpose: 'login',
    })
    return response.data as { message: string; otp?: string }
  },

  verifyOtp: async (phone: string, otp: string) => {
    const response = await api.post('/api/v1/auth/otp/verify', {
      phone,
      otp,
      role: 'user',
      purpose: 'login',
    })
    return response.data as VerifyOtpResponse
  },

  getMe: async () => {
    const response = await api.get('/api/v1/auth/me')
    return response.data.principal as UserProfile
  },

  logout: () => {
    clearAuth()
    window.location.href = '/login'
  },
}

export const userApi = {
  updateProfile: async (data: { full_name: string; email?: string }) => {
    const response = await api.patch('/api/v1/users/me', data)
    return response.data.user as UserProfile
  },
  getMe: async () => {
    const response = await api.get('/api/v1/users/me')
    return response.data.user as UserProfile & {
      total_rides: number
      rating_avg: number | null
      wallet_balance: number
    }
  },
}
