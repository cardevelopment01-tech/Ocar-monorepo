import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Navigation, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import SOSButton from '@/components/ui/SOSButton'
import OtpInput from '@/components/ui/OtpInput'
import { useRideStore } from '@/store/useRideStore'
import { useSessionStore } from '@/store/useSessionStore'
import { driverRideApi } from '@/lib/ride-api'

const DriverMapView  = lazy(() => import('@/components/map/DriverMapView'))
const RecenterMap    = lazy(() => import('@/components/map/RecenterMap'))
const LocationPin    = lazy(() => import('@/components/map/LocationPin'))
const SelfCarMarker  = lazy(() => import('@/components/map/SelfCarMarker'))

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 10000,
    })
  )
}

function useElapsed() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function TripInProgress() {
  const navigate = useNavigate()
  const elapsed = useElapsed()
  const { activeRide, updateRideStatus } = useRideStore()
  const { sessionId } = useSessionStore()

  const [showEndOtp, setShowEndOtp] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpError, setOtpError] = useState(false)
  const [completing, setCompleting] = useState(false)
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const dropPos: [number, number] = [
    activeRide?.dropLat ?? DEFAULT_LAT,
    activeRide?.dropLng ?? DEFAULT_LNG,
  ]

  const [selfPos,     setSelfPos]     = useState<[number, number]>(dropPos)
  const [selfHeading, setSelfHeading] = useState(0)

  // Screen wake lock
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
    }
    return () => { lock?.release() }
  }, [])

  // Location updates while on trip
  useEffect(() => {
    if (!sessionId) return
    const send = async () => {
      const pos = await getCurrentPosition().catch(() => null)
      if (!pos) return  // never send fake coordinates on GPS failure
      setSelfPos([pos.coords.latitude, pos.coords.longitude])
      if (pos.coords.heading != null) setSelfHeading(pos.coords.heading)
      await driverRideApi.updateLocation({
        sessionId, lat: pos.coords.latitude, lng: pos.coords.longitude,
        recordedAt: new Date().toISOString(),
      }).catch(() => {})
    }
    void send()
    locationIntervalRef.current = setInterval(send, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void send() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sessionId])

  const handleCompleteTrip = async () => {
    if (otp.length !== 6 || !activeRide) return
    setCompleting(true)
    setOtpError(false)
    try {
      // Compute actual distance from pickup→drop coords (Haversine)
      let actualDistanceKm: number | undefined
      if (activeRide.dropLat != null && activeRide.dropLng != null) {
        const R = 6371
        const dLat = (activeRide.dropLat - activeRide.pickupLat) * Math.PI / 180
        const dLng = (activeRide.dropLng - activeRide.pickupLng) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(activeRide.pickupLat * Math.PI / 180) *
          Math.cos(activeRide.dropLat * Math.PI / 180) *
          Math.sin(dLng / 2) ** 2
        actualDistanceKm = Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 1.3 * 10) / 10
      }
      // elapsed is "MM:SS" — convert to minutes
      const [mm, ss] = elapsed.split(':').map(Number)
      const actualDurationMin = mm + Math.round((ss ?? 0) / 60)

      await driverRideApi.verifyEndOtp(activeRide.id, otp, actualDistanceKm, actualDurationMin || undefined)
      updateRideStatus('completed')
      navigate('/ride/end')
    } catch {
      setOtpError(true)
      setOtp('')
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div className="relative w-full h-screen bg-bg overflow-hidden">
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView center={selfPos} zoom={15}>
            <RecenterMap center={selfPos} />
            <SelfCarMarker position={selfPos} heading={selfHeading} />
            <LocationPin position={dropPos} variant="drop" />
          </DriverMapView>
        </Suspense>
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 px-4 pt-12" style={{ zIndex: 10 }}>
        <div className="bg-surface/90 backdrop-blur-sm rounded-2xl border border-border px-4 py-3 flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-accent-red flex-shrink-0 animate-pulse" />
          <div className="flex-1">
            <p className="text-accent-red text-xs font-bold uppercase tracking-wider">Trip in Progress</p>
            <p className="text-text-primary font-bold text-sm truncate">{activeRide?.drop ?? '—'}</p>
          </div>
          <div className="flex items-center gap-1 text-text-secondary">
            <Clock size={14} />
            <span className="font-mono text-sm font-semibold">{elapsed}</span>
          </div>
        </div>
      </div>

      {/* Bottom sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border px-5 pt-4 pb-10"
        style={{ zIndex: 10 }}
      >
        <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mb-4" />

        <div className="flex justify-between mb-0.5">
          <p className="text-text-muted text-xs">Drop-off</p>
          <p className="text-text-muted text-xs">Fare</p>
        </div>
        <div className="flex justify-between items-start mb-4">
          <p className="text-text-primary font-bold text-base flex-1 pr-4">{activeRide?.drop ?? '—'}</p>
          <p className="text-primary font-black text-2xl flex-shrink-0">₹{activeRide?.fare ?? 0}</p>
        </div>

        <div className="flex gap-3">
          <button
            className="w-12 h-12 rounded-2xl bg-surface-3 border border-border flex items-center justify-center flex-shrink-0"
            onClick={() => window.open(`https://maps.google.com?q=${dropPos[0]},${dropPos[1]}`)}
          >
            <Navigation size={20} className="text-primary" />
          </button>
          <button
            onClick={() => setShowEndOtp(true)}
            className="btn-go flex-1"
            style={{ minHeight: 52 }}
          >
            Complete Trip
          </button>
        </div>
      </div>

      {/* End OTP sheet */}
      <AnimatePresence>
        {showEndOtp && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border px-5 pt-5 pb-10"
            style={{ zIndex: 30 }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-text-primary font-bold text-lg">End Ride OTP</h2>
                <p className="text-text-muted text-xs">Ask the rider for their end OTP</p>
              </div>
              <button
                onClick={() => { setShowEndOtp(false); setOtp(''); setOtpError(false) }}
                className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center"
              >
                <X size={16} className="text-text-secondary" />
              </button>
            </div>

            <OtpInput value={otp} onChange={v => { setOtp(v); setOtpError(false) }} error={otpError} />
            {otpError && (
              <p className="text-accent-red text-xs text-center mt-3 font-semibold">Wrong OTP — try again</p>
            )}

            <button
              onClick={handleCompleteTrip}
              disabled={otp.length !== 6 || completing}
              className="btn-go w-full mt-5"
              style={{ minHeight: 56 }}
            >
              {completing ? 'Completing…' : 'Complete Trip'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <SOSButton
        rideId={activeRide?.id ?? ''}
        onSOS={() => {}}
        style={{ bottom: '100px', right: '16px', zIndex: 50 }}
      />
    </div>
  )
}
