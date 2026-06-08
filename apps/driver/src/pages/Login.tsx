import { useState, useEffect, useRef } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import OtpInput from '@/components/ui/OtpInput'
import api from '@/lib/api'
import { useAuthStore, type DriverProfile } from '@/store/useAuthStore'

type Step = 'phone' | 'otp'

interface VerifyOtpResponse {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number }
  principal: DriverProfile
  isNew: boolean
}

function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 10) return `+91${digits}`
  return `+${digits}`
}

function getOnboardingRoute(driver: DriverProfile): string {
  if (driver.status === 'active') return '/'
  if (driver.status === 'pending_approval') return '/onboarding/pending-review'
  switch (driver.onboarding_step) {
    case 'personal_info': return '/onboarding/personal'
    case 'vehicle_info':  return '/onboarding/vehicle'
    case 'documents':     return '/onboarding/documents'
    case 'vehicle_docs':  return '/onboarding/vehicle-docs'
    case 'selfie':        return '/onboarding/selfie'
    default:              return '/onboarding/personal'
  }
}

export default function Login() {
  const { isAuthenticated, driver, setAuth } = useAuthStore()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const navigate = useNavigate()

  // All hooks above this point — conditional return is safe here
  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [])

  if (isAuthenticated && driver) {
    return <Navigate to={getOnboardingRoute(driver)} replace />
  }

  function startCountdown() {
    setCountdown(60)
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current!); return 0 }
        return prev - 1
      })
    }, 1000)
  }

  async function handlePhoneSubmit() {
    if (phone.length !== 10) return
    setError('')
    setLoading(true)
    try {
      await api.post('/api/v1/auth/otp/request', {
        phone: formatPhone(phone),
        role: 'driver',
        purpose: 'login',
      })
      setStep('otp')
      setOtp('')
      startCountdown()
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (code === 'AUTH_OTP_RATE_LIMITED') {
        setError('Too many attempts. Please wait before trying again.')
      } else {
        setError('Failed to send OTP. Please check your number.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleOtpSubmit() {
    if (otp.length !== 6) return
    setError('')
    setLoading(true)
    try {
      const res = await api.post<VerifyOtpResponse>('/api/v1/auth/otp/verify', {
        phone: formatPhone(phone),
        otp,
        role: 'driver',
        purpose: 'login',
      })
      const { tokens, principal } = res.data
      setAuth(tokens.accessToken, tokens.refreshToken, principal)
      navigate(getOnboardingRoute(principal), { replace: true })
    } catch (err: unknown) {
      setOtp('')
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (code === 'AUTH_OTP_INVALID') {
        setError('Incorrect code. Please try again.')
      } else if (code === 'AUTH_OTP_EXPIRED') {
        setError('Code has expired. Request a new one.')
        setStep('phone')
      } else if (code === 'AUTH_OTP_LOCKED') {
        setError('Too many attempts. Please wait 15 minutes.')
      } else {
        setError('Verification failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-12">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center bg-primary"
          style={{ boxShadow: '0 0 24px rgba(34,197,94,0.35)' }}
        >
          <span className="text-text-inverse font-black text-2xl">O</span>
        </div>
        <div>
          <p className="text-text-primary font-black text-2xl leading-none">car</p>
          <p className="text-text-muted text-xs">Driver Partner</p>
        </div>
      </div>

      <div className="w-full max-w-[360px] bg-surface rounded-3xl p-7 border border-border">
        {step === 'phone' ? (
          <>
            <h1 className="text-text-primary font-bold text-2xl mb-1">Welcome back</h1>
            <p className="text-text-secondary text-sm mb-8">Enter your registered mobile number</p>

            <div className="mb-4">
              <label className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 block">
                Mobile Number
              </label>
              <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-xl px-4 h-[56px] focus-within:border-primary transition-colors">
                <span className="text-text-secondary font-semibold text-sm">+91</span>
                <div className="w-px h-5 bg-border" />
                <input
                  className="flex-1 bg-transparent text-text-primary font-semibold text-base outline-none placeholder:text-text-muted"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="9876543210"
                  value={phone}
                  onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }}
                  onKeyDown={e => e.key === 'Enter' && handlePhoneSubmit()}
                />
              </div>
            </div>

            {error && <p className="text-accent-red text-sm mb-4">{error}</p>}

            <button
              onClick={handlePhoneSubmit}
              disabled={phone.length !== 10 || loading}
              className="btn-go w-full"
              style={{ minHeight: 56 }}
            >
              {loading ? 'Sending OTP…' : 'Get OTP'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { setStep('phone'); setOtp(''); setError(''); setCountdown(0) }}
              className="text-text-muted text-sm mb-6 flex items-center gap-1 hover:text-text-secondary transition-colors"
            >
              ← Back
            </button>
            <h1 className="text-text-primary font-bold text-2xl mb-1">Enter OTP</h1>
            <p className="text-text-secondary text-sm mb-8">Sent to +91 {phone}</p>

            <div className="mb-4">
              <OtpInput
                length={6}
                value={otp}
                onChange={v => { setOtp(v); setError('') }}
                error={!!error}
              />
              {error && (
                <p className="text-accent-red text-xs text-center mt-3">{error}</p>
              )}
            </div>

            <button
              onClick={handleOtpSubmit}
              disabled={otp.length !== 6 || loading}
              className="btn-go w-full"
              style={{ minHeight: 56 }}
            >
              {loading ? 'Verifying…' : 'Verify & Login'}
            </button>

            <p className="text-text-muted text-xs text-center mt-4">
              Didn't receive?{' '}
              {countdown > 0 ? (
                <span className="text-text-muted">Resend in {countdown}s</span>
              ) : (
                <button onClick={handlePhoneSubmit} disabled={loading} className="text-primary font-semibold disabled:opacity-50">
                  {loading ? 'Sending…' : 'Resend'}
                </button>
              )}
            </p>
          </>
        )}
      </div>

      <p className="text-text-muted text-xs text-center mt-8 max-w-[280px]">
        By continuing, you agree to Ocar's Driver Partner Terms & Conditions
      </p>
    </div>
  )
}
