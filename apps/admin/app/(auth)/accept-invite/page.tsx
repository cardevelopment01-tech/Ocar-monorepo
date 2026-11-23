'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff, ArrowRight, AlertCircle, Check, ShieldCheck } from 'lucide-react'
import { adminInvitesApi, type InvitePreview } from '@/lib/admin-invites-api'
import { adminAuthApi, storeAdminAuth } from '@/lib/auth'
import { registerPush } from '@/lib/push'
import { ROLE_LABEL, ROLE_HELP } from '@/lib/admin-roles'
import { cn } from '@/lib/utils'

// Length, not character-mix rules (NIST 800-63B-4). Keep in step with ADMIN_PASSWORD_MIN_LENGTH in api/src/lib/password-policy.ts.
const MIN_PASSWORD_LENGTH = 12

const INVALID_INVITE_MESSAGE = 'This invite link is invalid, expired, or already used. Ask a super admin to send a new one.'

function AcceptInviteForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  // 'checking' (verifying token on load) -> 'valid' (show form) | 'invalid' (show error, no form)
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid'>('checking')
  const [invite, setInvite] = useState<InvitePreview | null>(null)

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
        setInvite(result)
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

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsLoading(true)
    try {
      const created = await adminInvitesApi.redeem(token, password)
      // The account exists now. Sign them straight in and on to 2FA setup, instead of making them type the password again on the login page.
      // Anything unexpected (2FA already on, a network blip) just falls back to the login page: the account is made either way.
      try {
        const session = await adminAuthApi.login(created.email, password)
        if ('tokens' in session) {
          storeAdminAuth(session.tokens.accessToken, session.admin, session.tokens.refreshToken)
          void registerPush()
          router.push('/security?setup=1')
          return
        }
      } catch {
        // fall through
      }
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

  const longEnough = password.length >= MIN_PASSWORD_LENGTH
  const matches = confirmPassword.length > 0 && password === confirmPassword
  const greeting = invite?.full_name ? `Welcome, ${invite.full_name}` : 'Welcome to Ocar admin'

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: '#F6FBFB' }}>
      <div className="w-full max-w-[440px]">

        {/* Brand mark */}
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center">
            <span className="text-white font-black">O</span>
          </div>
          <span className="text-text-primary font-black text-xl">car</span>
        </div>

        <div className="bg-white rounded-2xl border border-border p-6 sm:p-8" style={{ boxShadow: '0 8px 32px rgba(15,23,42,0.06)' }}>
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-text-primary">
              {status === 'invalid' ? 'Invite unavailable' : status === 'valid' ? greeting : 'Activate your account'}
            </h1>
            <p className="text-text-muted text-sm mt-1.5">
              {status === 'valid' && invite
                ? `Set a password for ${invite.email} to finish joining Ocar admin`
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
            <>
              {invite && (
                <div className="mb-6 rounded-xl border border-border-light bg-surface-2 px-4 py-3" data-testid="invite-summary">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-text-secondary">Your role</span>
                    <span className="pill-info">{ROLE_LABEL[invite.role]}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{ROLE_HELP[invite.role]}</p>
                  {invite.invited_by_name && (
                    <p className="mt-2 text-xs text-text-muted">Invited by <span className="font-medium text-text-secondary">{invite.invited_by_name}</span></p>
                  )}
                </div>
              )}

              <form onSubmit={e => void handleSubmit(e)} className="space-y-4">
                <div>
                  <label htmlFor="new-password" className="block text-xs font-semibold text-text-secondary mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                      className="w-full px-4 py-3 pr-11 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm outline-none focus:border-primary transition-colors"
                      autoComplete="new-password"
                      autoFocus
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword(p => !p)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className={cn('mt-2 flex items-center gap-1.5 text-xs', longEnough ? 'text-success' : 'text-text-muted')}>
                    {longEnough ? <Check size={12} aria-hidden /> : <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
                    {MIN_PASSWORD_LENGTH} or more characters
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    A few random words work well. Avoid &quot;ocar&quot;, your email, and passwords you use elsewhere. We also check it against known data breaches.
                  </p>
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-xs font-semibold text-text-secondary mb-2">
                    Confirm Password
                  </label>
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-white text-text-primary placeholder:text-text-muted/60 text-sm outline-none focus:border-primary transition-colors"
                    autoComplete="new-password"
                  />
                  {matches && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-success"><Check size={12} aria-hidden /> Passwords match</p>
                  )}
                </div>

                {error && (
                  <div role="alert" className="bg-danger-light text-danger text-sm font-medium px-4 py-3 rounded-xl flex items-start gap-2">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className={cn(
                    'w-full py-3 px-6 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed',
                    isLoading ? 'bg-[#14ABBD]' : 'bg-brand shadow-[0_4px_16px_rgba(14,143,163,0.35)]'
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

                <p className="flex items-start gap-2 text-xs text-text-muted">
                  <ShieldCheck size={14} aria-hidden className="mt-0.5 flex-shrink-0" />
                  Next you will set up two-factor authentication with an authenticator app.
                </p>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-text-muted mt-6" style={{ fontSize: '11px' }}>
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
