import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { KeyRound, RotateCcw, Clock } from 'lucide-react'
import OtpVerifyPanel from '@/components/ui/OtpVerifyPanel'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi } from '@/lib/ride-api'
import { fmtReturn } from '@/lib/constants'

export default function OTPVerify() {
  const navigate = useNavigate()
  const { activeRide, setRideStartedAt, updateRideStatus } = useRideStore()
  const [otp, setOtp]     = useState('')
  const [error, setError] = useState(false)

  const handleVerify = async () => {
    if (!activeRide) return
    try {
      await driverRideApi.verifyStartOtp(activeRide.id, otp)
      setRideStartedAt(new Date().toISOString())
      updateRideStatus('in_progress')
    } catch {
      setError(true)
      setOtp('')
      throw new Error('otp-verify-failed')
    }
  }

  const isRental    = activeRide?.rideType === 'rental'
  const isRoundTrip = activeRide?.rideType === 'round_trip'

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-6 bg-bg"
      style={{
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
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', duration: 0.5, bounce: 0.15, delay: 0.05 }}
          className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6"
          style={{
            background: 'linear-gradient(145deg, #4F46E5 0%, #7C3AED 100%)',
            boxShadow: '0 4px 20px rgba(79,70,229,0.35)',
          }}
        >
          <KeyRound size={34} className="text-white" strokeWidth={1.75} aria-hidden="true" />
        </motion.div>

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
          <OtpVerifyPanel
            otp={otp}
            onChange={v => { setOtp(v); setError(false) }}
            error={error}
            errorMessage="Wrong OTP. Ask the rider to check again."
            submitLabel="Start Ride"
            verifiedLabel="Ride started"
            onSubmit={handleVerify}
            onVerified={() => navigate('/ride/in-progress', { replace: true })}
          />
        </div>

        <p className="text-text-muted text-xs text-center leading-relaxed">
          Make sure the passenger's app shows the same code before proceeding
        </p>
      </motion.div>
    </div>
  )
}
