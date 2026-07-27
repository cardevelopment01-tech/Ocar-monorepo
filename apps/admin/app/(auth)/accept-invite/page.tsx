'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react'
import { adminInvitesApi } from '@/lib/admin-invites-api'
import { cn } from '@/lib/utils'

const INVALID_INVITE_MESSAGE = 'This invite link is invalid, expired, or already used. Ask a super admin to send a new one.'

function AcceptInviteForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  // 'checking' (verifying token on load) -> 'valid' (show form) | 'invalid' (show error, no form)
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid'>('checking')
  const [inviteEmail, setInviteEmail] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setStatus('invalid')
      return
    }
    let cancelled = false
    void adminInvitesApi.verify(token)
      .then(result => {
        if (cancelled) return
        setInviteEmail(result.email)
        setStatus('valid')
      })
      .catch(() => {
        if (!cancelled) setStatus('invalid')
      })
    return () => { cancelled = true }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

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
      const httpStatus = (err as { response?: { status?: number } })?.response?.status
      const body = (err as { response?: { data?: { error?: string } } })?.response?.data
      if (httpStatus === 400) {
        setError(INVALID_INVITE_MESSAGE)
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
              {status === 'invalid' ? 'Invite unavailable' : 'Activate your account'}
            </h1>
            <p className="text-text-muted text-sm mt-1.5">
              {status === 'valid' && inviteEmail
                ? `Set a password for ${inviteEmail} to finish joining Ocar admin`
                : status === 'invalid'
                  ? 'This invite link can no longer be used'
                  : 'Set a password to finish joining the Ocar admin panel'}
            </p>
          </div>

          {status === 'checking' ? (
            <div className="flex items-center gap-2.5 text-text-muted text-sm py-2">
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              Checking your invite…
            </div>
          ) : status === 'invalid' ? (
            <div className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              {INVALID_INVITE_MESSAGE}
            </div>
          ) : (
            <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-2">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full px-4 py-3 pr-11 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm outline-none focus:border-primary transition-colors"
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
                <label className="block text-xs font-semibold text-text-secondary mb-2">
                  Confirm Password
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm outline-none focus:border-primary transition-colors"
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
                className={cn(
                  'w-full py-3 px-6 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
                  isLoading ? 'bg-[#6366F1]' : 'bg-brand shadow-[0_4px_16px_rgba(79,70,229,0.35)]'
                )}
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
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  )
}
