import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { IndianRupee, Clock, Star, TrendingUp, Bell } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import OnlineToggle from '@/components/ui/OnlineToggle'
import TripRequestCard from '@/components/ui/TripRequestCard'
import { mockEarnings } from '@/lib/mock-data'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi } from '@/lib/ride-api'
import { connectDriverSocket, disconnectDriverSocket, getDriverSocket } from '@/lib/socket'

const DriverMapView = lazy(() => import('@/components/map/DriverMapView'))

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245
const NAV_HEIGHT  = 68

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
    })
  )
}

const GLASS = {
  background:             'rgba(255,255,255,0.92)',
  backdropFilter:         'blur(16px)',
  WebkitBackdropFilter:   'blur(16px)',
  border:                 '1px solid rgba(0,0,0,0.07)',
  boxShadow:              '0 2px 12px rgba(0,0,0,0.10)',
}

export default function Home() {
  const navigate = useNavigate()
  const driver = useAuthStore(s => s.driver)
  const { isOnline, sessionId, setOnline, setOffline } = useSessionStore()
  const { incomingRequest, setIncomingRequest, clearIncomingRequest, setActiveRide } = useRideStore()

  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [mapCenter, setMapCenter] = useState<[number, number]>([20.2961, 85.8245])
  const e = mockEarnings.today
  const firstName = driver?.full_name?.split(' ')[0] ?? 'Driver'

  useEffect(() => {
    driverRideApi.getCurrentSession()
      .then(session => {
        if (session && (session.status === 'online' || session.status === 'on_trip')) {
          setOnline(Number(session.id), Number(session.vehicle_id), Number(session.category_id))
          connectDriverSocket()
        }
      })
      .catch(() => {})
  }, [setOnline])

  useEffect(() => {
    if (!isOnline) return
    const socket = getDriverSocket()
    const onRideRequest = (data: {
      rideId: string; pickup: string; drop: string; distanceToPickup: number;
      estimatedFare: number; rideType: string; isReturnCab: boolean; expiresAt: string;
      timeoutSeconds: number; pickupLat?: number; pickupLng?: number;
      destinationLat?: number; destinationLng?: number;
    }) => {
      const pLat = data.pickupLat ?? DEFAULT_LAT
      const pLng = data.pickupLng ?? DEFAULT_LNG
      let tripDistance = 0
      if (data.destinationLat != null && data.destinationLng != null) {
        const R = 6371
        const dLat = (data.destinationLat - pLat) * Math.PI / 180
        const dLng = (data.destinationLng - pLng) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(pLat * Math.PI / 180) * Math.cos(data.destinationLat * Math.PI / 180) *
          Math.sin(dLng / 2) ** 2
        tripDistance = Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 1.3 * 10) / 10
      }
      setIncomingRequest({
        rideId: data.rideId, pickup: data.pickup, drop: data.drop,
        pickupDistance: data.distanceToPickup / 1000, tripDistance, fare: data.estimatedFare,
        timeoutSeconds: data.timeoutSeconds, pickupLat: pLat, pickupLng: pLng,
      })
    }
    socket.on('ride:request', onRideRequest)
    return () => { socket.off('ride:request', onRideRequest) }
  }, [isOnline, setIncomingRequest])

  useEffect(() => {
    if (!isOnline || !sessionId) {
      if (locationIntervalRef.current) { clearInterval(locationIntervalRef.current); locationIntervalRef.current = null }
      return
    }
    const sendLocation = async () => {
      const pos = await getCurrentPosition().catch(() => null)
      if (!pos) return  // never send fake coordinates on GPS failure
      setMapCenter([pos.coords.latitude, pos.coords.longitude])
      await driverRideApi.updateLocation({
        sessionId, lat: pos.coords.latitude, lng: pos.coords.longitude,
        recordedAt: new Date().toISOString(),
      }).catch(() => {})
    }
    void sendLocation()
    locationIntervalRef.current = setInterval(sendLocation, 30_000)
    // Re-fire immediately when the driver returns from background
    const onVisible = () => { if (document.visibilityState === 'visible') void sendLocation() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isOnline, sessionId])

  const handleToggle = () => {
    if (!isOnline) navigate('/go-online/mode')
    else void handleGoOffline()
  }

  const handleGoOffline = async () => {
    if (locationIntervalRef.current) { clearInterval(locationIntervalRef.current); locationIntervalRef.current = null }
    disconnectDriverSocket()
    setOffline()
    await driverRideApi.goOffline('driver_choice').catch(() => {})
  }

  const handleAcceptRide = async (rideId: string) => {
    try {
      await driverRideApi.acceptRide(rideId)
      const ride = await driverRideApi.getRide(rideId)
      setActiveRide({
        id: rideId, status: 'accepted',
        pickup: ride.origin_address ?? 'Pickup',
        drop: ride.destination_address ?? 'Destination',
        pickupLat: ride.origin_lat, pickupLng: ride.origin_lng,
        dropLat: ride.dest_lat ?? undefined, dropLng: ride.dest_lng ?? undefined,
        fare: ride.total_estimated != null ? parseFloat(ride.total_estimated) : 0,
        userPhone: ride.user_phone ?? undefined, userName: ride.user_name ?? undefined,
      })
      clearIncomingRequest()
      navigate('/ride/navigate')
    } catch { clearIncomingRequest() }
  }

  const STATS = [
    { icon: IndianRupee, value: `₹${e.total.toLocaleString('en-IN')}`, label: 'Earned',  color: '#16A34A', bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.15)'  },
    { icon: Clock,       value: String(e.trips),                        label: 'Trips',   color: '#2563EB', bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.15)'  },
    { icon: Star,        value: String(e.rating),                       label: 'Rating',  color: '#D97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.15)'  },
  ]

  return (
    <div className="relative w-full h-screen overflow-hidden bg-surface-2">

      {/* Map — full bleed behind everything */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface-2 animate-pulse" />}>
          <DriverMapView center={mapCenter} zoom={15} dimmed={!isOnline} />
        </Suspense>
      </div>

      {/* Floating header — Ocar logo + status pill + bell */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-12 pb-2"
        style={{ zIndex: 10 }}
      >
        {/* Logo pill */}
        <div className="px-3.5 py-2 rounded-2xl" style={GLASS}>
          <span className="font-display font-black text-[17px] tracking-tight leading-none select-none">
            <span className="text-primary">O</span>
            <span className="text-text-primary">car</span>
          </span>
        </div>

        {/* Status + bell */}
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={isOnline ? {
              ...GLASS,
              background: 'rgba(255,255,255,0.92)',
              border:     '1px solid rgba(249,115,22,0.28)',
            } : GLASS}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                isOnline ? 'bg-accent-orange animate-pulse-soft' : 'bg-text-muted'
              }`}
            />
            <span
              className={`text-[11px] font-bold ${isOnline ? 'text-amber-700' : 'text-text-muted'}`}
            >
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>

          <button
            aria-label="Notifications"
            className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-transform active:scale-90"
            style={GLASS}
          >
            <Bell size={17} className="text-text-secondary" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Offline badge — centered below the header */}
      {!isOnline && (
        <div
          className="absolute top-28 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full animate-fade-in"
          style={{
            zIndex:             10,
            background:         'rgba(255,255,255,0.94)',
            backdropFilter:     'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border:             '1px solid rgba(0,0,0,0.08)',
            boxShadow:          '0 2px 16px rgba(0,0,0,0.12)',
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-text-muted flex-shrink-0" />
          <p className="text-text-secondary text-xs font-semibold whitespace-nowrap">
            You're offline — tap toggle to earn
          </p>
        </div>
      )}

      {/* Bottom sheet — sits above BottomNav */}
      <div
        className="absolute left-0 right-0 rounded-t-[28px]"
        style={{
          bottom:    NAV_HEIGHT,
          zIndex:    10,
          background:'#FFFFFF',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 -6px 40px rgba(0,0,0,0.10)',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-8 h-[3px] rounded-full bg-border" />
        </div>

        <div className="px-5 pt-3 pb-5">
          {/* Greeting row + toggle */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-text-muted text-[10px] font-bold uppercase tracking-[0.12em] mb-0.5">
                {isOnline ? 'Looking for rides' : 'Ready to drive?'}
              </p>
              <p className="text-text-primary font-display font-bold text-xl leading-tight">
                Hi, {firstName}
              </p>
            </div>
            <OnlineToggle isOnline={isOnline} onToggle={handleToggle} />
          </div>

          {/* Today's stats */}
          <div className="grid grid-cols-3 gap-2.5 mb-4">
            {STATS.map(stat => (
              <div
                key={stat.label}
                className="rounded-2xl p-3 text-center"
                style={{ background: stat.bg, border: `1px solid ${stat.border}` }}
              >
                <div className="flex items-center justify-center gap-1 mb-1">
                  <stat.icon size={11} style={{ color: stat.color }} aria-hidden="true" />
                  <span className="font-black text-sm tabular-nums" style={{ color: stat.color }}>
                    {stat.value}
                  </span>
                </div>
                <p className="text-text-muted text-[10px] font-semibold">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Status banner */}
          {isOnline ? (
            <div
              className="flex items-center gap-2.5 rounded-2xl px-4 py-3"
              style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.18)' }}
            >
              <span className="w-2 h-2 rounded-full bg-accent-orange animate-pulse-soft flex-shrink-0" aria-hidden="true" />
              <p className="text-amber-700 text-sm font-semibold">Online — waiting for rides nearby</p>
            </div>
          ) : (
            <div
              className="flex items-center gap-2.5 rounded-2xl px-4 py-3"
              style={{ background: '#F8FAFF', border: '1px solid #E2E8F0' }}
            >
              <TrendingUp size={14} className="text-text-muted flex-shrink-0" aria-hidden="true" />
              <p className="text-text-muted text-sm">Tap the toggle above to start earning</p>
            </div>
          )}
        </div>
      </div>

      {/* Incoming ride request overlay */}
      <AnimatePresence>
        {incomingRequest && (
          <TripRequestCard
            pickup={incomingRequest.pickup}
            drop={incomingRequest.drop}
            pickupDistance={incomingRequest.pickupDistance}
            tripDistance={incomingRequest.tripDistance}
            fare={incomingRequest.fare}
            timeRemaining={incomingRequest.timeoutSeconds}
            onAccept={() => void handleAcceptRide(incomingRequest.rideId)}
            onDecline={clearIncomingRequest}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
