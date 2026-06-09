import { useEffect, useRef, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { IndianRupee, Clock, Star, Wallet } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import OnlineToggle from '@/components/ui/OnlineToggle'
import StatusBar from '@/components/ui/StatusBar'
import TripRequestCard from '@/components/ui/TripRequestCard'
import { mockEarnings, mockCurrentLocation } from '@/lib/mock-data'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi } from '@/lib/ride-api'
import { connectDriverSocket, disconnectDriverSocket, getDriverSocket } from '@/lib/socket'

const DriverMapView = lazy(() => import('@/components/map/DriverMapView'))

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

export default function Home() {
  const navigate = useNavigate()
  const driver = useAuthStore(s => s.driver)
  const { isOnline, sessionId, setOnline, setOffline } = useSessionStore()
  const { incomingRequest, setIncomingRequest, clearIncomingRequest, setActiveRide } = useRideStore()

  const locationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const e = mockEarnings.today
  const firstName = driver?.full_name?.split(' ')[0] ?? 'Driver'

  // Sync session state from API on mount
  useEffect(() => {
    driverRideApi.getCurrentSession()
      .then(session => {
        if (session && (session.status === 'online' || session.status === 'on_trip')) {
          setOnline(Number(session.id), Number(session.vehicle_id), Number(session.category_id))
          connectDriverSocket()
        }
      })
      .catch(() => {/* ignore — store stays false */})
  }, [setOnline])

  // Socket.io ride:request listener
  useEffect(() => {
    if (!isOnline) return

    const socket = getDriverSocket()

    const onRideRequest = (data: {
      rideId: string
      pickup: string
      drop: string
      distanceToPickup: number
      estimatedFare: number
      rideType: string
      isReturnCab: boolean
      expiresAt: string
      timeoutSeconds: number
      pickupLat?: number
      pickupLng?: number
      destinationLat?: number
      destinationLng?: number
    }) => {
      const pLat = data.pickupLat ?? DEFAULT_LAT
      const pLng = data.pickupLng ?? DEFAULT_LNG
      let tripDistance = 0
      if (data.destinationLat != null && data.destinationLng != null) {
        const R = 6371
        const dLat = (data.destinationLat - pLat) * Math.PI / 180
        const dLng = (data.destinationLng - pLng) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(pLat * Math.PI / 180) *
          Math.cos(data.destinationLat * Math.PI / 180) *
          Math.sin(dLng / 2) ** 2
        tripDistance = Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 1.3 * 10) / 10
      }
      setIncomingRequest({
        rideId:          data.rideId,
        pickup:          data.pickup,
        drop:            data.drop,
        pickupDistance:  data.distanceToPickup / 1000,
        tripDistance,
        fare:            data.estimatedFare,
        timeoutSeconds:  data.timeoutSeconds,
        pickupLat:       pLat,
        pickupLng:       pLng,
      })
    }

    socket.on('ride:request', onRideRequest)
    return () => { socket.off('ride:request', onRideRequest) }
  }, [isOnline, setIncomingRequest])

  // Location updates every 30 seconds while online
  useEffect(() => {
    if (!isOnline || !sessionId) {
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current)
        locationIntervalRef.current = null
      }
      return
    }

    const sendLocation = async () => {
      let lat = DEFAULT_LAT, lng = DEFAULT_LNG
      try {
        const pos = await getCurrentPosition()
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch { /* use defaults */ }
      await driverRideApi.updateLocation({
        sessionId,
        lat,
        lng,
        recordedAt: new Date().toISOString(),
      }).catch(() => {})
    }

    void sendLocation()
    locationIntervalRef.current = setInterval(sendLocation, 30_000)
    return () => {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current)
    }
  }, [isOnline, sessionId])

  const handleToggle = () => {
    if (!isOnline) {
      navigate('/go-online/mode')
    } else {
      handleGoOffline()
    }
  }

  const handleGoOffline = async () => {
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current)
      locationIntervalRef.current = null
    }
    disconnectDriverSocket()
    setOffline()
    await driverRideApi.goOffline('driver_choice').catch(() => {})
  }

  const handleAcceptRide = async (rideId: string) => {
    try {
      await driverRideApi.acceptRide(rideId)
      const ride = await driverRideApi.getRide(rideId)
      setActiveRide({
        id:         rideId,
        status:     'accepted',
        pickup:     ride.origin_address  ?? 'Pickup',
        drop:       ride.destination_address ?? 'Destination',
        pickupLat:  ride.origin_lat,
        pickupLng:  ride.origin_lng,
        dropLat:    ride.dest_lat ?? undefined,
        dropLng:    ride.dest_lng ?? undefined,
        fare:       ride.total_estimated != null ? parseFloat(ride.total_estimated) : 0,
        userPhone:  ride.user_phone  ?? undefined,
        userName:   ride.user_name   ?? undefined,
      })
      clearIncomingRequest()
      navigate('/ride/navigate')
    } catch {
      clearIncomingRequest()
    }
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-bg">
      <StatusBar isOnline={isOnline} earningsToday={e.total} />

      {/* Map background */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView center={mockCurrentLocation} zoom={15} dimmed={!isOnline} />
        </Suspense>
      </div>

      {/* Offline overlay label */}
      {!isOnline && (
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface/90 rounded-2xl px-5 py-3 border border-border"
          style={{ zIndex: 10 }}
        >
          <p className="text-text-muted text-sm font-semibold text-center">You are offline</p>
          <p className="text-text-muted text-xs text-center">Tap the button to start earning</p>
        </div>
      )}

      {/* Bottom sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border"
        style={{ zIndex: 10 }}
      >
        <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mt-3" />

        <div className="px-5 pt-4 pb-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">
                {isOnline ? 'Looking for rides' : 'Ready to drive?'}
              </p>
              <p className="text-text-primary font-bold text-lg mt-0.5">
                Hi, {firstName}
              </p>
            </div>
            <OnlineToggle isOnline={isOnline} onToggle={handleToggle} />
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-surface-2 rounded-2xl p-3 border border-border text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <IndianRupee size={12} className="text-primary" />
                <span className="text-primary font-black text-lg">{e.total.toLocaleString('en-IN')}</span>
              </div>
              <p className="text-text-muted text-[11px]">Today</p>
            </div>
            <div className="bg-surface-2 rounded-2xl p-3 border border-border text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Clock size={12} className="text-accent-blue" />
                <span className="text-text-primary font-black text-lg">{e.trips}</span>
              </div>
              <p className="text-text-muted text-[11px]">Trips</p>
            </div>
            <div className="bg-surface-2 rounded-2xl p-3 border border-border text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Star size={12} className="text-accent-amber fill-accent-amber" />
                <span className="text-text-primary font-black text-lg">{e.rating}</span>
              </div>
              <p className="text-text-muted text-[11px]">Rating</p>
            </div>
          </div>

          {isOnline && (
            <div className="flex items-center gap-2 bg-primary/10 rounded-2xl px-4 py-3">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
              <p className="text-primary text-sm font-semibold">Online — waiting for rides</p>
            </div>
          )}

          {!isOnline && (
            <div className="flex items-center gap-2 bg-surface-3 rounded-2xl px-4 py-3">
              <Wallet size={16} className="text-text-muted flex-shrink-0" />
              <p className="text-text-muted text-sm">Tap the toggle to start earning</p>
            </div>
          )}
        </div>
      </div>

      {/* Incoming request overlay */}
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
