'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { type UserProfile, getStoredUser, getToken, getRefreshToken, clearAuth } from './auth'
import api from './api'
import { registerPush, unregisterPush } from './push'
import OcarSpinner from '@/components/ui/OcarSpinner'

interface AuthContextType {
  user: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean
  setUser: (user: UserProfile | null) => void
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const PROTECTED_PATHS = [
      '/home', '/ride', '/history', '/wallet',
      '/profile', '/search', '/select-ride', '/onboarding',
    ]

    const init = async () => {
      const token = getToken()
      if (!token) {
        const path = window.location.pathname
        if (PROTECTED_PATHS.some(p => path.startsWith(p))) {
          clearAuth() // wipe stale cookie so middleware doesn't bounce back
          window.location.href = '/login'
          return // keep spinner until redirect fires
        }
        setIsLoading(false)
        return
      }

      // Show stored user instantly, then verify in background
      const stored = getStoredUser()
      if (stored) setUser(stored)

      try {
        const res = await api.get<{ principal: UserProfile }>('/api/v1/auth/me')
        const fresh = res.data.principal
        setUser(fresh)
        localStorage.setItem('ocar_user_data', JSON.stringify(fresh))
        void registerPush()
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 401) {
          clearAuth()
          window.location.href = '/login'
        }
      } finally {
        setIsLoading(false)
      }
    }

    void init()
  }, [])

  const logout = async () => {
    const refreshToken = getRefreshToken()
    if (refreshToken) {
      void api.post('/api/v1/auth/logout', { refreshToken }).catch(() => undefined)
    }
    await unregisterPush()
    clearAuth()
    setUser(null)
    window.location.href = '/login'
  }

  const refreshUser = async () => {
    const res = await api.get<{ principal: UserProfile }>('/api/v1/auth/me')
    const fresh = res.data.principal
    setUser(fresh)
    localStorage.setItem('ocar_user_data', JSON.stringify(fresh))
  }

  // Only block render when we have NO user to show yet (first install / pre-redirect).
  // Returning users see content instantly; verification happens silently in the background.
  if (isLoading && !user) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: '#0F0D1A' }}>
        <OcarSpinner size={32} variant="white" />
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      setUser,
      logout,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
