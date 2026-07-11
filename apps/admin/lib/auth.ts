import api from './api'

// Matches actual DB schema: admins table has no full_name column
export interface AdminProfile {
  id: string
  code: string
  email: string
  role: 'super_admin' | 'ops_admin' | 'support_admin' | 'finance_admin'
  is_active: boolean
  totp_enabled: boolean
  created_at: string
  updated_at: string
}

export interface AdminAuthResponse {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number }
  admin: AdminProfile
}

// Returned instead of AdminAuthResponse when the admin has 2FA enabled —
// password was correct, but no session exists yet until the code is verified.
export interface AdminLoginPending {
  pending: true
  pendingToken: string
}

export function storeAdminAuth(token: string, admin: AdminProfile, refreshToken?: string) {
  storeAdminTokens(token, refreshToken)
  localStorage.setItem('ocar_admin_data', JSON.stringify(admin))
}

export function storeAdminTokens(token: string, refreshToken?: string) {
  localStorage.setItem('ocar_admin_token', token)
  document.cookie = 'ocar_admin_session=1; path=/; max-age=86400; SameSite=Lax'
  document.cookie = 'ocar_admin_token=; path=/; max-age=0'
  if (refreshToken) localStorage.setItem('ocar_admin_refresh_token', refreshToken)
}

export function clearAdminAuth() {
  localStorage.removeItem('ocar_admin_token')
  localStorage.removeItem('ocar_admin_data')
  localStorage.removeItem('ocar_admin_refresh_token')
  document.cookie = 'ocar_admin_session=; path=/; max-age=0'
  document.cookie = 'ocar_admin_token=; path=/; max-age=0'
}

export function getAdminRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('ocar_admin_refresh_token')
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
  login: async (email: string, password: string): Promise<AdminAuthResponse | AdminLoginPending> => {
    const res = await api.post('/api/v1/auth/admin/login', { email, password })
    return res.data as AdminAuthResponse | AdminLoginPending
  },

  verifyTotp: async (pendingToken: string, code: string): Promise<AdminAuthResponse> => {
    const res = await api.post('/api/v1/auth/admin/totp-verify', { pendingToken, code })
    return res.data as AdminAuthResponse
  },

  // /api/v1/auth/me handles admin JWTs, returns { principal, role }
  getMe: async (): Promise<AdminProfile> => {
    const res = await api.get('/api/v1/auth/me')
    return res.data.principal as AdminProfile
  },

  logout: async () => {
    const refreshToken = getAdminRefreshToken()
    if (refreshToken) {
      try {
        await api.post('/api/v1/auth/logout', { refreshToken })
      } catch {
        // Best-effort server logout; local cleanup still wins.
      }
    }
    clearAdminAuth()
    window.location.href = '/login'
  },
}
