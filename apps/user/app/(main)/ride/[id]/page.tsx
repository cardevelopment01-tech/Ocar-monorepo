'use client'

import { DEMO_MODE } from '@/lib/demo'
import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Phone, MessageSquare, MapPin, Clock, Star } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useParams, useRouter } from 'next/navigation'
import { rideApi, type RideDetail } from '@/lib/ride-api'
import { connectSocket, joinRideRoom, leaveRideRoom, getSocket } from '@/lib/socket'

const RideMapScene = dynamic(() => import('@/components/map/RideMapScene'), { ssr: false })

const PICKUP = { lat: 20.2961, lng: 85.8245 }
const DROP   = { lat: 20.2726, lng: 85.8385 }

type StatusKey = 'requested' | 'accepted' | 'driver_arrived' | 'in_progress' | 'completed' | 'cancelled' | 'no_drivers'

const STATUS_MESSAGE: Record<StatusKey, string> = {
  requested:      'Finding your driver…',
  accepted:       'Driver is on the way',
  driver_arrived: 'Driver has arrived!',
  in_progress:    'On the way to your destination',
  completed:      'You have arrived!',
  cancelled:      'Ride cancelled',
  no_drivers:     'No drivers available nearby',
}

export default function RidePage() {
  const params = useParams<{ id: string }>()
  const rideId = params?.id ?? ''
  const router  = useRouter()

  const [ride,         setRide]         = useState<RideDetail | null>(null)
  const [rideStatus,   setRideStatus]   = useState<string>('requested')
  const [driverPos,    setDriverPos]    = useState<[number, number] | undefined>(undefined)
  const [driverHeading, setDriverHeading] = useState(0)
  const [socketOk,     setSocketOk]     = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const DEMO_ALLOWED = new Set(['requested', 'accepted', 'cancelled', 'no_drivers'])

  const loadRide = useCallback(async () => {
    try {
      const data = await rideApi.getRide(rideId)
      setRide(data)
      setRideStatus(DEMO_MODE && !DEMO_ALLOWED.has(data.status) ? 'accepted' : data.status)
    } catch { /* ignore */ }
  }, [rideId])

  // Mount: load ride data, connect socket, start polling fallback
  useEffect(() => {
    if (!rideId) return
    void loadRide()

    if (DEMO_MODE) return // no live socket in demo — page is static after loadRide

    connectSocket()
    const socket = getSocket()

    joinRideRoom(rideId)

    socket.on('connect', () => {
      setSocketOk(true)
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    })
    socket.on('disconnect', () => {
      setSocketOk(false)
    })

    socket.on('ride:status_update', (data: { status: string }) => {
      setRideStatus(data.status)
    })

    socket.on('ride:driver_assigned', (data: { driverId?: string; driverName?: string; driverPhone?: string }) => {
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

    // Polling fallback if socket not connected after 3s
    const fallbackTimer = setTimeout(() => {
      if (!socket.connected) {
        pollRef.current = setInterval(() => void loadRide(), 10_000)
      }
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

  // Redirect on completion/cancellation (skip redirects in demo mode)
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
  // Center on driver when known, else midpoint of route
  const mapCenter: [number, number] = driverPos ?? pickupPos
  // Route: driver→pickup while approaching, driver→drop while in progress, pickup→drop otherwise
  const mapRoute: [number, number][] =
    driverPos && (rideStatus === 'accepted' || rideStatus === 'driver_arrived')
      ? [driverPos, pickupPos]
      : driverPos && rideStatus === 'in_progress'
      ? [driverPos, dropPos]
      : [pickupPos, dropPos]

  const status = (rideStatus as StatusKey) in STATUS_MESSAGE ? (rideStatus as StatusKey) : 'requested'
  const hasDriver = rideStatus !== 'requested'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Map */}
      <div className="relative flex-1">
        <RideMapScene
          center={mapCenter}
          pickupPos={pickupPos}
          dropPos={dropPos}
          route={mapRoute}
          driverPos={driverPos}
          driverHeading={driverHeading}
        />

        {/* Status pill */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <motion.div
            key={rideStatus}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-surface rounded-full shadow-float px-4 py-2"
          >
            {rideStatus === 'requested' && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-status-warning animate-pulse-soft" />
                <span className="text-sm font-semibold text-text-primary">{STATUS_MESSAGE.requested}</span>
              </div>
            )}
            {rideStatus === 'accepted' && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span className="text-sm font-semibold text-text-primary">{STATUS_MESSAGE.accepted}</span>
              </div>
            )}
            {rideStatus === 'driver_arrived' && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse-soft" />
                <span className="text-sm font-semibold text-text-primary">{STATUS_MESSAGE.driver_arrived}</span>
              </div>
            )}
            {rideStatus === 'in_progress' && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-status-success animate-pulse-soft" />
                <span className="text-sm font-semibold text-text-primary">{STATUS_MESSAGE.in_progress}</span>
              </div>
            )}
            {rideStatus === 'completed' && (
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-status-success">{STATUS_MESSAGE.completed} ✓</span>
              </div>
            )}
            {(rideStatus === 'cancelled' || rideStatus === 'no_drivers') && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-status-error" />
                <span className="text-sm font-semibold text-status-error">{STATUS_MESSAGE[status]}</span>
              </div>
            )}
          </motion.div>
        </div>

        {/* Socket indicator (dev only — remove in prod) */}
        {process.env.NODE_ENV === 'development' && (
          <div className={`absolute top-4 right-4 z-10 w-2 h-2 rounded-full ${socketOk ? 'bg-status-success' : 'bg-status-warning'}`} />
        )}
      </div>

      {/* Bottom sheet — container stays mounted; only inner blocks animate */}
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="bg-surface rounded-t-3xl shadow-sheet px-4 pt-4 pb-24"
      >
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-4" />

        <AnimatePresence mode="wait">
          {!hasDriver ? (
            <motion.div
              key="searching"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center py-4 gap-3"
            >
              <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              <p className="text-text-secondary text-sm">Looking for nearby drivers</p>
              <p className="text-text-muted text-xs">Ride #{rideId}</p>
              <button onClick={() => router.back()} className="mt-2 text-status-error text-sm font-medium">
                Cancel ride
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="driver"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              {/* Driver info — stays stable across status changes */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-primary-subtle flex items-center justify-center text-2xl flex-shrink-0">
                  👤
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-text-primary">{ride?.driver_name ?? 'Your Driver'}</p>
                  <div className="flex items-center gap-1 text-xs text-text-muted">
                    <Star size={11} className="fill-status-warning text-status-warning" />
                    <span>4.8</span>
                    <span>· Sedan</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {ride?.driver_phone && (
                    <a
                      href={`tel:${ride.driver_phone}`}
                      className="w-10 h-10 bg-background rounded-full flex items-center justify-center active:scale-95 transition-transform"
                    >
                      <Phone size={16} className="text-primary" />
                    </a>
                  )}
                  <button className="w-10 h-10 bg-background rounded-full flex items-center justify-center active:scale-95 transition-transform">
                    <MessageSquare size={16} className="text-primary" />
                  </button>
                </div>
              </div>

              {/* Route summary */}
              <div className="space-y-2 mb-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                  <div>
                    <p className="text-xs text-text-muted">Pickup</p>
                    <p className="text-sm font-medium text-text-primary">{ride?.origin_address ?? 'Pickup'}</p>
                  </div>
                </div>
                <div className="ml-[5px] w-px h-4 bg-border" />
                <div className="flex items-start gap-3">
                  <div className="mt-1 w-2 h-2 rounded-full bg-text-primary flex-shrink-0" />
                  <div>
                    <p className="text-xs text-text-muted">Drop</p>
                    <p className="text-sm font-medium text-text-primary">{ride?.destination_address ?? 'Destination'}</p>
                  </div>
                </div>
              </div>

              {/* Status detail — only THIS swaps as status changes */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={rideStatus}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  {rideStatus === 'accepted' && (
                    <div className="flex items-center gap-2 bg-primary-subtle rounded-2xl px-4 py-3 mb-3">
                      <Clock size={16} className="text-primary" />
                      <span className="text-sm font-semibold text-primary">Driver is on the way</span>
                      {DEMO_MODE && (
                        <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-primary/60 bg-primary/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                          Live tracking soon
                        </span>
                      )}
                    </div>
                  )}
                  {rideStatus === 'driver_arrived' && (
                    <div className="flex items-center gap-2 bg-status-success/10 rounded-2xl px-4 py-3 mb-3">
                      <MapPin size={16} className="text-status-success" />
                      <span className="text-sm font-semibold text-status-success">Driver is at your location</span>
                    </div>
                  )}
                  {rideStatus === 'in_progress' && (
                    <div className="flex items-center gap-2 bg-background rounded-2xl px-4 py-3 mb-3">
                      <MapPin size={16} className="text-primary" />
                      <span className="text-sm font-semibold text-text-primary">
                        Fare: ₹{ride?.total_estimated != null ? Math.round(parseFloat(ride.total_estimated)) : '—'}
                      </span>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="h-4" />
      </motion.div>
    </div>
  )
}
