import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Crosshair, X, RotateCcw } from 'lucide-react'
import { useMap } from '@vis.gl/react-google-maps'
import { motion, AnimatePresence } from 'framer-motion'
import SOSButton from '@/components/ui/SOSButton'
import OtpInput from '@/components/ui/OtpInput'
import { useRideStore } from '@/store/useRideStore'
import { useSessionStore } from '@/store/useSessionStore'
import { driverRideApi } from '@/lib/ride-api'
import { driverSafetyApi } from '@/lib/safety-api'
import { EASE, GLASS, fmtReturn } from '@/lib/constants'
import { useDriverLocation } from '@/lib/useDriverLocation'

const DriverMapView  = lazy(() => import('@/components/map/DriverMapView'))
const RecenterMap    = lazy(() => import('@/components/map/RecenterMap'))
const LocationPin    = lazy(() => import('@/components/map/LocationPin'))
const SelfCarMarker  = lazy(() => import('@/components/map/SelfCarMarker'))
const RoutePolyline  = lazy(() => import('@/components/map/RoutePolyline'))

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

// Must render inside DriverMapView children so useMap() has map context
function LocateMeButton({ position }: { position: [number, number] }) {
  const map = useMap()
  return (
    <button
      aria-label="Center on my location"
      style={{ position: 'absolute', left: 16, bottom: 'calc(env(safe-area-inset-bottom) + 224px)', zIndex: 5 }}
      className="w-12 h-12 rounded-2xl bg-surface border border-border shadow-lg flex items-center justify-center active:scale-95 transition-transform"
      onClick={() => {
        if (!map) return
        map.panTo({ lat: position[0], lng: position[1] })
        map.setZoom(16)
      }}
    >
      <Crosshair size={20} className="text-primary" />
    </button>
  )
}

