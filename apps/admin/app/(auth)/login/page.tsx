'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Shield } from 'lucide-react'
import { adminAuthApi, storeAdminAuth } from '@/lib/auth'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.')
      return
    }

    setIsLoading(true)
    try {
      const { tokens, admin } = await adminAuthApi.login(email.trim().toLowerCase(), password)
      storeAdminAuth(tokens.accessToken, admin)
      router.push('/overview')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response?.status
      const body   = (err as { response?: { data?: { error?: string } } })?.response?.data
      if (status === 401) {
        setError('Invalid email or password.')
      } else if (status === 403) {
        setError('Your account has been deactivated.')
      } else if (body?.error) {
        setError(body.error)
      } else {
        setError('Login failed. Please try again.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-3xl font-bold mb-2">
            <span className="text-primary">O</span>
            <span className="text-text-primary">car</span>
          </div>
          <div className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-semibold px-3 py-1 rounded-full">
            <Shield size={12} />
            Admin Panel
          </div>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-2xl shadow-card p-8">
          <h1 className="text-xl font-bold text-text-primary mb-1">Welcome back</h1>
          <p className="text-text-secondary text-sm mb-6">Sign in to your admin account</p>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@ocar.com"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-canvas text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-primary transition-colors"
                autoComplete="email"
                autoFocus
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border border-border bg-canvas text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-primary transition-colors"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl flex items-center gap-2">
                <span>⚠</span> {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-6 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-text-muted mt-6" style={{ fontSize: '11px' }}>
          Ocar Internal Tool — Authorised Personnel Only
        </p>
      </div>
    </div>
  )
}
