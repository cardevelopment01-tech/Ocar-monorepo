'use client'

import { DEMO_MODE } from '@/lib/demo'
import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, MessageSquare, MapPin, Navigation, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { rideApi, type RideDetail } from '@/lib/ride-api'
import { geoApi } from '@/lib/geo-api'
import { connectSocket, joinRideRoom, leaveRideRoom, getSocket } from '@/lib/socket'

const RideMapScene = dynamic(() => import('@/components/map/RideMapScene'), { ssr: false })

const PICKUP = { lat: 20.2961, lng: 85.8245 }
const DROP   = { lat: 20.2726, lng: 85.8385 }

const EASE = [0.22, 1, 0.36, 1] as const

type StatusKey = 'requested' | 'accepted' | 'driver_arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_drivers'

const STATUS_CONFIG: Record<StatusKey, { label: string; sub?: string; dot: string; dotPulse: boolean }> = {
  requested:      { label: 'Finding your driver',         sub: 'Usually ready in 15–60 seconds', dot: '#F59E0B', dotPulse: true  },
  accepted:       { label: 'Driver is on the way',                                                 dot: '#2563EB', dotPulse: false },
  driver_arrived: { label: 'Driver has arrived!',          sub: 'Head to your pickup point',       dot: '#16A34A', dotPulse: true  },
  in_progress:    { label: 'On the way to destination',                                             dot: '#2563EB', dotPulse: false },
  completed:      { label: 'You have arrived!',                                                     dot: '#16A34A', dotPulse: false },
  cancelled:      { label: 'Ride cancelled',               sub: 'Returning to home…',              dot: '#DC2626', dotPulse: false },
  no_drivers:     { label: 'No drivers available',         sub: 'Please try again in a moment',    dot: '#DC2626', dotPulse: false },
}

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function SearchingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: '#F59E0B' }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  )
}

