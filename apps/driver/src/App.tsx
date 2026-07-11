import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import ProtectedRoute from '@/components/ProtectedRoute'
import BottomNav from '@/components/ui/BottomNav'
import TripRequestCard from '@/components/ui/TripRequestCard'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import Earnings from '@/pages/Earnings'
import Wallet from '@/pages/Wallet'
import Profile from '@/pages/Profile'
import IncomingRequest from '@/pages/ActiveRide/IncomingRequest'
import NavigateToPickup from '@/pages/ActiveRide/NavigateToPickup'
import OTPVerify from '@/pages/ActiveRide/OTPVerify'
import TripInProgress from '@/pages/ActiveRide/TripInProgress'
import TripEnd from '@/pages/ActiveRide/TripEnd'
import ModeSelection from '@/pages/GoOnline/ModeSelection'
import StandardConfirm from '@/pages/GoOnline/StandardConfirm'
import ReturnCabSetup from '@/pages/GoOnline/ReturnCabSetup'
import PersonalDetails from '@/pages/Onboarding/PersonalDetails'
import Documents from '@/pages/Onboarding/Documents'
import VehicleRegistration from '@/pages/Onboarding/VehicleRegistration'
import VehicleDocuments from '@/pages/Onboarding/VehicleDocuments'
import ReferenceSelfie from '@/pages/Onboarding/ReferenceSelfie'
import PendingReview from '@/pages/Onboarding/PendingReview'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useRideStore } from '@/store/useRideStore'
import { useNotificationsStore } from '@/store/useNotificationsStore'
import api from '@/lib/api'
import type { DriverProfile } from '@/store/useAuthStore'
import type { NotificationItem } from '@/lib/notifications-api'
import { driverRideApi } from '@/lib/ride-api'
import { connectDriverSocket, disconnectDriverSocket, getDriverSocket } from '@/lib/socket'
import NotificationsSheet from '@/components/ui/NotificationsSheet'
import NotificationToast from '@/components/ui/NotificationToast'

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

