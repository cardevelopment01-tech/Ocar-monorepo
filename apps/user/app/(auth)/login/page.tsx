'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, ArrowLeft, ArrowRight } from 'lucide-react'
import OtpInput from '@/components/ui/OtpInput'
import OcarLogo from '@/components/ui/OcarLogo'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { authApi, storeAuth, formatPhone, isValidIndianPhone } from '@/lib/auth'

type Step = 'phone' | 'otp'

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
        if (prev <= 1) {
          clearInterval(countdownRef.current!)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function handleSendOtp() {
    if (!isPhoneValid) return
    setError('')
    setLoading(true)
    try {
      await authApi.requestOtp(formatPhone(phone))
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

  async function handleVerifyOtp(code: string) {
    setOtp(code)
    if (code.length < 6) return
    setError('')
    setLoading(true)
    try {
      const result = await authApi.verifyOtp(formatPhone(phone), code)
      storeAuth(result.tokens.accessToken, result.tokens.refreshToken, result.principal)
      router.push('/home')
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
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col px-6">
        <div className="pt-16 pb-8 flex items-center justify-center">
          <OcarLogo size="lg" />
        </div>

        <AnimatePresence mode="wait">
          {step === 'phone' ? (
            <motion.div
              key="phone"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.25 }}
              className="flex-1"
            >
              <h1 className="text-2xl font-bold text-text-primary mb-1">Welcome back</h1>
              <p className="text-text-secondary text-sm mb-8">Enter your phone number to continue</p>

              <div className="relative mb-4">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-text-secondary">
                  <Phone size={16} />
                  <span className="text-sm font-medium">+91</span>
                  <div className="w-px h-4 bg-border mx-1" />
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={e => { setPhone(e.target.value.replace(/\D/g, '')); setError('') }}
                  placeholder="10-digit mobile number"
                  className="input-field pl-[5rem] text-base tracking-wider"
                  onKeyDown={e => e.key === 'Enter' && handleSendOtp()}
                />
              </div>

              {error && <p className="text-status-error text-sm mb-4">{error}</p>}

              <button
                onClick={handleSendOtp}
                disabled={!isPhoneValid || loading}
                className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                  <>Send OTP <ArrowRight size={18} /></>
                )}
              </button>

              <p className="text-center text-text-muted text-xs mt-10">
                By continuing you agree to our Terms & Privacy Policy
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.25 }}
              className="flex-1"
            >
              <button
                onClick={() => { setStep('phone'); setOtp(''); setError(''); setCountdown(0) }}
                className="flex items-center gap-2 text-text-secondary text-sm mb-6 -ml-1"
              >
                <ArrowLeft size={18} /> Back
              </button>

              <h1 className="text-2xl font-bold text-text-primary mb-1">Verify OTP</h1>
              <p className="text-text-secondary text-sm mb-8">
                Sent to <span className="font-semibold text-text-primary">+91 {phone}</span>
              </p>

              <OtpInput
                length={6}
                value={otp}
                onChange={handleVerifyOtp}
                disabled={loading}
                error={!!error}
              />

              {error && <p className="text-status-error text-sm mt-4">{error}</p>}

              {loading && (
                <div className="flex justify-center mt-8">
                  <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
              )}

              <button
                onClick={handleSendOtp}
                disabled={loading || countdown > 0}
                className={cn(
                  'w-full text-center text-sm mt-10 font-medium',
                  countdown > 0 || loading
                    ? 'text-text-muted pointer-events-none'
                    : 'text-primary'
                )}
              >
                {countdown > 0 ? `Resend in ${countdown}s` : 'Resend OTP'}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
