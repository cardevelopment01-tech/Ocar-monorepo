import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { KeyRound, ArrowRight } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import OtpInput from '@/components/ui/OtpInput'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi } from '@/lib/ride-api'

export default function OTPVerify() {
  const navigate = useNavigate()
  const { activeRide, setEndOtp, updateRideStatus } = useRideStore()
  const [otp, setOtp] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleVerify = async () => {
    if (otp.length !== 6 || !activeRide) return
    setLoading(true)
    setError(false)
    try {
      const { endOtp } = await driverRideApi.verifyStartOtp(activeRide.id, otp)
      setEndOtp(endOtp)
      updateRideStatus('in_progress')
      navigate('/ride/in-progress')
    } catch {
      setError(true)
      setOtp('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: 'radial-gradient(ellipse at 50% -10%, rgba(15,23,42,0.04) 0%, #F5F8FF 50%)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[360px]"
      >
        {/* Icon */}
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6"
          style={{
            background: 'linear-gradient(145deg, #1E293B 0%, #0F172A 100%)',
            boxShadow: '0 4px 20px rgba(15,23,42,0.28)',
          }}
        >
          <KeyRound size={34} className="text-white" strokeWidth={1.75} aria-hidden="true" />
        </div>

        <h1 className="font-display font-bold text-2xl text-text-primary text-center mb-2">
          Rider OTP
        </h1>
        <p className="text-text-secondary text-sm text-center mb-2">
          Ask the rider for their 6-digit OTP
        </p>
        <p className="text-text-muted text-xs text-center mb-8">
          {activeRide?.pickup ?? '—'} → {activeRide?.drop ?? '—'}
        </p>

        {/* Card */}
        <div
          className="bg-white rounded-3xl p-6 mb-4"
          style={{ border: '1px solid #E2E8F0', boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.07)' }}
        >
          <div className="mb-4">
            <OtpInput
              value={otp}
              onChange={v => { setOtp(v); setError(false) }}
              error={error}
            />
            {error && (
              <p className="text-accent-red text-xs text-center mt-3 font-semibold" role="alert">
                Wrong OTP. Ask the rider to check again.
              </p>
            )}
          </div>

          <button
            onClick={handleVerify}
            disabled={otp.length !== 6 || loading}
            className="btn-go w-full flex items-center justify-center gap-2"
            style={{ minHeight: 56 }}
          >
            {loading ? (
              <>
                <OcarSpinner size={16} variant="white" />
                Verifying…
              </>
            ) : (
              <>
                Start Ride <ArrowRight size={17} aria-hidden="true" />
              </>
            )}
          </button>
        </div>

        <p className="text-text-muted text-xs text-center leading-relaxed">
          Make sure the passenger's app shows the same code before proceeding
        </p>
      </motion.div>
    </div>
  )
}
