import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check } from 'lucide-react'
import OcarSpinner from './OcarSpinner'
import OtpInput from './OtpInput'

type Phase = 'idle' | 'verifying' | 'verified'

interface OtpVerifyPanelProps {
  title?: string
  subtitle?: string
  otp: string
  onChange: (value: string) => void
  error: boolean
  errorMessage: string
  submitLabel: string
  verifiedLabel?: string
  onSubmit: () => Promise<void>
  onVerified?: () => void
  length?: number
}

// Shared OTP entry + submit block — used by both the full-screen start-ride
// verification and the end-ride sheet, which used to duplicate this markup.
// The submit button morphs idle -> verifying -> verified instead of the OTP
// silently succeeding and the screen just changing underneath the driver.
export default function OtpVerifyPanel({
  title, subtitle, otp, onChange, error, errorMessage, submitLabel,
  verifiedLabel = 'Verified', onSubmit, onVerified, length = 4,
}: OtpVerifyPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const prefersReducedMotion = useReducedMotion()

  const handleSubmit = async () => {
    if (otp.length !== length || phase !== 'idle') return
    setPhase('verifying')
    try {
      await onSubmit()
      setPhase('verified')
      setTimeout(() => onVerified?.(), prefersReducedMotion ? 0 : 550)
    } catch {
      setPhase('idle')
    }
  }

  return (
    <div>
      {title && <h2 className="text-text-primary font-bold text-lg mb-1">{title}</h2>}
      {subtitle && <p className="text-text-muted text-xs mb-4">{subtitle}</p>}

      <OtpInput length={length} value={otp} onChange={onChange} error={error} />
      {error && (
        <p className="text-accent-red text-xs text-center mt-3 font-semibold" role="alert">{errorMessage}</p>
      )}

      <button
        onClick={() => void handleSubmit()}
        disabled={otp.length !== length || phase !== 'idle'}
        className="btn-go w-full mt-5 flex items-center justify-center gap-2 active:scale-[0.97] transition-transform disabled:active:scale-100"
        style={{ minHeight: 56 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase === 'verified' ? (
            <motion.span
              key="verified"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-2"
            >
              <Check size={18} strokeWidth={2.5} aria-hidden="true" /> {verifiedLabel}
            </motion.span>
          ) : phase === 'verifying' ? (
            <motion.span
              key="verifying"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-2"
            >
              <OcarSpinner size={16} variant="white" /> Verifying…
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-2"
            >
              {submitLabel} <ArrowRight size={17} aria-hidden="true" />
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </div>
  )
}
