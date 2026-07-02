import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Navigation, Phone, RotateCcw, Clock } from 'lucide-react'
import SOSButton from '@/components/ui/SOSButton'
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

function haversineMetres(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

export default function NavigateToPickup() {
  const navigate = useNavigate()
  const { activeRide, setStartOtp, updateRideStatus } = useRideStore()
  const { sessionId } = useSessionStore()
  const [arriving, setArriving] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [encodedPolyline, setEncodedPolyline] = useState<string | undefined>(undefined)
  const lastRouteFetch = useRef<{ origin: [number, number]; at: number } | null>(null)
  const fetchSeq       = useRef(0)

  const pickupPos: [number, number] = [
    activeRide?.pickupLat ?? DEFAULT_LAT,
    activeRide?.pickupLng ?? DEFAULT_LNG,
  ]
  const pickupLat = activeRide?.pickupLat ?? DEFAULT_LAT
  const pickupLng = activeRide?.pickupLng ?? DEFAULT_LNG

  const { position, heading: selfHeading } = useDriverLocation({
    highAccuracy: true,
    onSync: sessionId
      ? (lat, lng) => {
          driverRideApi.updateLocation({ sessionId: sessionId!, lat, lng, recordedAt: new Date().toISOString() }).catch(() => {})
        }
      : undefined,
  })
  const selfPos: [number, number] = position ?? pickupPos

  useEffect(() => {
    const dest: [number, number] = [pickupLat, pickupLng]
    const prev     = lastRouteFetch.current
    const deviated = prev ? haversineMetres(selfPos, prev.origin) > 200 : false
    const stale    = prev ? (Date.now() - prev.at) > 60_000 : false
    if (prev && !deviated && !stale) return

    const seq = ++fetchSeq.current
    lastRouteFetch.current = { origin: selfPos, at: Date.now() }

    driverRideApi.getRoute(selfPos[0], selfPos[1], dest[0], dest[1])
      .then(r => { if (fetchSeq.current === seq) setEncodedPolyline(r.polyline || undefined) })
      .catch(() => { if (fetchSeq.current === seq) setEncodedPolyline(undefined) })
  }, [selfPos, pickupLat, pickupLng])

  const handleSOS = async () => {
    await driverSafetyApi.triggerSos({
      rideId:   activeRide?.id ?? '',
      lat:      position?.[0],
      lng:      position?.[1],
      severity: 'high',
    })
  }

  const handleArrived = async () => {
    if (!activeRide) return
    setArriving(true)
    setError(null)
    try {
      const { startOtp } = await driverRideApi.markArrived(activeRide.id)
      setStartOtp(startOtp)
      updateRideStatus('driver_arrived')
      navigate('/ride/otp')
    } catch {
      setError('Failed to mark arrival. Please try again.')
    } finally {
      setArriving(false)
    }
  }

  const avatarLetter = (activeRide?.userName ?? 'R')[0]!.toUpperCase()

  return (
    <div className="relative w-full h-[100dvh] bg-bg overflow-hidden">

      {/* Map */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView initialCenter={selfPos} zoom={15}>
            <RecenterMap center={selfPos} heading={selfHeading} />
            <RoutePolyline encoded={encodedPolyline} variant="pickup-leg" />
            <SelfCarMarker position={selfPos} heading={selfHeading} />
            <LocationPin position={pickupPos} variant="pickup" />
          </DriverMapView>
        </Suspense>
      </div>

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 px-4"
        style={{ zIndex: 10, paddingTop: 'max(env(safe-area-inset-top), 2.5rem)' }}
      >
        <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={GLASS}>
          <div className="w-3 h-3 rounded-full bg-primary flex-shrink-0 animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-text-muted text-xs">Heading to pickup</p>
              {activeRide?.rideType === 'rental' && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(109,40,217,0.12)', color: '#6D28D9' }}>RENTAL</span>
              )}
              {activeRide?.rideType === 'round_trip' && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.12)', color: '#D97706' }}>RETURN</span>
              )}
            </div>
            <p className="text-text-primary font-bold text-base truncate">{activeRide?.pickup ?? '—'}</p>
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

        {/* Rider row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center flex-shrink-0">
              <span className="text-primary font-bold text-base">{avatarLetter}</span>
            </div>
            <div>
              <p className="text-text-muted text-xs">Rider</p>
              <p className="text-text-primary font-bold">{activeRide?.userName ?? 'Rider'}</p>
              {activeRide?.userPhone && (
                <p className="text-text-muted text-xs">{activeRide.userPhone}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {activeRide?.userPhone && (
              <a
                href={`tel:${activeRide.userPhone}`}
                className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center active:scale-95 transition-transform"
              >
                <Phone size={18} className="text-text-secondary" />
              </a>
            )}
            <button
              className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shadow-button active:scale-95 transition-transform"
              onClick={() => window.open(`https://maps.google.com?q=${pickupPos[0]},${pickupPos[1]}`)}
            >
              <Navigation size={18} className="text-text-inverse" />
            </button>
          </div>
        </div>

        {error && <p className="text-accent-red text-sm mb-3 text-center">{error}</p>}

        <button
          onClick={handleArrived}
          disabled={arriving}
          className="btn-go w-full active:scale-95 transition-transform"
          style={{ minHeight: 56 }}
        >
          {arriving ? 'Marking arrival…' : 'Arrived at Pickup'}
        </button>
      </motion.div>

      <SOSButton rideId={activeRide?.id ?? ''} onSOS={handleSOS} />
    </div>
  )
}
