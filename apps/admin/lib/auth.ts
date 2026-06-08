import api from './api'

// Matches actual DB schema — admins table has no full_name column
export interface AdminProfile {
  id: string
  code: string
  email: string
  role: 'super_admin' | 'ops_admin' | 'support_admin' | 'finance_admin'
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface AdminAuthResponse {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number }
  admin: AdminProfile
}

export function storeAdminAuth(token: string, admin: AdminProfile) {
  localStorage.setItem('ocar_admin_token', token)
  localStorage.setItem('ocar_admin_data', JSON.stringify(admin))
  document.cookie = `ocar_admin_token=${token}; path=/; max-age=86400`
}

export function clearAdminAuth() {
  localStorage.removeItem('ocar_admin_token')
  localStorage.removeItem('ocar_admin_data')
  document.cookie = 'ocar_admin_token=; path=/; max-age=0'
}

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('ocar_admin_token')
}

export function getStoredAdmin(): AdminProfile | null {
  if (typeof window === 'undefined') return null
  const data = localStorage.getItem('ocar_admin_data')
  if (!data) return null
  try { return JSON.parse(data) as AdminProfile }
  catch { return null }
}

export const adminAuthApi = {
  login: async (email: string, password: string): Promise<AdminAuthResponse> => {
    const res = await api.post('/api/v1/auth/admin/login', { email, password })
    return res.data as AdminAuthResponse
  },

  // /api/v1/auth/me handles admin JWTs — returns { principal, role }
  getMe: async (): Promise<AdminProfile> => {
    const res = await api.get('/api/v1/auth/me')
    return res.data.principal as AdminProfile
  },

  logout: () => {
    clearAdminAuth()
    window.location.href = '/login'
  },
}
