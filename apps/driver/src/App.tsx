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
import api from '@/lib/api'
import type { DriverProfile } from '@/store/useAuthStore'
import { driverRideApi } from '@/lib/ride-api'
import { connectDriverSocket, disconnectDriverSocket, getDriverSocket } from '@/lib/socket'

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

export default function App() {
  const navigate = useNavigate()
  const { isAuthenticated, updateDriver, clearAuth } = useAuthStore()
  const { isOnline, setOnline, setOffline } = useSessionStore()
  const { incomingRequest, setIncomingRequest, clearIncomingRequest, setActiveRide, clearRide, activeRide } = useRideStore()
  const [accepting, setAccepting] = useState(false)
  const [rideCancelled, setRideCancelled] = useState(false)

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
    driverRideApi.getCurrentSession()
      .then(async session => {
        if (session && (session.status === 'online' || session.status === 'on_trip')) {
          setOnline(Number(session.id), Number(session.vehicle_id), Number(session.category_id))
          connectDriverSocket()
          if (session.status === 'on_trip') {
            const ride = await driverRideApi.getActiveRide()
            if (!ride) { clearRide(); return }
            const activeRideInput: Parameters<typeof setActiveRide>[0] = {
              id: ride.id,
              status: ride.status,
              pickup: ride.origin_address ?? 'Pickup',
              drop: ride.destination_address ?? (ride.ride_type === 'rental' ? 'Hourly rental' : 'Destination'),
              pickupLat: ride.origin_lat,
              pickupLng: ride.origin_lng,
              fare: ride.total_estimated != null ? parseFloat(ride.total_estimated) : 0,
              rideType: ride.ride_type,
            }
            if (ride.dest_lat    != null) activeRideInput.dropLat       = ride.dest_lat
            if (ride.dest_lng    != null) activeRideInput.dropLng       = ride.dest_lng
            if (ride.user_phone  != null) activeRideInput.userPhone     = ride.user_phone
            if (ride.user_name   != null) activeRideInput.userName      = ride.user_name
            if (ride.return_at   != null) activeRideInput.returnAt      = ride.return_at
            if (ride.trip_hours  != null) activeRideInput.tripHours     = ride.trip_hours
            if (ride.started_at  != null) activeRideInput.rideStartedAt = ride.started_at
            setActiveRide(activeRideInput)
            getDriverSocket().emit('join:ride', ride.id)
            if (ride.status === 'accepted')        navigate('/ride/navigate')
            else if (ride.status === 'driver_arrived') navigate('/ride/otp')
            else if (ride.status === 'in_progress')    navigate('/ride/in-progress')
          }
        } else {
          setOffline()
          disconnectDriverSocket()
          clearRide()
        }
      })
      .catch(() => {})
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ride request listener — mounted at App level so requests arrive on any tab.
  // Moved here from Home so Profile/Earnings/Wallet pages also receive requests.
  useEffect(() => {
    if (!isOnline) return
    const socket = getDriverSocket()
    const onRideRequest = (data: {
      rideId: string; pickup: string; drop: string; distanceToPickup: number;
      estimatedFare: number; rideType: string; isReturnCab: boolean; expiresAt: string;
      timeoutSeconds: number; pickupLat?: number; pickupLng?: number;
      destinationLat?: number; destinationLng?: number; returnAt?: string; tripHours?: number;
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
        rideType: data.rideType,
        returnAt: data.returnAt,
        tripHours: data.tripHours,
      })
      // Confirm receipt so the server stops the retry loop for this driver
      socket.emit('ride:request:ack', { rideId: data.rideId })
    }
    socket.on('ride:request', onRideRequest)
    return () => { socket.off('ride:request', onRideRequest) }
  }, [isOnline, setIncomingRequest])

  // Listen for user-initiated cancellation while a ride is active.
  // Scoped to activeRide.id so it attaches/detaches with the ride lifecycle.
  useEffect(() => {
    if (!activeRide) return
    const socket = getDriverSocket()
    const onStatusUpdate = (data: { status: string }) => {
      if (data.status !== 'cancelled') return
      socket.emit('leave:ride', activeRide.id)
      clearRide()
      setRideCancelled(true)
      navigate('/')
    }
    socket.on('ride:status_update', onStatusUpdate)
    return () => { socket.off('ride:status_update', onStatusUpdate) }
  }, [activeRide?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rideCancelled) return
    const t = setTimeout(() => setRideCancelled(false), 3000)
    return () => clearTimeout(t)
  }, [rideCancelled])

  const handleAcceptRide = async (rideId: string, rideType: string) => {
    if (accepting) return
    setAccepting(true)
    try {
      await driverRideApi.acceptRide(rideId)
      const ride = await driverRideApi.getRide(rideId)
      const activeRideInput: Parameters<typeof setActiveRide>[0] = {
        id: rideId, status: 'accepted',
        pickup: ride.origin_address ?? 'Pickup',
        drop: ride.destination_address ?? (rideType === 'rental' ? 'Hourly rental' : 'Destination'),
        pickupLat: ride.origin_lat, pickupLng: ride.origin_lng,
        fare: ride.total_estimated != null ? parseFloat(ride.total_estimated) : 0,
        rideType,
      }
      if (ride.dest_lat   != null) activeRideInput.dropLat   = ride.dest_lat
      if (ride.dest_lng   != null) activeRideInput.dropLng   = ride.dest_lng
      if (ride.user_phone != null) activeRideInput.userPhone = ride.user_phone
      if (ride.user_name  != null) activeRideInput.userName  = ride.user_name
      if (ride.return_at  != null) activeRideInput.returnAt  = ride.return_at
      if (ride.trip_hours != null) activeRideInput.tripHours = ride.trip_hours
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

            {/* Main tabs — approved drivers only */}
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

      {/* Global ride request overlay — persists across all tabs, not just Home */}
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
            isAccepting={accepting}
            onAccept={() => void handleAcceptRide(incomingRequest.rideId, incomingRequest.rideType)}
            onDecline={clearIncomingRequest}
          />
        )}
      </AnimatePresence>

      {/* Cancellation banner — shown when user cancels an active ride */}
      {rideCancelled && (
        <div
          className="fixed top-4 left-4 right-4 z-50 rounded-2xl px-4 py-3 text-sm font-semibold text-white text-center"
          style={{ background: '#DC2626', boxShadow: '0 4px 16px rgba(220,38,38,0.35)' }}
        >
          Ride cancelled by the passenger
        </div>
      )}

      {/* Persistent tab bar — renders null on non-main routes */}
      <BottomNav />
    </>
  )
}
