'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { type UserProfile, getStoredUser, getToken, getRefreshToken, clearAuth } from './auth'
import api from './api'

interface AuthContextType {
  user: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean
  setUser: (user: UserProfile | null) => void
  logout: () => void
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

  const logout = () => {
    const refreshToken = getRefreshToken()
    if (refreshToken) {
      void api.post('/api/v1/auth/logout', { refreshToken }).catch(() => undefined)
    }
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

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
            <span className="text-white font-black text-3xl">O</span>
          </div>
          <div className="flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
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
