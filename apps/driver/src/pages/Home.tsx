import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { IndianRupee, Clock, Star, TrendingUp, Bell, Wallet, ChevronRight } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import OnlineToggle from '@/components/ui/OnlineToggle'
import TripRequestCard from '@/components/ui/TripRequestCard'
import { mockEarnings } from '@/lib/mock-data'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useRideStore } from '@/store/useRideStore'
import { driverRideApi } from '@/lib/ride-api'
import api from '@/lib/api'
import { connectDriverSocket, disconnectDriverSocket, getDriverSocket } from '@/lib/socket'

const DriverMapView  = lazy(() => import('@/components/map/DriverMapView'))
const RecenterMap    = lazy(() => import('@/components/map/RecenterMap'))
const SelfCarMarker  = lazy(() => import('@/components/map/SelfCarMarker'))

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
  const sheetRef            = useRef<HTMLDivElement | null>(null)
  const geoTimer            = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGeoCoord        = useRef<[number, number] | null>(null)

  const [mapCenter,          setMapCenter]         = useState<[number, number]>([20.2961, 85.8245])
  const [sheetHeight,        setSheetHeight]       = useState(320)
  const [areaName,           setAreaName]          = useState<string | null>(null)
  const [geoLoading,         setGeoLoading]        = useState(false)
  const [showOfflineConfirm, setShowOfflineConfirm] = useState(false)
  const e = mockEarnings.today
  const firstName = driver?.full_name?.split(' ')[0] ?? 'Driver'

  useEffect(() => {
    driverRideApi.getCurrentSession()
      .then(session => {
        if (session && (session.status === 'online' || session.status === 'on_trip')) {
          setOnline(Number(session.id), Number(session.vehicle_id), Number(session.category_id))
          connectDriverSocket()
        } else {
          // DB says no active session — clear any stale persisted online state
          setOffline()
          disconnectDriverSocket()
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    else setShowOfflineConfirm(true)
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

  // Measure the bottom sheet so we can offset the map camera above it
  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setSheetHeight(Math.round(entry.contentRect.height))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reverse-geocode the driver's position whenever it meaningfully changes
  useEffect(() => {
    const [lat, lng] = mapCenter
    const prev = lastGeoCoord.current
    // Skip if barely moved (< ~30m ≈ 3e-4 deg) since last successful geocode
    if (prev && Math.abs(prev[0] - lat) < 3e-4 && Math.abs(prev[1] - lng) < 3e-4) return

    if (geoTimer.current) clearTimeout(geoTimer.current)
    const controller = new AbortController()
    setGeoLoading(true)

    geoTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get<{ address: string }>('/api/v1/geo/reverse', {
          params: { lat, lng },
          signal: controller.signal,
        })
        if (data?.address) {
          setAreaName(data.address)
          lastGeoCoord.current = [lat, lng]
        }
      } catch {
        // keep previous areaName — swallows abort + network errors
      } finally {
        setGeoLoading(false)
      }
    }, 800)

    return () => {
      if (geoTimer.current) clearTimeout(geoTimer.current)
      controller.abort()
    }
  }, [mapCenter])

  const bottomOcclusion = sheetHeight + NAV_HEIGHT

  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="relative w-full h-screen overflow-hidden bg-surface-2">

      {/* Map — full bleed behind everything */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface-2 animate-pulse" />}>
          <DriverMapView center={mapCenter} zoom={15} dimmed={!isOnline}>
            <RecenterMap
              center={mapCenter}
              bottomPadding={bottomOcclusion}
              topPadding={110}
            />
            <SelfCarMarker position={mapCenter} areaName={areaName} loading={geoLoading} />
          </DriverMapView>
        </Suspense>
      </div>

      {/* Floating header */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-12 pb-2"
        style={{ zIndex: 10 }}
      >
        <div className="px-3.5 py-2 rounded-2xl" style={GLASS}>
          <span className="font-display font-black text-[17px] tracking-tight leading-none select-none">
            <span className="text-primary">O</span>
            <span className="text-text-primary">car</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Live status pill */}
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={isOnline ? { ...GLASS, border: '1px solid rgba(249,115,22,0.28)' } : GLASS}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOnline ? 'bg-accent-orange animate-pulse-soft' : 'bg-text-muted'}`} />
            <span className={`text-[11px] font-bold ${isOnline ? 'text-amber-700' : 'text-text-muted'}`}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <button aria-label="Notifications" className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform" style={GLASS}>
            <Bell size={17} className="text-text-secondary" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Bottom sheet — sits above BottomNav */}
      <div
        ref={sheetRef}
        className="absolute left-0 right-0 rounded-t-[28px]"
        style={{ bottom: NAV_HEIGHT, zIndex: 10, background: '#FFFFFF', borderTop: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 -8px 40px rgba(0,0,0,0.12)' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-0">
          <div className="w-9 h-[3px] rounded-full bg-border" />
        </div>

        <div className="px-5 pt-4 pb-5">

          {/* ── Row 1: Greeting + Toggle ── */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-text-muted text-[10px] font-bold uppercase tracking-[0.13em] mb-0.5">{todayLabel}</p>
              <p className="text-text-primary font-display font-bold text-[22px] leading-tight">
                Hi, {firstName} 👋
              </p>
              <p className="text-text-muted text-xs mt-0.5">
                {isOnline ? 'You\'re live — ride requests incoming' : 'Go online to start earning'}
              </p>
            </div>
            <OnlineToggle isOnline={isOnline} onToggle={handleToggle} />
          </div>

          {/* ── Row 2: Today's stats ── */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {/* Earnings — most prominent */}
            <div className="rounded-2xl px-3 py-3 text-center" style={{ background: 'rgba(22,163,74,0.07)', border: '1px solid rgba(22,163,74,0.14)' }}>
              <div className="flex items-center justify-center gap-0.5 mb-0.5">
                <IndianRupee size={12} style={{ color: '#16A34A' }} />
                <span className="font-black text-[15px] tabular-nums" style={{ color: '#16A34A' }}>
                  {e.total.toLocaleString('en-IN')}
                </span>
              </div>
              <p className="text-text-muted text-[10px] font-semibold">Earned</p>
            </div>
            <div className="rounded-2xl px-3 py-3 text-center" style={{ background: 'rgba(37,99,235,0.07)', border: '1px solid rgba(37,99,235,0.13)' }}>
              <div className="flex items-center justify-center gap-0.5 mb-0.5">
                <Clock size={11} style={{ color: '#2563EB' }} />
                <span className="font-black text-[15px] tabular-nums" style={{ color: '#2563EB' }}>{e.trips}</span>
              </div>
              <p className="text-text-muted text-[10px] font-semibold">Trips</p>
            </div>
            <div className="rounded-2xl px-3 py-3 text-center" style={{ background: 'rgba(217,119,6,0.07)', border: '1px solid rgba(217,119,6,0.13)' }}>
              <div className="flex items-center justify-center gap-0.5 mb-0.5">
                <Star size={11} style={{ color: '#D97706' }} />
                <span className="font-black text-[15px] tabular-nums" style={{ color: '#D97706' }}>{e.rating}</span>
              </div>
              <p className="text-text-muted text-[10px] font-semibold">Rating</p>
            </div>
          </div>

          {/* ── Row 3: Quick actions ── */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => navigate('/earnings')}
              className="flex items-center justify-between px-4 py-3 rounded-2xl active:opacity-70 transition-opacity"
              style={{ background: '#F8FAFF', border: '1px solid #E2E8F0' }}
            >
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-primary" />
                <span className="text-text-primary text-[13px] font-semibold">Earnings</span>
              </div>
              <ChevronRight size={14} className="text-text-muted" />
            </button>
            <button
              onClick={() => navigate('/wallet')}
              className="flex items-center justify-between px-4 py-3 rounded-2xl active:opacity-70 transition-opacity"
              style={{ background: '#F8FAFF', border: '1px solid #E2E8F0' }}
            >
              <div className="flex items-center gap-2">
                <Wallet size={15} className="text-primary" />
                <span className="text-text-primary text-[13px] font-semibold">Wallet</span>
              </div>
              <ChevronRight size={14} className="text-text-muted" />
            </button>
          </div>

          {/* ── Row 4: Live status banner ── */}
          {isOnline ? (
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.16)' }}>
              <span className="w-2 h-2 rounded-full bg-accent-orange animate-pulse-soft flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-amber-700 text-[13px] font-bold leading-tight">Searching for nearby rides…</p>
                <p className="text-amber-600/70 text-[11px] mt-0.5">Stay in the area for faster matching</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#F8FAFF', border: '1px solid #E2E8F0' }}>
              <span className="w-2 h-2 rounded-full bg-text-muted flex-shrink-0" />
              <p className="text-text-muted text-[13px]">Tap the toggle above to go online</p>
            </div>
          )}
        </div>
      </div>

      {/* Incoming ride request overlay */}
      <AnimatePresence>
        {incomingRequest && (
          <TripRequestCard
            key={incomingRequest.rideId}
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

      {/* Go offline confirmation — fixed so it covers BottomNav (z-100) */}
      {showOfflineConfirm && (
        <div
          className="fixed inset-0 flex items-end justify-center px-5"
          style={{ zIndex: 110, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
          onClick={() => setShowOfflineConfirm(false)}
        >
          <div
            className="w-full rounded-3xl p-6"
            style={{ background: '#FFFFFF', boxShadow: '0 -4px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-8 h-1 bg-border rounded-full mx-auto mb-5" />
            <p className="text-text-primary font-bold text-lg mb-1">Go offline?</p>
            <p className="text-text-muted text-sm mb-6">You'll stop receiving ride requests until you go online again.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowOfflineConfirm(false)}
                className="flex-1 py-3 rounded-2xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowOfflineConfirm(false); void handleGoOffline() }}
                className="flex-1 py-3 rounded-2xl text-sm font-bold text-white transition-colors"
                style={{ background: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)' }}
              >
                Go Offline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
