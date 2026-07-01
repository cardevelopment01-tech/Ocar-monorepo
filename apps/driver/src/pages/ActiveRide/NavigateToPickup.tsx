import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Navigation, Phone, RotateCcw, Clock } from 'lucide-react'
import SOSButton from '@/components/ui/SOSButton'
import { useRideStore } from '@/store/useRideStore'
import { useSessionStore } from '@/store/useSessionStore'
import { driverRideApi } from '@/lib/ride-api'
import { driverSafetyApi } from '@/lib/safety-api'

const DriverMapView  = lazy(() => import('@/components/map/DriverMapView'))
const RecenterMap    = lazy(() => import('@/components/map/RecenterMap'))
const LocationPin    = lazy(() => import('@/components/map/LocationPin'))
const SelfCarMarker  = lazy(() => import('@/components/map/SelfCarMarker'))

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
    })
  )
}

export default function NavigateToPickup() {
  const navigate = useNavigate()
  const { activeRide, setStartOtp, updateRideStatus } = useRideStore()
  const { sessionId } = useSessionStore()
  const [arriving, setArriving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pickupPos: [number, number] = [
    activeRide?.pickupLat ?? DEFAULT_LAT,
    activeRide?.pickupLng ?? DEFAULT_LNG,
  ]

  const [selfPos,     setSelfPos]     = useState<[number, number]>(pickupPos)
  const [selfHeading, setSelfHeading] = useState(0)

  // Location updates while navigating to pickup
  useEffect(() => {
    if (!sessionId) return
    const sendLocation = async () => {
      const pos = await getCurrentPosition().catch(() => null)
      if (!pos) return  // never send fake coordinates on GPS failure
      setSelfPos([pos.coords.latitude, pos.coords.longitude])
      if (pos.coords.heading != null) setSelfHeading(pos.coords.heading)
      await driverRideApi.updateLocation({
        sessionId, lat: pos.coords.latitude, lng: pos.coords.longitude,
        recordedAt: new Date().toISOString(),
      }).catch(() => {})
    }
    void sendLocation()
    locationIntervalRef.current = setInterval(sendLocation, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void sendLocation() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sessionId])

  const handleSOS = async () => {
    const pos = await getCurrentPosition().catch(() => null)
    await driverSafetyApi.triggerSos({
      rideId:   activeRide?.id ?? '',
      lat:      pos?.coords.latitude,
      lng:      pos?.coords.longitude,
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

  return (
    <div className="relative w-full h-screen bg-bg overflow-hidden">
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView center={selfPos} zoom={15}>
            <RecenterMap center={selfPos} />
            <SelfCarMarker position={selfPos} heading={selfHeading} />
            <LocationPin position={pickupPos} variant="pickup" />
          </DriverMapView>
        </Suspense>
      </div>

      <div className="absolute top-0 left-0 right-0 px-4 pt-12" style={{ zIndex: 10 }}>
        <div className="bg-surface/90 backdrop-blur-sm rounded-2xl border border-border px-4 py-3 flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-primary flex-shrink-0" />
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

      <div
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border px-5 pt-4 pb-10"
        style={{ zIndex: 10 }}
      >
        <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mb-4" />

        {activeRide?.rideType === 'round_trip' && activeRide.returnAt && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>
            <RotateCcw size={11} style={{ color: '#D97706' }} className="flex-shrink-0" />
            <p className="text-xs font-semibold" style={{ color: '#D97706' }}>
              Return by {(() => {
                const d = new Date(activeRide.returnAt)
                const z = (n: number) => String(n).padStart(2, '0')
                const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                return `${d.getDate()} ${mo[d.getMonth()]} · ${z(d.getHours())}:${z(d.getMinutes())}`
              })()}
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-text-muted text-xs">Rider</p>
            <p className="text-text-primary font-bold">{activeRide?.userName ?? 'Rider'}</p>
            {activeRide?.userPhone && (
              <p className="text-text-muted text-xs">{activeRide.userPhone}</p>
            )}
          </div>
          <div className="flex gap-2">
            {activeRide?.userPhone && (
              <a
                href={`tel:${activeRide.userPhone}`}
                className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center"
              >
                <Phone size={18} className="text-text-secondary" />
              </a>
            )}
            <button
              className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shadow-button"
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
          className="btn-go w-full"
          style={{ minHeight: 56 }}
        >
          {arriving ? 'Marking arrival…' : 'Arrived at Pickup'}
        </button>
      </div>

      <SOSButton rideId={activeRide?.id ?? ''} onSOS={handleSOS} />
    </div>
  )
}
