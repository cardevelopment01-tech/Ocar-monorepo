import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
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
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[360px]"
      >
        <div
          className="w-20 h-20 rounded-3xl bg-primary/20 flex items-center justify-center mx-auto mb-6"
          style={{ boxShadow: '0 0 40px rgba(34,197,94,0.2)' }}
        >
          <span className="text-4xl">🔑</span>
        </div>

        <h1 className="text-text-primary font-bold text-2xl text-center mb-2">Rider OTP</h1>
        <p className="text-text-secondary text-sm text-center mb-2">
          Ask the rider for their 6-digit OTP
        </p>
        <p className="text-text-muted text-xs text-center mb-8">
          {activeRide?.pickup ?? '—'} → {activeRide?.drop ?? '—'}
        </p>

        <div className="mb-6">
          <OtpInput
            value={otp}
            onChange={v => { setOtp(v); setError(false) }}
            error={error}
          />
          {error && (
            <p className="text-accent-red text-xs text-center mt-3 font-semibold">
              Wrong OTP — double-check with rider
            </p>
          )}
        </div>

        <button
          onClick={handleVerify}
          disabled={otp.length !== 6 || loading}
          className="btn-go w-full"
          style={{ minHeight: 56 }}
        >
          {loading ? 'Verifying…' : 'Start Ride'}
        </button>
      </motion.div>
    </div>
  )
}
