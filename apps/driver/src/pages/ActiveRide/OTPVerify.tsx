import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { KeyRound, ArrowRight, RotateCcw, Clock } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import OtpInput from '@/components/ui/OtpInput'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi } from '@/lib/ride-api'
import { fmtReturn } from '@/lib/constants'

export default function OTPVerify() {
  const navigate = useNavigate()
  const { activeRide, setEndOtp, setRideStartedAt, updateRideStatus } = useRideStore()
  const [otp, setOtp]       = useState('')
  const [error, setError]   = useState(false)
  const [loading, setLoading] = useState(false)

  const handleVerify = async () => {
    if (otp.length !== 4 || !activeRide) return
    setLoading(true)
    setError(false)
    try {
      const { endOtp } = await driverRideApi.verifyStartOtp(activeRide.id, otp)
      setEndOtp(endOtp)
      setRideStartedAt(new Date().toISOString())
      updateRideStatus('in_progress')
      navigate('/ride/in-progress', { replace: true })
    } catch {
      setError(true)
      setOtp('')
    } finally {
      setLoading(false)
    }
  }

  const isRental    = activeRide?.rideType === 'rental'
  const isRoundTrip = activeRide?.rideType === 'round_trip'

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-6"
      style={{
        background: 'radial-gradient(ellipse at 50% -10%, rgba(15,23,42,0.04) 0%, #F5F8FF 50%)',
        paddingTop: 'max(env(safe-area-inset-top), 1.5rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
          Ask the rider for their 4-digit OTP
        </p>

        {/* Route line */}
        <p className="text-text-muted text-xs text-center mb-2">
          {activeRide?.pickup ?? '—'} → {isRental ? 'Flexible route' : (activeRide?.drop ?? '—')}
        </p>

        {/* Trip type context */}
        {isRoundTrip && activeRide.returnAt && (
          <div className="flex items-center justify-center gap-1.5 mb-6">
            <RotateCcw size={11} style={{ color: '#D97706' }} />
            <span className="text-xs font-semibold" style={{ color: '#D97706' }}>
              Return by {fmtReturn(activeRide.returnAt)}
            </span>
          </div>
        )}
        {isRental && activeRide.tripHours != null && (
          <div className="flex items-center justify-center gap-1.5 mb-6">
            <Clock size={11} style={{ color: '#6D28D9' }} />
            <span className="text-xs font-semibold" style={{ color: '#6D28D9' }}>
              Rental · {activeRide.tripHours}h booked
            </span>
          </div>
        )}
        {!isRoundTrip && !isRental && <div className="mb-6" />}

        {/* Card */}
        <div
          className="bg-white rounded-3xl p-6 mb-4"
          style={{ border: '1px solid #E2E8F0', boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.07)' }}
        >
          <div className="mb-4">
            <OtpInput
              length={4}
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
            disabled={otp.length !== 4 || loading}
            className="btn-go w-full flex items-center justify-center gap-2 active:scale-95 transition-transform"
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
