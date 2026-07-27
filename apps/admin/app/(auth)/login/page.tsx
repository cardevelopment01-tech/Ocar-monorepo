'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react'
import { adminAuthApi, storeAdminAuth } from '@/lib/auth'
import { registerPush } from '@/lib/push'
import { cn } from '@/lib/utils'

function AdminLoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const justInvited = searchParams.get('invited') === '1'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpError, setTotpError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const finishLogin = (tokens: { accessToken: string; refreshToken: string }, admin: Parameters<typeof storeAdminAuth>[1]) => {
    storeAdminAuth(tokens.accessToken, admin, tokens.refreshToken)
    void registerPush()
    router.push('/overview')
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.')
      return
    }

    setIsLoading(true)
    try {
      const result = await adminAuthApi.login(email.trim().toLowerCase(), password)
      if ('pending' in result) {
        setPendingToken(result.pendingToken)
      } else {
        finishLogin(result.tokens, result.admin)
      }
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

  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault()
    setTotpError(null)
    if (!pendingToken) return

    setVerifying(true)
    try {
      const { tokens, admin } = await adminAuthApi.verifyTotp(pendingToken, totpCode.trim())
      finishLogin(tokens, admin)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 401) {
        setTotpError('Invalid or expired code. Check your authenticator app, or use a recovery code.')
      } else {
        setTotpError('Could not verify code. Please try again.')
      }
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#F8FAFF' }}>
      <div className="w-full max-w-sm">

        {/* Brand mark */}
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center">
            <span className="text-white font-black">O</span>
          </div>
          <span className="text-text-primary font-black text-xl">car</span>
        </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-text-primary">
              {pendingToken ? 'Two-factor authentication' : 'Welcome back'}
            </h1>
            <p className="text-text-muted text-sm mt-1.5">
              {pendingToken
                ? 'Enter the code from your authenticator app'
                : 'Sign in to your admin account to continue'}
            </p>
          </div>

          {justInvited && !pendingToken && (
            <div className="bg-success-light text-success text-sm font-medium px-4 py-3 rounded-xl flex items-center gap-2 mb-5">
              <CheckCircle2 size={16} className="flex-shrink-0" />
              Account activated — sign in to continue.
            </div>
          )}

          {pendingToken ? (
            <form onSubmit={e => void handleVerifyTotp(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-2">
                  Verification Code
                </label>
                <input
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value)}
                  placeholder="123456 or a recovery code"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm font-mono tracking-widest outline-none focus:border-primary transition-colors"
                  autoComplete="one-time-code"
                  autoFocus
                />
              </div>

              {totpError && (
                <div className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl flex items-center gap-2">
                  <ShieldCheck size={14} className="flex-shrink-0" />
                  {totpError}
                </div>
              )}

              <button
                type="submit"
                disabled={verifying || !totpCode.trim()}
                className={cn(
                  'w-full py-3 px-6 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
                  verifying ? 'bg-[#6366F1]' : 'bg-brand shadow-[0_4px_16px_rgba(79,70,229,0.35)]'
                )}
              >
                {verifying ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>Verify <ArrowRight size={16} /></>
                )}
              </button>

              <button
                type="button"
                onClick={() => { setPendingToken(null); setTotpCode(''); setTotpError(null) }}
                className="w-full text-center text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              >
                Back to sign in
              </button>
            </form>
          ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@ocar.com"
                className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm outline-none focus:border-primary transition-colors"
                autoComplete="email"
                autoFocus
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-11 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm outline-none focus:border-primary transition-colors"
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
              className={cn(
                'w-full py-3 px-6 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
                isLoading ? 'bg-[#6366F1]' : 'bg-brand shadow-[0_4px_16px_rgba(79,70,229,0.35)]'
              )}
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
          )}

          <p className="text-center text-text-muted mt-8" style={{ fontSize: '11px' }}>
            Ocar · Internal Tool &nbsp;·&nbsp; Authorised Personnel Only
          </p>
      </div>
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginForm />
    </Suspense>
  )
}