function haversineMetres(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

function useElapsed(startedAt?: string) {
  const initial = startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)) : 0
  const [seconds, setSeconds] = useState(initial)
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
  const { activeRide, updateRideStatus } = useRideStore()
  const elapsed = useElapsed(activeRide?.rideStartedAt)
  const { sessionId } = useSessionStore()

  const [showEndOtp, setShowEndOtp] = useState(false)
  const [otp, setOtp]               = useState('')
  const [otpError, setOtpError]     = useState(false)
  const [completing, setCompleting] = useState(false)
  const [encodedPolyline, setEncodedPolyline] = useState<string | undefined>(undefined)
  const lastRouteFetch = useRef<{ origin: [number, number]; at: number } | null>(null)
  const fetchSeq       = useRef(0)

  const dropPos: [number, number] = [
    activeRide?.dropLat ?? DEFAULT_LAT,
    activeRide?.dropLng ?? DEFAULT_LNG,
  ]

  const { position, heading: selfHeading } = useDriverLocation({
    highAccuracy: true,
    syncIntervalMs: 3_000,
    onSync: sessionId
      ? (lat, lng, heading) => {
          driverRideApi.updateLocation({ sessionId: sessionId!, lat, lng, heading, recordedAt: new Date().toISOString() }).catch(() => {})
        }
      : undefined,
  })
  // Fall back to drop only for map centering, never for the car marker or route fetch.
  // Without this guard, the car appears AT the drop pin before GPS resolves, making
  // it look like the driver has already reached the destination.
  const mapCenter: [number, number] = position ?? dropPos

  // Screen wake lock: re-acquire on page resume because the browser
  // auto-releases WakeLock when the page is hidden.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const acquire = () => {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
      }
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      document.removeEventListener('visibilitychange', acquire)
      lock?.release()
    }
  }, [])

  const dropLat = activeRide?.dropLat
  const dropLng = activeRide?.dropLng

  useEffect(() => {
    if (dropLat == null || dropLng == null) return
    if (!position) return

    const dest: [number, number] = [dropLat, dropLng]
    const prev     = lastRouteFetch.current
    const deviated = prev ? haversineMetres(position, prev.origin) > 200 : false
    const stale    = prev ? (Date.now() - prev.at) > 60_000 : false
    if (prev && !deviated && !stale) return

    const seq = ++fetchSeq.current
    lastRouteFetch.current = { origin: position, at: Date.now() }

    driverRideApi.getRoute(position[0], position[1], dest[0], dest[1])
      .then(r => { if (fetchSeq.current === seq) setEncodedPolyline(r.polyline || undefined) })
      .catch(() => { if (fetchSeq.current === seq) setEncodedPolyline(undefined) })
  }, [position, dropLat, dropLng])

  const handleSOS = async () => {
    await driverSafetyApi.triggerSos({
      rideId:   activeRide?.id ?? '',
      lat:      position?.[0],
      lng:      position?.[1],
      severity: 'high',
    })
  }

  const handleCompleteTrip = async () => {
    if (otp.length !== 4 || !activeRide) return
    setCompleting(true)
    setOtpError(false)
    try {
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
      const [mm, ss] = elapsed.split(':').map(Number)
      const actualDurationMin = mm + Math.round((ss ?? 0) / 60)
      await driverRideApi.verifyEndOtp(activeRide.id, otp, actualDistanceKm, actualDurationMin || undefined, position?.[0], position?.[1])
      updateRideStatus('completed')
      navigate('/ride/end', { replace: true })
    } catch {
      setOtpError(true)
      setOtp('')
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div className="relative w-full h-[100dvh] bg-bg overflow-hidden">

      {/* Map */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView initialCenter={mapCenter} zoom={15}>
            <RecenterMap center={mapCenter} heading={selfHeading} topPadding={100} bottomPadding={220} />
            {dropLat != null && dropLng != null && (
              <RoutePolyline encoded={encodedPolyline} />
            )}
            {position && <SelfCarMarker position={position} heading={selfHeading} />}
            <LocationPin position={dropPos} variant="drop" />
            <LocateMeButton position={position ?? dropPos} />
          </DriverMapView>
        </Suspense>
      </div>

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 px-4"
        style={{ zIndex: 10, paddingTop: 'max(env(safe-area-inset-top), 2.5rem)' }}
      >
        <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={GLASS}>
          <div className="w-2.5 h-2.5 rounded-full bg-accent-red flex-shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-accent-red text-xs font-bold uppercase tracking-wider">Trip in Progress</p>
              {activeRide?.rideType === 'rental' && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(109,40,217,0.12)', color: '#6D28D9' }}>RENTAL</span>
              )}
              {activeRide?.rideType === 'round_trip' && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', color: '#D97706' }}>RETURN</span>
              )}
            </div>
            <p className="text-text-primary font-bold text-sm truncate">
              {activeRide?.rideType === 'rental' ? 'Flexible route' : (activeRide?.drop ?? '—')}
            </p>
          </div>
          <div className="flex items-center gap-1 text-text-secondary flex-shrink-0">
            <Clock size={14} />
            <span className="font-mono tabular-nums text-sm font-semibold">{elapsed}</span>
          </div>
        </div>
      </div>

      {/* Bottom sheet */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border px-5 pt-4"
        style={{ zIndex: 10, paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mb-4" />

        {/* Context banners */}
        {activeRide?.rideType === 'round_trip' && activeRide.returnAt && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <RotateCcw size={11} style={{ color: '#D97706' }} className="flex-shrink-0" />
            <p className="text-xs font-semibold" style={{ color: '#D97706' }}>
              Return by {fmtReturn(activeRide.returnAt)}
            </p>
          </div>
        )}
        {activeRide?.rideType === 'rental' && activeRide.tripHours != null && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(109,40,217,0.12)', border: '1px solid rgba(109,40,217,0.12)' }}>
            <Clock size={11} style={{ color: '#6D28D9' }} className="flex-shrink-0" />
            <p className="text-xs font-semibold" style={{ color: '#6D28D9' }}>
              Rental · {activeRide.tripHours}h booked
            </p>
          </div>
        )}

        <div className="flex justify-between mb-0.5">
          <p className="text-text-muted text-xs">
            {activeRide?.rideType === 'rental' ? 'Route' : 'Drop-off'}
          </p>
          <p className="text-text-muted text-xs">Fare</p>
        </div>
        <div className="flex justify-between items-start mb-4">
          <p className="text-text-primary font-bold text-base flex-1 pr-4">
            {activeRide?.rideType === 'rental' ? 'Flexible · ends at rider request' : (activeRide?.drop ?? '—')}
          </p>
          <p className="text-primary font-black text-2xl flex-shrink-0">₹{activeRide?.fare ?? 0}</p>
        </div>

        <button
          onClick={() => setShowEndOtp(true)}
          className="btn-go w-full active:scale-95 transition-transform"
          style={{ minHeight: 52 }}
        >
          Complete Trip
        </button>
      </motion.div>

      {/* Dim backdrop behind end-OTP sheet */}
      <AnimatePresence>
        {showEndOtp && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0"
              style={{ zIndex: 20, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
              onClick={() => { setShowEndOtp(false); setOtp(''); setOtpError(false) }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border px-5 pt-5"
              style={{ zIndex: 30, paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-text-primary font-bold text-lg">End Ride OTP</h2>
                  <p className="text-text-muted text-xs">Ask the rider for their end OTP</p>
                </div>
                <button
                  onClick={() => { setShowEndOtp(false); setOtp(''); setOtpError(false) }}
                  className="w-9 h-9 rounded-full bg-surface-3 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <X size={16} className="text-text-secondary" />
                </button>
              </div>

              <OtpInput length={4} value={otp} onChange={v => { setOtp(v); setOtpError(false) }} error={otpError} />
              {otpError && (
                <p className="text-accent-red text-xs text-center mt-3 font-semibold">Wrong OTP, try again</p>
              )}

              <button
                onClick={handleCompleteTrip}
                disabled={otp.length !== 4 || completing}
                className="btn-go w-full mt-5 active:scale-95 transition-transform"
                style={{ minHeight: 56 }}
              >
                {completing ? 'Completing…' : 'Complete Trip'}
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <SOSButton
        rideId={activeRide?.id ?? ''}
        onSOS={handleSOS}
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 224px)', right: '16px', zIndex: 50 }}
      />
    </div>
  )
}
