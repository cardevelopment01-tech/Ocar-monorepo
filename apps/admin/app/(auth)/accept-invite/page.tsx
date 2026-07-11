'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react'
import { adminInvitesApi } from '@/lib/admin-invites-api'

function AcceptInviteForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('This invite link is missing its token. Please use the link from your email.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsLoading(true)
    try {
      await adminInvitesApi.redeem(token, password)
      router.push('/login?invited=1')
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const body = (err as { response?: { data?: { error?: string } } })?.response?.data
      if (status === 400) {
        setError('This invite link is invalid, expired, or already used. Ask a super admin to send a new one.')
      } else if (body?.error) {
        setError(body.error)
      } else {
        setError('Could not accept the invite. Please try again.')
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
        <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <div className="absolute bottom-20 right-[-60px] w-56 h-56 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="absolute top-1/2 left-1/3 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.04)' }} />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <span className="text-white font-black text-lg">O</span>
            </div>
            <span className="text-white font-black text-2xl">car</span>
          </div>
        </div>

        <div className="relative space-y-4">
          <h2 className="text-4xl font-black text-white leading-tight">
            You&rsquo;ve been<br />invited
          </h2>
          <p className="text-white/70 text-base leading-relaxed max-w-xs">
            Set a password to activate your admin account and start managing the platform.
          </p>
        </div>

        <p className="relative text-white/40 text-xs">
          Ocar Internal Tool · Authorised Personnel Only
        </p>
      </div>

      {/* Right panel: form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">

          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}>
              <span className="text-white font-black">O</span>
            </div>
            <span className="text-text-primary font-black text-xl">car</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-text-primary">Activate your account</h1>
            <p className="text-text-muted text-sm mt-1.5">Set a password to finish joining the Ocar admin panel</p>
          </div>

          {!token ? (
            <div className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              This invite link is missing its token. Please use the link from your email.
            </div>
          ) : (
            <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-widest mb-2">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full px-4 py-3 pr-11 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm focus:outline-none transition-all"
                    style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4F46E5'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,70,229,0.12)' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)' }}
                    autoComplete="new-password"
                    autoFocus
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

              <div>
                <label className="block text-xs font-bold text-text-muted uppercase tracking-widest mb-2">
                  Confirm Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm focus:outline-none transition-all"
                  style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#4F46E5'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79,70,229,0.12)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(15,23,42,0.04)' }}
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <div className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl flex items-start gap-2">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

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
                    Activating...
                  </>
                ) : (
                  <>Activate Account <ArrowRight size={16} /></>
                )}
              </button>
            </form>
          )}

          <p className="text-center text-text-muted mt-8" style={{ fontSize: '11px' }}>
            Ocar · Internal Tool &nbsp;·&nbsp; Authorised Personnel Only
          </p>
        </div>
      </div>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  )
}
