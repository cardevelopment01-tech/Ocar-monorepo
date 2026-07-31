'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, ArrowLeft, ArrowRight } from 'lucide-react'
import OtpInput from '@/components/ui/OtpInput'
import OcarSpinner from '@/components/ui/OcarSpinner'
import OcarLogoMark from '@/components/ui/OcarLogoMark'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { authApi, storeAuth, formatPhone, isValidIndianPhone } from '@/lib/auth'
import { DEMO_MODE } from '@/lib/demo'

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

type Step = 'phone' | 'otp'

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [devOtp, setDevOtp] = useState('')
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const otpRequestInFlightRef = useRef(false)

  const isPhoneValid = isValidIndianPhone(phone)

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [])

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

  async function handleSendOtp() {
    if (!isPhoneValid || loading || otpRequestInFlightRef.current) return
    otpRequestInFlightRef.current = true
    setError('')
    setLoading(true)
    try {
      const result = await authApi.requestOtp(formatPhone(phone))
      if ((DEMO_MODE || process.env.NODE_ENV === 'development') && result.otp) setDevOtp(result.otp)
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
      otpRequestInFlightRef.current = false
      setLoading(false)
    }
  }

  function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault()
    void handleSendOtp()
  }

  async function submitOtp(code: string) {
    if (code.length < 6 || loading) return
    setError('')
    setLoading(true)
    try {
      const result = await authApi.verifyOtp(formatPhone(phone), code)
      storeAuth(result.tokens.accessToken, result.tokens.refreshToken, result.principal)
      if (result.isNew || !result.principal.name) {
        router.push('/onboarding')
      } else {
        router.push('/home')
      }
    } catch (err: unknown) {
      const apiCode = (err as { response?: { data?: { code?: string } } })?.response?.data?.code
      if (apiCode === 'AUTH_OTP_INVALID') {
        setError('Incorrect code. Please try again.')
        setOtp('')
      } else if (apiCode === 'AUTH_OTP_EXPIRED') {
        setError('Code expired. Request a new one.')
        setStep('phone')
        setCountdown(0)
      } else if (apiCode === 'AUTH_OTP_LOCKED') {
        setError('Too many wrong attempts. Please wait 15 minutes.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  function handleOtpChange(code: string) {
    setOtp(code)
    setError('')
    if (code.length === 6) void submitOtp(code)
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col"
      style={{ background: 'linear-gradient(160deg, #0F0F23 0%, #1E1B4B 100%)' }}
    >
      {/* ── One static ambient glow, no orbs/particles/dot-grid ── */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden flex items-start justify-center"
      >
        <div
          style={{
            width: 300, height: 300, marginTop: 30,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 50% 45%, rgba(10,159,176,0.55) 0%, rgba(220,62,147,0.38) 50%, transparent 72%)',
            filter: 'blur(44px)',
            mixBlendMode: 'screen',
          }}
        />
      </div>

      {/* ── Hero logo block ── */}
      <motion.div
        className="relative flex flex-col items-center justify-center pt-20 pb-10 px-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <OcarLogoMark size="xl" className="mb-4" />
        <p className="text-sm mt-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Your ride, your city
        </p>
      </motion.div>

      {/* ── Form card ── */}
      <motion.div
        className="flex-1 relative z-10 rounded-t-[32px] bg-white flex flex-col px-6 pt-8 pb-10"
        style={{ boxShadow: '0 -4px 40px rgba(0,0,0,0.25)' }}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE, delay: 0.1 }}
      >
        <AnimatePresence mode="wait">
          {step === 'phone' ? (
            <motion.div
              key="phone"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32, pointerEvents: 'none' }}
              transition={{ duration: 0.22, ease: EASE }}
              className="flex-1 flex flex-col"
            >
              <h1 className="text-2xl font-bold text-text-primary mb-1">Welcome back</h1>
              <p className="text-text-secondary text-sm mb-8">Enter your phone number to continue</p>

              <form onSubmit={handlePhoneSubmit} className="flex-1 flex flex-col">
                <div
                  className="relative flex items-center gap-2 rounded-2xl px-4 h-[54px] mb-4 transition-all duration-200"
                  style={{
                    background: '#FAFBFF',
                    border: '1.5px solid #E8EEFF',
                    boxShadow: '0 2px 8px rgba(10, 159, 176,0.06)',
                  }}
                >
                  <Phone size={15} className="text-primary flex-shrink-0" />
                  <span className="text-sm font-semibold text-text-secondary">+91</span>
                  <div className="w-px h-5 bg-border" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={phone}
                    onChange={e => { setPhone(e.target.value.replace(/\D/g, '')); setError('') }}
                    placeholder="10-digit mobile number"
                    className="flex-1 bg-transparent text-text-primary font-medium text-base outline-none placeholder:text-text-muted tracking-wider"
                    autoFocus
                  />
                </div>

                {error && (
                  <div
                    className="mb-4 px-4 py-2.5 rounded-xl text-sm font-medium text-status-error flex items-center gap-2"
                    style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3.5a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 4.5zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                    {error}
                  </div>
                )}

                <motion.button
                  type="submit"
                  disabled={!isPhoneValid || loading}
                  className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
                  whileTap={isPhoneValid && !loading ? { scale: 0.97 } : {}}
                  transition={SPRING}
                >
                  {loading ? (
                    <OcarSpinner size={20} variant="white" />
                  ) : (
                    <>Send OTP <ArrowRight size={17} /></>
                  )}
                </motion.button>

                <p className="text-center text-text-muted text-xs mt-auto pt-10">
                  By continuing you agree to our Terms & Privacy Policy
                </p>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 32 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -32 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="flex-1 flex flex-col"
            >
              <motion.button
                type="button"
                onClick={() => { setStep('phone'); setOtp(''); setError(''); setCountdown(0) }}
                className="flex items-center gap-2 text-text-secondary text-sm mb-6 -ml-1 cursor-pointer"
                whileTap={{ scale: 0.94 }}
                transition={SPRING}
              >
                <div className="w-8 h-8 rounded-xl bg-surface-2 flex items-center justify-center">
                  <ArrowLeft size={15} className="text-text-primary" />
                </div>
                <span className="font-medium">Back</span>
              </motion.button>

              <h1 className="text-2xl font-bold text-text-primary mb-1">Verify OTP</h1>
              <p className="text-text-secondary text-sm mb-6">
                Sent to <span className="font-semibold text-text-primary">+91 {phone}</span>
              </p>

              {(DEMO_MODE || process.env.NODE_ENV === 'development') && devOtp && (
                <div
                  className="mb-5 px-4 py-2.5 rounded-xl flex items-center justify-between"
                  style={{ background: 'rgba(234,179,8,0.10)', border: '1px dashed rgba(234,179,8,0.45)' }}
                >
                  <span className="text-xs font-semibold text-yellow-600">Dev OTP</span>
                  <span className="font-mono font-bold text-lg tracking-[0.25em] text-yellow-700">{devOtp}</span>
                </div>
              )}

              <OtpInput
                length={6}
                value={otp}
                onChange={handleOtpChange}
                disabled={loading}
                error={!!error}
              />

              {error && (
                <motion.p
                  className="text-status-error text-sm mt-4 text-center font-medium"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {error}
                </motion.p>
              )}

              <motion.button
                type="button"
                onClick={() => void submitOtp(otp)}
                disabled={otp.length < 6 || loading}
                className="btn-primary w-full mt-6 flex items-center justify-center gap-2"
                whileTap={otp.length === 6 && !loading ? { scale: 0.97 } : {}}
                transition={SPRING}
              >
                {loading ? (
                  <OcarSpinner size={20} variant="white" />
                ) : (
                  <>Verify OTP <ArrowRight size={17} /></>
                )}
              </motion.button>

              <motion.button
                type="button"
                onClick={handleSendOtp}
                disabled={loading || countdown > 0}
                className={cn(
                  'w-full text-center text-sm mt-4 font-semibold',
                  countdown > 0 || loading
                    ? 'text-text-muted pointer-events-none'
                    : 'text-primary cursor-pointer',
                )}
                whileTap={!loading && countdown === 0 ? { scale: 0.97 } : {}}
              >
                {countdown > 0 ? `Resend in ${countdown}s` : 'Resend OTP'}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
