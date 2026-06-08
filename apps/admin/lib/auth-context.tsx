'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { type AdminProfile, getStoredAdmin, getAdminToken, clearAdminAuth, adminAuthApi } from './auth'

interface AdminAuthContextType {
  admin: AdminProfile | null
  isLoading: boolean
  isAuthenticated: boolean
  setAdmin: (admin: AdminProfile | null) => void
  logout: () => void
}

const AdminAuthContext = createContext<AdminAuthContextType | null>(null)

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      const token = getAdminToken()
      if (!token) {
        setIsLoading(false)
        return
      }

      // Show stored data instantly while verifying
      const stored = getStoredAdmin()
      if (stored) setAdmin(stored)

      try {
        const fresh = await adminAuthApi.getMe()
        setAdmin(fresh)
        localStorage.setItem('ocar_admin_data', JSON.stringify(fresh))
      } catch {
        clearAdminAuth()
        window.location.href = '/login'
      } finally {
        setIsLoading(false)
      }
    }

    void init()
  }, [])

  const logout = () => {
    clearAdminAuth()
    setAdmin(null)
    window.location.href = '/login'
  }

  return (
    <AdminAuthContext.Provider value={{ admin, isLoading, isAuthenticated: !!admin, setAdmin, logout }}>
      {isLoading ? <AdminLoadingScreen /> : children}
    </AdminAuthContext.Provider>
  )
}

function AdminLoadingScreen() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="text-2xl font-bold">
          <span className="text-primary">O</span>
          <span className="text-text-primary">car</span>
        </div>
        <div className="flex gap-1.5">
          {[0, 150, 300].map((delay) => (
            <div
              key={delay}
              className="w-2 h-2 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
        <p className="text-text-muted text-sm">Loading admin panel...</p>
      </div>
    </div>
  )
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext)
  if (!ctx) throw new Error('useAdminAuth must be used inside AdminAuthProvider')
  return ctx
}