export default function App() {
  const navigate = useNavigate()
  const { isAuthenticated, updateDriver, clearAuth } = useAuthStore()
  const { isOnline, setOnline, setOffline } = useSessionStore()
  const { incomingRequest, setIncomingRequest, clearIncomingRequest, setActiveRide, setRestoreChecked, clearRide, activeRide, updateStop } = useRideStore()
  const { fetchUnreadCount, addLive } = useNotificationsStore()
  const [accepting, setAccepting] = useState(false)
  const [rideCancelled, setRideCancelled] = useState(false)
  const [forceEndedMessage, setForceEndedMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return
    api.get<{ driver: DriverProfile }>('/api/v1/drivers/me')
      .then(res => updateDriver({
        status: res.data.driver.status,
        onboarding_step: res.data.driver.onboarding_step,
        full_name: res.data.driver.full_name,
        rating: res.data.driver.rating != null ? parseFloat(String(res.data.driver.rating)) : null,
      }))
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 401) clearAuth()
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reconcile persisted isOnline with DB reality on every auth session start.
  // Moved here from Home so it runs regardless of which page the driver lands on.
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false

    const restoreSessionOnce = async () => {
      const session = await driverRideApi.getCurrentSession()
      if (cancelled) return
      if (session && (session.status === 'online' || session.status === 'on_trip')) {
        setOnline(Number(session.id), Number(session.vehicle_id), Number(session.category_id))
        connectDriverSocket()
        if (session.status === 'on_trip') {
          const ride = await driverRideApi.getActiveRide()
          if (cancelled) return
          if (!ride) { clearRide(); setRestoreChecked(); return }
          const prev = useRideStore.getState().activeRide
          const activeRideInput: Parameters<typeof setActiveRide>[0] = {
            id: ride.id,
            status: ride.status,
            pickup: ride.origin_address ?? prev?.pickup ?? 'Pickup',
            drop: ride.destination_address ?? prev?.drop ?? (ride.ride_type === 'rental' ? 'Hourly rental' : 'Destination'),
            pickupLat: ride.origin_lat,
            pickupLng: ride.origin_lng,
            fare: ride.total_estimated != null
              ? parseFloat(ride.total_estimated)
              : (prev?.fare ?? 0),
            rideType: ride.ride_type,
          }
          if (ride.dest_lat    != null) activeRideInput.dropLat       = ride.dest_lat
          if (ride.dest_lng    != null) activeRideInput.dropLng       = ride.dest_lng
          if (ride.user_phone  != null) activeRideInput.userPhone     = ride.user_phone
          if (ride.user_name   != null) activeRideInput.userName      = ride.user_name
          if (ride.return_at   != null) activeRideInput.returnAt      = ride.return_at
          if (ride.trip_hours  != null) activeRideInput.tripHours     = ride.trip_hours
          if (ride.started_at  != null) activeRideInput.rideStartedAt = ride.started_at
          if (ride.stops.length > 0) activeRideInput.stops = ride.stops.map(s => ({
            id: s.id, sequence: s.sequence, lat: s.lat, lng: s.lng,
            address: s.address, status: s.status, reached_at: s.reached_at,
          }))
          setActiveRide(activeRideInput)
          getDriverSocket().emit('join:ride', ride.id)
          if (ride.status === 'accepted')        navigate('/ride/navigate', { replace: true })
          else if (ride.status === 'driver_arrived') navigate('/ride/otp', { replace: true })
          else if (ride.status === 'in_progress')    navigate('/ride/in-progress', { replace: true })
        }
      } else {
        setOffline()
        disconnectDriverSocket()
        clearRide()
      }
      setRestoreChecked()
    }

    // Transient failures (network blip, rate limit) get one retry before we give
    // up. On final failure we deliberately do NOT clear the ride or mark
    // restoreChecked — we couldn't confirm there's no active ride, so we'd
    // rather leave whatever persisted state is on screen than evict the driver
    // from a trip we simply failed to verify.
    const restoreSession = async (isRetry = false): Promise<void> => {
      try {
        await restoreSessionOnce()
      } catch {
        if (!isRetry && !cancelled) {
          await new Promise(r => setTimeout(r, 2000))
          if (!cancelled) await restoreSession(true)
        }
      }
    }

    void restoreSession()
    return () => { cancelled = true }
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Notifications: fetch unread badge count on session start, live socket
  // updates while the app is open (any tab, driver's private room joined
  // server-side on connect).
  useEffect(() => {
    if (!isAuthenticated) return
    void fetchUnreadCount()
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAuthenticated) return
    const socket = getDriverSocket()
    const onNotification = (item: NotificationItem) => addLive(item)
    socket.on('notification:new', onNotification)
    return () => { socket.off('notification:new', onNotification) }
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ride request listener, mounted at App level so requests arrive on any tab.
  // Moved here from Home so Profile/Earnings/Wallet pages also receive requests.
  useEffect(() => {
    if (!isOnline) return
    const socket = getDriverSocket()
    const onRideRequest = (data: {
      rideId: string; pickup: string; drop: string; distanceToPickup: number;
      estimatedFare: number; rideType: string; isReturnCab: boolean; expiresAt: string;
      timeoutSeconds: number; pickupLat?: number; pickupLng?: number;
      destinationLat?: number; destinationLng?: number; returnAt?: string; tripHours?: number;
      stopCount?: number;
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
      const incomingReq: Parameters<typeof setIncomingRequest>[0] = {
        rideId: data.rideId, pickup: data.pickup, drop: data.drop,
        pickupDistance: data.distanceToPickup / 1000, tripDistance, fare: data.estimatedFare,
        timeoutSeconds: data.timeoutSeconds, pickupLat: pLat, pickupLng: pLng,
        rideType: data.rideType,
        returnAt: data.returnAt,
        tripHours: data.tripHours,
      }
      if (data.stopCount !== undefined) incomingReq.stopCount = data.stopCount
      setIncomingRequest(incomingReq)
      // Confirm receipt so the server stops the retry loop for this driver
      socket.emit('ride:request:ack', { rideId: data.rideId })
    }
    socket.on('ride:request', onRideRequest)
    return () => { socket.off('ride:request', onRideRequest) }
  }, [isOnline, setIncomingRequest])

  // Dismiss the incoming-request card the moment the ride it's for is no
  // longer available — either another driver accepted it, or (for a ride
  // that's still broadcasting) the rider cancelled before anyone accepted.
  // Without this the card just sits until its own countdown expires.
  useEffect(() => {
    if (!isOnline) return
    const socket = getDriverSocket()
    const onRequestExpired = (data: { rideId: string }) => {
      if (useRideStore.getState().incomingRequest?.rideId === data.rideId) {
        clearIncomingRequest()
      }
    }
    socket.on('ride:request_expired', onRequestExpired)
    return () => { socket.off('ride:request_expired', onRequestExpired) }
  }, [isOnline, clearIncomingRequest])

  // Listen for user-initiated cancellation while a ride is active.
  // Scoped to activeRide.id so it attaches/detaches with the ride lifecycle.
  // Also re-joins the ride room on socket reconnect, since room membership is lost
  // on every reconnect and must be reasserted so cancellation events still arrive.
  useEffect(() => {
    if (!activeRide) return
    const socket = getDriverSocket()
    const onStatusUpdate = (data: { status: string; resolvedBy?: string }) => {
      // resolvedBy is only set by the stuck-ride sweeper/admin force-resolve,
      // normal driver-initiated completion (verifyEndOtp) never sets it, so
      // this doesn't interfere with the driver's own end-of-trip navigation.
      const isForceResolved = data.status === 'completed' && !!data.resolvedBy
      if (data.status !== 'cancelled' && !isForceResolved) return
      socket.emit('leave:ride', activeRide.id)
      clearRide()
      if (data.resolvedBy === 'timeout') {
        setForceEndedMessage('This trip was automatically ended due to inactivity')
      } else if (data.resolvedBy === 'admin') {
        setForceEndedMessage('This trip was ended by support')
      } else {
        setRideCancelled(true)
      }
      navigate('/', { replace: true })
    }
    const onConnect = () => { socket.emit('join:ride', activeRide.id) }
    const onStopUpdated = (data: { sequence: number; status: 'reached' | 'skipped'; reachedAt: string | null }) => {
      updateStop(data.sequence, data.status, data.reachedAt)
    }
    socket.on('ride:status_update', onStatusUpdate)
    socket.on('connect', onConnect)
    socket.on('stop:updated', onStopUpdated)
    // Session-restore path: socket may already be connected before this effect
    // mounts, so the 'connect' event never fires. Emit join:ride immediately.
    if (socket.connected) socket.emit('join:ride', activeRide.id)
    return () => {
      socket.off('ride:status_update', onStatusUpdate)
      socket.off('connect', onConnect)
      socket.off('stop:updated', onStopUpdated)
    }
  }, [activeRide?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rideCancelled) return
    const t = setTimeout(() => setRideCancelled(false), 3000)
    return () => clearTimeout(t)
  }, [rideCancelled])

  useEffect(() => {
    if (!forceEndedMessage) return
    const t = setTimeout(() => setForceEndedMessage(null), 3000)
    return () => clearTimeout(t)
  }, [forceEndedMessage])

  const handleAcceptRide = async (rideId: string, rideType: string) => {
    if (accepting) return
    setAccepting(true)
    try {
      await driverRideApi.acceptRide(rideId)
      const ride = await driverRideApi.getRide(rideId)
      const req = incomingRequest  // capture before clearIncomingRequest clears it
      const activeRideInput: Parameters<typeof setActiveRide>[0] = {
        id: rideId, status: 'accepted',
        pickup: ride.origin_address ?? req?.pickup ?? 'Pickup',
        drop: ride.destination_address ?? req?.drop ?? (rideType === 'rental' ? 'Hourly rental' : 'Destination'),
        pickupLat: ride.origin_lat, pickupLng: ride.origin_lng,
        fare: ride.total_estimated != null ? parseFloat(ride.total_estimated) : (req?.fare ?? 0),
        rideType,
      }
      if (ride.dest_lat   != null) activeRideInput.dropLat   = ride.dest_lat
      if (ride.dest_lng   != null) activeRideInput.dropLng   = ride.dest_lng
      if (ride.user_phone != null) activeRideInput.userPhone = ride.user_phone
      if (ride.user_name  != null) activeRideInput.userName  = ride.user_name
      if (ride.return_at  != null) activeRideInput.returnAt  = ride.return_at
      if (ride.trip_hours != null) activeRideInput.tripHours = ride.trip_hours
      if (ride.stops.length > 0) activeRideInput.stops = ride.stops.map(s => ({
        id: s.id, sequence: s.sequence, lat: s.lat, lng: s.lng,
        address: s.address, status: s.status, reached_at: s.reached_at,
      }))
      setActiveRide(activeRideInput)
      getDriverSocket().emit('join:ride', rideId)
      clearIncomingRequest()
      setAccepting(false)
      navigate('/ride/navigate')
    } catch {
      setAccepting(false)
      clearIncomingRequest()
    }
  }

  return (
    <>
      <Routes>
            {/* Auth */}
            <Route path="/login" element={<Login />} />

            {/* Main tabs, approved drivers only */}
            <Route path="/" element={
              <ProtectedRoute requireApproved><Home /></ProtectedRoute>
            } />
            <Route path="/earnings" element={
              <ProtectedRoute requireApproved>
                <Earnings />
              </ProtectedRoute>
            } />
            <Route path="/wallet" element={
              <ProtectedRoute requireApproved>
                <Wallet />
              </ProtectedRoute>
            } />
            <Route path="/profile" element={
              <ProtectedRoute requireApproved><Profile /></ProtectedRoute>
            } />

            {/* Go online flow */}
            <Route path="/go-online/mode" element={
              <ProtectedRoute requireApproved><ModeSelection /></ProtectedRoute>
            } />
            <Route path="/go-online/standard" element={
              <ProtectedRoute requireApproved><StandardConfirm /></ProtectedRoute>
            } />
            <Route path="/go-online/return-cab" element={
              <ProtectedRoute requireApproved><ReturnCabSetup /></ProtectedRoute>
            } />

            {/* Active ride flow */}
            <Route path="/ride/incoming" element={
              <ProtectedRoute requireApproved><IncomingRequest /></ProtectedRoute>
            } />
            <Route path="/ride/navigate" element={
              <ProtectedRoute requireApproved>
                <NavigateToPickup />
              </ProtectedRoute>
            } />
            <Route path="/ride/otp" element={
              <ProtectedRoute requireApproved>
                <OTPVerify />
              </ProtectedRoute>
            } />
            <Route path="/ride/in-progress" element={
              <ProtectedRoute requireApproved>
                <TripInProgress />
              </ProtectedRoute>
            } />
            <Route path="/ride/end" element={
              <ProtectedRoute requireApproved>
                <TripEnd />
              </ProtectedRoute>
            } />

            {/* Onboarding */}
            <Route path="/onboarding/personal"      element={<ProtectedRoute><PersonalDetails /></ProtectedRoute>} />
            <Route path="/onboarding/documents"     element={<ProtectedRoute><Documents /></ProtectedRoute>} />
            <Route path="/onboarding/vehicle"       element={<ProtectedRoute><VehicleRegistration /></ProtectedRoute>} />
            <Route path="/onboarding/vehicle-docs"  element={<ProtectedRoute><VehicleDocuments /></ProtectedRoute>} />
            <Route path="/onboarding/selfie"        element={<ProtectedRoute><ReferenceSelfie /></ProtectedRoute>} />
            <Route path="/onboarding/pending-review" element={<ProtectedRoute><PendingReview /></ProtectedRoute>} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Global ride request overlay, persists across all tabs, not just Home */}
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
            rideType={incomingRequest.rideType}
            tripHours={incomingRequest.tripHours}
            returnAt={incomingRequest.returnAt}
            stopCount={incomingRequest.stopCount}
            isAccepting={accepting}
            onAccept={() => void handleAcceptRide(incomingRequest.rideId, incomingRequest.rideType)}
            onDecline={clearIncomingRequest}
          />
        )}
      </AnimatePresence>

      {/* Cancellation banner: shown when user cancels an active ride */}
      {rideCancelled && (
        <div
          className="fixed top-4 left-4 right-4 z-50 rounded-2xl px-4 py-3 text-sm font-semibold text-white text-center"
          style={{ background: '#DC2626', boxShadow: '0 4px 16px rgba(220,38,38,0.35)' }}
        >
          Ride cancelled by the passenger
        </div>
      )}

      {/* Force-resolved banner: shown when the stuck-ride sweeper or an admin ends a trip */}
      {forceEndedMessage && (
        <div
          className="fixed top-4 left-4 right-4 z-50 rounded-2xl px-4 py-3 text-sm font-semibold text-white text-center"
          style={{ background: '#DC2626', boxShadow: '0 4px 16px rgba(220,38,38,0.35)' }}
        >
          {forceEndedMessage}
        </div>
      )}

      {/* Persistent tab bar: renders null on non-main routes */}
      <BottomNav />

      <NotificationsSheet />
      <NotificationToast />
    </>
  )
}
