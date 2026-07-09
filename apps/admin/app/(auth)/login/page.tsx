'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'
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
      storeAdminAuth(tokens.accessToken, admin, tokens.refreshToken)
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
    <div className="min-h-screen flex" style={{ background: '#F8FAFF' }}>

      {/* Left panel: branding */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative overflow-hidden"
        style={{ background: 'linear-gradient(145deg, #4F46E5 0%, #7C3AED 50%, #A855F7 100%)' }}
      >
        {/* Background orbs */}
        <div
          className="absolute -top-24 -left-24 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        />
        <div
          className="absolute bottom-20 right-[-60px] w-56 h-56 rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.06)' }}
        />
        <div
          className="absolute top-1/2 left-1/3 w-40 h-40 rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.04)' }}
        />

        {/* Logo */}
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <span className="text-white font-black text-lg">O</span>
            </div>
            <span className="text-white font-black text-2xl">car</span>
          </div>
        </div>

        {/* Tagline */}
        <div className="relative space-y-4">
          <h2 className="text-4xl font-black text-white leading-tight">
            Operations<br />Command Center
          </h2>
          <p className="text-white/70 text-base leading-relaxed max-w-xs">
            Manage rides, drivers, payments, and platform health. All in one place.
          </p>

          <div className="flex flex-wrap gap-2 pt-2">
            {['Bhubaneswar', 'Cuttack', 'Puri'].map(city => (
              <span
                key={city}
                className="text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)' }}
              >
                {city}
              </span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative text-white/40 text-xs">
          Ocar Internal Tool · Authorised Personnel Only
        </p>
      </div>

      {/* Right panel: form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}
            >
              <span className="text-white font-black">O</span>
            </div>
            <span className="text-text-primary font-black text-xl">car</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-text-primary">Welcome back</h1>
            <p className="text-text-muted text-sm mt-1.5">Sign in to your admin account to continue</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-widest mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@ocar.com"
                className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm focus:outline-none transition-all"
                style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#4F46E5'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,70,229,0.12)' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)' }}
                autoComplete="email"
                autoFocus
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-widest mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-11 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm focus:outline-none transition-all"
                  style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#4F46E5'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,70,229,0.12)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)' }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3.5a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 4.5zm0 7a1 1 0 110-2 1 1 0 010 2z"/></svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-6 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: isLoading ? '#6366F1' : 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                boxShadow: isLoading ? 'none' : '0 4px 16px rgba(79,70,229,0.35)',
              }}
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </>
              ) : (
                <>Sign In <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          <p className="text-center text-text-muted mt-8" style={{ fontSize: '11px' }}>
            Ocar · Internal Tool &nbsp;·&nbsp; Authorised Personnel Only
          </p>
        </div>
      </div>
    </div>
  )
}
