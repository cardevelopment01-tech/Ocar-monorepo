'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, ArrowLeft, ArrowRight } from 'lucide-react'
import OtpInput from '@/components/ui/OtpInput'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { authApi, storeAuth, formatPhone, isValidIndianPhone } from '@/lib/auth'
import { DEMO_MODE } from '@/lib/demo'

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

type Step = 'phone' | 'otp'

const PARTICLES = [
  { top: '12%', left: '8%',  delay: 0,   dur: 2.8 },
  { top: '22%', left: '78%', delay: 0.7, dur: 3.4 },
  { top: '55%', left: '88%', delay: 1.2, dur: 2.6 },
  { top: '68%', left: '6%',  delay: 0.4, dur: 3.1 },
]

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
      if (process.env.NODE_ENV === 'development' && result.otp) setDevOtp(result.otp)
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

  async function handleVerifyOtp(code: string) {
    setOtp(code)
    if (code.length < 6) return
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

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(160deg, #0F0F23 0%, #1E1B4B 100%)' }}
    >
      {/* ── Decorative orbs ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 260, height: 260, top: -80, right: -60,
            background: 'radial-gradient(circle, rgba(99,102,241,0.40) 0%, transparent 70%)',
            filter: 'blur(52px)',
          }}
          animate={{ x: [0, 16, -6, 0], y: [0, -12, 8, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 200, height: 200, bottom: 120, left: -60,
            background: 'radial-gradient(circle, rgba(124,58,237,0.30) 0%, transparent 70%)',
            filter: 'blur(44px)',
          }}
          animate={{ x: [0, -10, 14, 0], y: [0, 16, -8, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
        />
        {/* Dot grid */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        {/* Twinkling particles */}
        {PARTICLES.map((p, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-white"
            style={{ top: p.top, left: p.left }}
            animate={{ opacity: [0.15, 0.7, 0.15], scale: [0.8, 1.3, 0.8] }}
            transition={{ duration: p.dur, repeat: Infinity, ease: 'easeInOut', delay: p.delay }}
          />
        ))}
      </div>

      {/* ── Hero logo block ── */}
      <motion.div
        className="flex flex-col items-center justify-center pt-20 pb-10 px-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <div
          className="w-16 h-16 rounded-[22px] flex items-center justify-center mb-4"
          style={{
            background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
            boxShadow: '0 12px 40px rgba(79,70,229,0.45), inset 0 1px 0 rgba(255,255,255,0.20)',
          }}
        >
          <span className="text-white font-black text-3xl">O</span>
        </div>
        <p className="text-white font-black text-3xl tracking-tight">car</p>
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
                    boxShadow: '0 2px 8px rgba(79,70,229,0.06)',
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
                    <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
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
                onChange={handleVerifyOtp}
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

              {loading && (
                <div className="flex justify-center mt-8">
                  <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
              )}

              <motion.button
                type="button"
                onClick={handleSendOtp}
                disabled={loading || countdown > 0}
                className={cn(
                  'w-full text-center text-sm mt-auto pt-10 font-semibold',
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
