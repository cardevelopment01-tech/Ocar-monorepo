import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { KeyRound, RotateCcw, Clock, X } from 'lucide-react'
import OtpVerifyPanel from '@/components/ui/OtpVerifyPanel'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi } from '@/lib/ride-api'
import { fmtReturn } from '@/lib/constants'

// Same reason list as NavigateToPickup.tsx's CancelSheet -- kept identical so the
// driver sees the same options whether they cancel before or after arriving.
const CANCEL_REASONS = [
  { code: 'passenger_not_found', label: 'Passenger not at pickup' },
  { code: 'passenger_no_show',   label: 'Passenger did not show up' },
  { code: 'rider_requested',     label: 'Rider asked me to cancel' },
  { code: 'vehicle_breakdown',   label: 'Vehicle breakdown' },
  { code: 'wrong_booking',        label: 'Wrong booking details' },
  { code: 'emergency',            label: 'Emergency' },
  { code: 'other',                label: 'Other reason' },
]

export default function OTPVerify() {
  const navigate = useNavigate()
  const { activeRide, setRideStartedAt, setBookedWindow, updateRideStatus, clearRide } = useRideStore()
  const [otp, setOtp]     = useState('')
  const [error, setError] = useState(false)
  const [showCancelSheet, setShowCancelSheet] = useState(false)
  const [cancelReason,    setCancelReason]    = useState<string | null>(null)
  const [cancellingRide,  setCancellingRide]  = useState(false)

  const handleVerify = async () => {
    if (!activeRide) return
    try {
      await driverRideApi.verifyStartOtp(activeRide.id, otp)
      setRideStartedAt(new Date().toISOString())
      // bookedUntil exists only once the trip has started; a failed fetch just means no clock until the
      // next restore, never a failed start.
      void driverRideApi.getRide(activeRide.id).then(setBookedWindow).catch(() => {})
      updateRideStatus('in_progress')
    } catch {
      setError(true)
      setOtp('')
      throw new Error('otp-verify-failed')
    }
  }

  // Backend allows driver cancel through driver_arrived too (CANCELLABLE_BY_DRIVER,
  // rides.service.ts) -- this screen previously had no way to reach it, silently
  // dropping cancel the moment the driver arrives and this screen replaces
  // NavigateToPickup.tsx (which does have it).
  const handleCancelRide = async () => {
    if (!activeRide || !cancelReason || cancellingRide) return
    setCancellingRide(true)
    try {
      await driverRideApi.cancelRideAsDriver(activeRide.id, cancelReason)
      clearRide()
      navigate('/')
    } catch {
      setCancellingRide(false)
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
            background: 'linear-gradient(145deg, #0A9FB0 0%, #DC3E93 100%)',
            boxShadow: '0 4px 20px rgba(10, 159, 176,0.35)',
          }}
        >
          <KeyRound size={34} className="text-white" strokeWidth={1.75} aria-hidden="true" />
        </motion.div>

        <h1 className="font-display font-bold text-2xl text-text-primary text-center mb-2">
          Start OTP
        </h1>
        <p className="text-text-secondary text-sm text-center mb-2">
          Ask the rider for the 4-digit code once they are in the cab
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
        <div className="card-glossy rounded-3xl p-6 mb-4">
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

        <p className="text-text-muted text-xs text-center leading-relaxed mb-4">
          Make sure the passenger's app shows the same code before proceeding
        </p>

        <button
          onClick={() => setShowCancelSheet(true)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-red-400 active:opacity-70 transition-opacity"
        >
          <X size={14} strokeWidth={2} />
          Cancel ride
        </button>
      </motion.div>

      <AnimatePresence>
        {showCancelSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 flex items-end"
          >
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => { if (!cancellingRide) setShowCancelSheet(false) }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 350 }}
              className="relative w-full rounded-t-3xl px-5 pt-5 bg-surface"
              style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
            >
              <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mb-4" />
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-black text-text-primary">Cancel this ride?</h3>
                <button
                  onClick={() => setShowCancelSheet(false)}
                  disabled={cancellingRide}
                  className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center active:scale-[0.97] transition-transform"
                >
                  <X size={15} className="text-text-secondary" />
                </button>
              </div>
              <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2.5">Why are you cancelling?</p>
              <div className="space-y-2 mb-5">
                {CANCEL_REASONS.map(r => (
                  <button
                    key={r.code}
                    onClick={() => setCancelReason(r.code)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left active:scale-[0.97] transition-transform ${
                      cancelReason === r.code ? '' : 'bg-surface-2'
                    }`}
                    style={cancelReason === r.code
                      ? { background: 'rgba(239,68,68,0.07)', border: '1.5px solid rgba(239,68,68,0.40)' }
                      : { border: '1.5px solid #E2E8F0' }
                    }
                  >
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={cancelReason === r.code
                        ? { border: '5px solid #EF4444' }
                        : { border: '2px solid #CBD5E1' }
                      }
                    />
                    <span className={`text-sm font-medium ${cancelReason === r.code ? 'text-accent-red' : 'text-text-secondary'}`}>
                      {r.label}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => void handleCancelRide()}
                disabled={!cancelReason || cancellingRide}
                className="w-full py-3.5 rounded-2xl text-sm font-bold text-text-inverse mb-2.5 disabled:opacity-40 active:scale-[0.97] transition-transform"
                style={{ background: '#EF4444' }}
              >
                {cancellingRide ? 'Cancelling…' : 'Confirm cancellation'}
              </button>
              <button
                onClick={() => setShowCancelSheet(false)}
                disabled={cancellingRide}
                className="w-full py-3 rounded-2xl text-sm font-semibold text-text-secondary disabled:opacity-50 active:scale-[0.97] transition-transform bg-surface-2 border border-border"
              >
                Keep my ride
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