export default function RidePage() {
  const params = useParams<{ id: string }>()
  const rideId = params?.id ?? ''
  const router  = useRouter()

  const [ride,           setRide]           = useState<RideDetail | null>(null)
  const [rideStatus,     setRideStatus]     = useState<string>('requested')
  const [driverPos,      setDriverPos]      = useState<[number, number] | undefined>(undefined)
  const [driverHeading,  setDriverHeading]  = useState(0)
  const [encodedPolyline, setEncodedPolyline] = useState<string | undefined>(undefined)
  const [socketOk,       setSocketOk]       = useState(false)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const routeRef = useRef(false)

  const DEMO_ALLOWED = new Set(['requested', 'accepted', 'cancelled', 'no_drivers'])

  const loadRide = useCallback(async () => {
    try {
      const data = await rideApi.getRide(rideId)
      setRide(data)
      setRideStatus(DEMO_MODE && !DEMO_ALLOWED.has(data.status) ? 'accepted' : data.status)

      // Fetch real road route once (when coords are available)
      if (!routeRef.current && data.origin_lat && data.dest_lat && data.dest_lng) {
        routeRef.current = true
        geoApi.getRoute(data.origin_lat, data.origin_lng, data.dest_lat, data.dest_lng)
          .then(r => setEncodedPolyline(r.polyline))
          .catch(() => { /* use straight-line fallback */ })
      }
    } catch { /* ignore */ }
  }, [rideId])

  useEffect(() => {
    if (!rideId) return
    void loadRide()

    if (DEMO_MODE) {
      pollRef.current = setInterval(() => void loadRide(), 4_000)
      return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }

    connectSocket()
    const socket = getSocket()
    joinRideRoom(rideId)

    socket.on('connect',    () => { setSocketOk(true); if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } })
    socket.on('disconnect', () => setSocketOk(false))

    socket.on('ride:status_update', (data: { status: string }) => setRideStatus(data.status))

    socket.on('ride:driver_assigned', (data: { driverName?: string; driverPhone?: string }) => {
      setRideStatus('accepted')
      if (data.driverName || data.driverPhone) {
        setRide(prev => prev
          ? { ...prev, driver_name: data.driverName ?? prev.driver_name, driver_phone: data.driverPhone ?? prev.driver_phone }
          : prev
        )
      }
    })

    socket.on('driver:location', (data: { lat: number; lng: number; heading: number }) => {
      setDriverPos([data.lat, data.lng])
      setDriverHeading(data.heading)
    })

    const fallbackTimer = setTimeout(() => {
      if (!socket.connected) pollRef.current = setInterval(() => void loadRide(), 10_000)
    }, 3000)

    return () => {
      leaveRideRoom(rideId)
      socket.off('ride:status_update')
      socket.off('ride:driver_assigned')
      socket.off('driver:location')
      socket.off('connect')
      socket.off('disconnect')
      clearTimeout(fallbackTimer)
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [rideId, loadRide])

  useEffect(() => {
    if (DEMO_MODE) return
    if (rideStatus === 'completed') {
      const t = setTimeout(() => router.push(`/ride/${rideId}/rate`), 2000)
      return () => clearTimeout(t)
    }
    if (rideStatus === 'cancelled' || rideStatus === 'no_drivers') {
      const t = setTimeout(() => router.push('/home'), 3000)
      return () => clearTimeout(t)
    }
  }, [rideStatus, rideId, router])

  const pickupPos: [number, number] = ride ? [ride.origin_lat, ride.origin_lng] : [PICKUP.lat, PICKUP.lng]
  const dropPos:   [number, number] = ride?.dest_lat && ride.dest_lng ? [ride.dest_lat, ride.dest_lng] : [DROP.lat, DROP.lng]
  const mapCenter: [number, number] = driverPos ?? pickupPos

  const status    = (rideStatus as StatusKey) in STATUS_CONFIG ? (rideStatus as StatusKey) : 'requested'
  const cfg       = STATUS_CONFIG[status]
  const hasDriver = rideStatus !== 'requested'

  const fare = ride?.total_estimated != null ? `₹${Math.round(parseFloat(ride.total_estimated))}` : null

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">

      {/* ── Map ── */}
      <div className="relative" style={{ flex: '1 1 0', minHeight: 0 }}>
        <RideMapScene
          center={mapCenter}
          pickupPos={pickupPos}
          dropPos={dropPos}
          encodedPolyline={encodedPolyline}
          driverPos={driverPos}
          driverHeading={driverHeading}
        />

        {/* Dev socket indicator */}
        {process.env.NODE_ENV === 'development' && (
          <div className={`absolute top-4 right-4 z-10 w-2 h-2 rounded-full shadow ${socketOk ? 'bg-green-500' : 'bg-amber-400'}`} />
        )}
      </div>

      {/* ── Bottom sheet ── */}
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300, delay: 0.08 }}
        className="bg-background rounded-t-[28px] shadow-[0_-4px_32px_rgba(0,0,0,0.10)]"
        style={{ flexShrink: 0 }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-gray-200" />
        </div>

        {/* ── Status badge row ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={status}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="flex items-center gap-3 mx-4 mt-3 mb-4 px-4 py-3 rounded-2xl"
            style={{
              background: status === 'requested'      ? 'rgba(245,158,11,0.08)'
                        : status === 'driver_arrived' ? 'rgba(22,163,74,0.08)'
                        : status === 'completed'      ? 'rgba(22,163,74,0.08)'
                        : (status === 'cancelled' || status === 'no_drivers') ? 'rgba(220,38,38,0.08)'
                        : 'rgba(37,99,235,0.07)',
              border: `1px solid ${
                status === 'requested'      ? 'rgba(245,158,11,0.22)'
                : status === 'driver_arrived' ? 'rgba(22,163,74,0.22)'
                : status === 'completed'    ? 'rgba(22,163,74,0.22)'
                : (status === 'cancelled' || status === 'no_drivers') ? 'rgba(220,38,38,0.22)'
                : 'rgba(37,99,235,0.18)'
              }`,
            }}
          >
            {/* Dot */}
            <div className="relative flex-shrink-0 w-3 h-3">
              {cfg.dotPulse && (
                <div
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: cfg.dot, opacity: 0.35 }}
                />
              )}
              <div className="relative w-3 h-3 rounded-full" style={{ background: cfg.dot }} />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 leading-tight">{cfg.label}</p>
              {cfg.sub && <p className="text-xs text-gray-500 mt-0.5">{cfg.sub}</p>}
            </div>

            {status === 'requested' && <SearchingDots />}
          </motion.div>
        </AnimatePresence>

        {/* ── Content ── */}
        <AnimatePresence mode="wait">

          {/* Searching */}
          {!hasDriver && (
            <motion.div
              key="searching"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="px-4 pb-6"
            >
              {/* Route preview row */}
              <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl mb-4" style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#2563EB' }} />
                  <div className="w-px flex-1 bg-gray-200" style={{ height: 20 }} />
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-800" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Pickup</p>
                    <p className="text-sm font-medium text-gray-800 truncate">{ride?.origin_address ?? 'Your location'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Drop</p>
                    <p className="text-sm font-medium text-gray-800 truncate">{ride?.destination_address ?? 'Destination'}</p>
                  </div>
                </div>
                {fare && (
                  <div className="flex-shrink-0 text-right">
                    <p className="text-[10px] font-semibold text-gray-400">Est. fare</p>
                    <p className="text-base font-black text-gray-900">{fare}</p>
                  </div>
                )}
              </div>

              <button
                onClick={() => router.back()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-red-600 active:opacity-70 transition-opacity"
                style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.16)' }}
              >
                <X size={15} strokeWidth={2.5} />
                Cancel ride
              </button>
            </motion.div>
          )}

          {/* Driver assigned */}
          {hasDriver && (
            <motion.div
              key="driver"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="px-4 pb-6"
            >
              {/* Driver card */}
              <div className="flex items-center gap-3 mb-4">
                {/* Avatar */}
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-white text-[15px] font-black"
                  style={{ background: 'linear-gradient(135deg, #3B82F6, #2563EB)' }}
                >
                  {ride?.driver_name ? getInitials(ride.driver_name) : '?'}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-[15px] leading-tight">{ride?.driver_name ?? 'Your Driver'}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-amber-400 text-xs">★</span>
                    <span className="text-xs font-semibold text-gray-600">4.8</span>
                    <span className="text-gray-300 text-xs">·</span>
                    <span className="text-xs text-gray-500">Sedan</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-shrink-0">
                  {ride?.driver_phone && (
                    <a
                      href={`tel:${ride.driver_phone}`}
                      className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-95 transition-transform"
                      style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)' }}
                    >
                      <Phone size={16} style={{ color: '#2563EB' }} />
                    </a>
                  )}
                  <button
                    className="w-10 h-10 rounded-2xl flex items-center justify-center active:scale-95 transition-transform"
                    style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}
                  >
                    <MessageSquare size={16} className="text-gray-500" />
                  </button>
                </div>
              </div>

              {/* Route row */}
              <div
                className="flex gap-3 px-4 py-3.5 rounded-2xl mb-3"
                style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}
              >
                <div className="flex flex-col items-center gap-1 flex-shrink-0 mt-0.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#2563EB' }} />
                  <div className="w-px bg-gray-200" style={{ height: 18 }} />
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-800" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Pickup</p>
                    <p className="text-sm font-medium text-gray-800 truncate">{ride?.origin_address ?? 'Your location'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Drop</p>
                    <p className="text-sm font-medium text-gray-800 truncate">{ride?.destination_address ?? 'Destination'}</p>
                  </div>
                </div>
              </div>

              {/* Context row — fare or arrived note */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={status}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  {(rideStatus === 'accepted' || rideStatus === 'in_progress') && fare && (
                    <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl"
                      style={{ background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                      <div className="flex items-center gap-2">
                        <Navigation size={14} className="text-blue-600" />
                        <span className="text-sm font-semibold text-gray-700">Estimated fare</span>
                      </div>
                      <span className="text-base font-black text-gray-900">{fare}</span>
                    </div>
                  )}
                  {rideStatus === 'driver_arrived' && (
                    <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl"
                      style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.18)' }}>
                      <MapPin size={14} className="text-green-600" />
                      <span className="text-sm font-semibold text-green-700">Driver is at your pickup point</span>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>

            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  )
}
