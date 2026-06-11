import { useState, useEffect, useRef } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { ArrowRight, ChevronLeft, Car } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
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
  const [devOtp, setDevOtp] = useState('')
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const otpRequestInFlightRef = useRef(false)
  const otpVerifyInFlightRef = useRef(false)
  const navigate = useNavigate()

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [])

  // Auto-submit when all 6 digits are entered
  useEffect(() => {
    if (step === 'otp' && otp.length === 6) void handleOtpSubmit()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step])

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

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault()
    void handlePhoneSubmit()
  }

  async function handlePhoneSubmit() {
    if (phone.length !== 10 || loading || otpRequestInFlightRef.current) return
    otpRequestInFlightRef.current = true
    setError(''); setLoading(true)
    try {
      const res = await api.post<{ otp?: string }>('/api/v1/auth/otp/request', { phone: formatPhone(phone), role: 'driver', purpose: 'login' })
      if (import.meta.env.DEV && res.data.otp) setDevOtp(res.data.otp)
      setStep('otp'); setOtp(''); startCountdown()
    } catch (err: unknown) {
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
      setError(code === 'AUTH_OTP_RATE_LIMITED'
        ? 'Too many attempts. Please wait before trying again.'
        : 'Failed to send OTP. Please check your number.')
    } finally { otpRequestInFlightRef.current = false; setLoading(false) }
  }

  async function handleOtpSubmit() {
    if (otp.length !== 6 || loading || otpVerifyInFlightRef.current) return
    otpVerifyInFlightRef.current = true
    setError(''); setLoading(true)
    try {
      const res = await api.post<VerifyOtpResponse>('/api/v1/auth/otp/verify', {
        phone: formatPhone(phone), otp, role: 'driver', purpose: 'login',
      })
      const { tokens, principal } = res.data
      setAuth(tokens.accessToken, tokens.refreshToken, principal)
      navigate(getOnboardingRoute(principal), { replace: true })
    } catch (err: unknown) {
      setOtp('')
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (code === 'AUTH_OTP_INVALID')    setError('Incorrect code. Please try again.')
      else if (code === 'AUTH_OTP_EXPIRED') { setError('Code has expired. Request a new one.'); setStep('phone') }
      else if (code === 'AUTH_OTP_LOCKED')  setError('Too many attempts. Please wait 15 minutes.')
      else setError('Verification failed. Please try again.')
    } finally { otpVerifyInFlightRef.current = false; setLoading(false) }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5"
      style={{
        background: 'radial-gradient(ellipse at 50% -10%, rgba(37,99,235,0.08) 0%, #F5F8FF 55%)',
      }}
    >
      {/* Brand */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center mb-10"
      >
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(145deg, #3B82F6 0%, #2563EB 100%)',
              boxShadow: '0 4px 16px rgba(37,99,235,0.30)',
            }}
          >
            <Car size={22} className="text-white" strokeWidth={2} />
          </div>
          <p className="font-display font-bold text-3xl text-text-primary tracking-tight">Ocar</p>
        </div>
        <p className="text-text-muted text-sm font-medium">Driver Partner</p>
      </motion.div>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[360px] rounded-3xl p-7 bg-white"
        style={{
          border: '1px solid #E2E8F0',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.08)',
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {step === 'phone' ? (
            <motion.form
              key="phone"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              onSubmit={handleFormSubmit}
            >
              <h1 className="font-display font-bold text-2xl text-text-primary mb-1">Welcome back</h1>
              <p className="text-text-secondary text-sm mb-7">Enter your registered mobile number</p>

              <div className="mb-5">
                <label htmlFor="phone-input" className="block text-text-muted text-[11px] font-bold uppercase tracking-widest mb-2">
                  Mobile Number
                </label>
                <div
                  className="flex items-center gap-2 rounded-xl px-4 h-[56px] bg-surface-2 border border-border transition-all duration-200 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.10)]"
                >
                  <span className="text-text-secondary font-bold text-sm select-none">+91</span>
                  <div className="w-px h-5 bg-border" />
                  <input
                    id="phone-input"
                    className="flex-1 bg-transparent text-text-primary font-semibold text-base outline-none placeholder:text-text-muted"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="98765 43210"
                    value={phone}
                    autoComplete="tel"
                    onChange={e => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }}
                  />
                </div>
              </div>

              {error && (
                <div className="mb-4 px-4 py-3 rounded-xl text-sm font-medium text-accent-red flex items-center gap-2"
                  style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)' }}
                  role="alert"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3.5a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 4.5zm0 7a1 1 0 110-2 1 1 0 010 2z"/>
                  </svg>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={phone.length !== 10 || loading}
                className="btn-go w-full"
                style={{ minHeight: 56 }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
                    Sending OTP…
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Get OTP <ArrowRight size={18} aria-hidden="true" />
                  </span>
                )}
              </button>
            </motion.form>
          ) : (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
            >
              <button
                type="button"
                onClick={() => { setStep('phone'); setOtp(''); setError(''); setCountdown(0) }}
                className="flex items-center gap-1 text-text-muted text-sm mb-6 hover:text-text-secondary transition-colors cursor-pointer"
                aria-label="Back to phone number"
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Back
              </button>
              <h1 className="font-display font-bold text-2xl text-text-primary mb-1">Enter OTP</h1>
              <p className="text-text-secondary text-sm mb-3">Sent to +91 {phone}</p>
              {import.meta.env.DEV && devOtp && (
                <div className="mb-4 px-4 py-2.5 rounded-xl flex items-center justify-between"
                  style={{ background: 'rgba(234,179,8,0.10)', border: '1px dashed rgba(234,179,8,0.45)' }}>
                  <span className="text-xs font-semibold text-yellow-600">Dev OTP</span>
                  <span className="font-mono font-bold text-lg tracking-[0.25em] text-yellow-700">{devOtp}</span>
                </div>
              )}

              <div className="mb-5">
                <OtpInput
                  length={6}
                  value={otp}
                  onChange={v => { setOtp(v); setError('') }}
                  error={!!error}
                />
                {error && (
                  <p className="text-accent-red text-xs text-center mt-3 font-semibold" role="alert">{error}</p>
                )}
              </div>

              <button
                type="button"
                onClick={handleOtpSubmit}
                disabled={otp.length !== 6 || loading}
                className="btn-go w-full"
                style={{ minHeight: 56 }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
                    Verifying…
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Verify & Login <ArrowRight size={18} aria-hidden="true" />
                  </span>
                )}
              </button>

              <p className="text-text-muted text-xs text-center mt-5">
                Didn't receive?{' '}
                {countdown > 0 ? (
                  <span className="tabular-nums">Resend in {countdown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handlePhoneSubmit()}
                    disabled={loading}
                    className="text-primary font-bold disabled:opacity-50 cursor-pointer hover:text-primary-dark transition-colors"
                  >
                    {loading ? 'Sending…' : 'Resend OTP'}
                  </button>
                )}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <p className="text-text-muted text-xs text-center mt-8 max-w-[280px] leading-relaxed">
        By continuing, you agree to Ocar's Driver Partner Terms &amp; Conditions
      </p>
    </div>
  )
}
