import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { APIProvider } from '@vis.gl/react-google-maps'
import ProtectedRoute from '@/components/ProtectedRoute'
import BottomNav from '@/components/ui/BottomNav'
import TripRequestCard from '@/components/ui/TripRequestCard'
import Login from '@/pages/Login'
import Home from '@/pages/Home'
import Earnings from '@/pages/Earnings'
import Wallet from '@/pages/Wallet'
import RechargePackage from '@/pages/RechargePackage'
import Profile from '@/pages/Profile'
import NavigateToPickup from '@/pages/ActiveRide/NavigateToPickup'
import OTPVerify from '@/pages/ActiveRide/OTPVerify'
import TripInProgress from '@/pages/ActiveRide/TripInProgress'
import RideChat from '@/pages/ActiveRide/RideChat'
import TripEnd from '@/pages/ActiveRide/TripEnd'
import CollectCash from '@/pages/ActiveRide/CollectCash'
import ModeSelection from '@/pages/GoOnline/ModeSelection'
import StandardConfirm from '@/pages/GoOnline/StandardConfirm'
import ReturnCabSetup from '@/pages/GoOnline/ReturnCabSetup'
import DailyVerification from '@/pages/DailyVerification'
import PersonalDetails from '@/pages/Onboarding/PersonalDetails'
import Documents from '@/pages/Onboarding/Documents'
import VehicleRegistration from '@/pages/Onboarding/VehicleRegistration'
import VehicleDocuments from '@/pages/Onboarding/VehicleDocuments'
import ReferenceSelfie from '@/pages/Onboarding/ReferenceSelfie'
import PendingReview from '@/pages/Onboarding/PendingReview'
import VehicleDetails from '@/pages/Settings/VehicleDetails'
import DriverDocuments from '@/pages/Settings/DriverDocuments'
import PersonalInfo from '@/pages/Settings/PersonalInfo'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { useRideStore } from '@/store/useRideStore'
import type { RideStop } from '@/store/useRideStore'
import { useNotificationsStore } from '@/store/useNotificationsStore'
import api from '@/lib/api'
import type { DriverProfile } from '@/store/useAuthStore'
import type { NotificationItem } from '@/lib/notifications-api'
import { driverRideApi } from '@/lib/ride-api'
import { playRideSound, stopRideSound, unlockRideSound } from '@/lib/rideSound'
import { connectDriverSocket, disconnectDriverSocket, getDriverSocket } from '@/lib/socket'
import NotificationsSheet from '@/components/ui/NotificationsSheet'
import NotificationToast from '@/components/ui/NotificationToast'

const DEFAULT_LAT = 20.2961
const DEFAULT_LNG = 85.8245

// Only Home/NavigateToPickup/TripInProgress render a Google map — scope the
// Maps SDK load (1.6MB+ of JS/WASM) to those routes instead of the whole app.
function MapProviderLayout() {
  return (
    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_KEY} libraries={['places']}>
      <Outlet />
    </APIProvider>
  )
}

export default function App() {
  const navigate = useNavigate()
  const { isAuthenticated, updateDriver, clearAuth } = useAuthStore()
  const { isOnline, setOnline, setOffline } = useSessionStore()
  const { incomingRequest, setIncomingRequest, clearIncomingRequest, setActiveRide, setRestoreChecked, clearRide, activeRide, updateStop, addStop, setUnreadChatCount, incrementUnreadChatCount } = useRideStore()
  const { fetchUnreadCount, addLive } = useNotificationsStore()
  const [accepting, setAccepting] = useState(false)
  const [acceptedBeat, setAcceptedBeat] = useState(false)
  const [acceptFailed, setAcceptFailed] = useState(false)
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

  // Unlock ringtone playback on the very first tap anywhere in the app, not
  // just the Go Online buttons - covers session-restore-while-online and
  // auto-re-online-after-trip paths, which reach an online state without
  // ever going through the Go Online tap that normally does this.
  useEffect(() => {
    const unlock = () => {
      unlockRideSound()
      document.removeEventListener('pointerdown', unlock)
    }
    document.addEventListener('pointerdown', unlock)
    return () => document.removeEventListener('pointerdown', unlock)
  }, [])

  // Reconcile persisted isOnline with DB reality on every auth session start.
  // Moved here from Home so it runs regardless of which page the driver lands on.
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false

    const restoreSessionOnce = async () => {
      const session = await driverRideApi.getCurrentSession()
      if (cancelled) return

      // An active ride is checked unconditionally, not only when the session
      // status happens to already read 'on_trip'. driver_sessions.status can
      // drift to 'offline' after a disconnect-grace timeout that outlasts a
      // brief reconnect gap (closing/reopening the browser) while the ride
      // itself is still legitimately in progress — the ride row is server
      // truth here, the session flag is not (see
      // docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 3b). Silently trusting a
      // stale 'offline' session previously dropped the ride from the driver's
      // screen while the rider's app kept waiting on it indefinitely.
      const ride = session ? await driverRideApi.getActiveRide() : null
      if (cancelled) return

      if (session && ride) {
        setOnline(Number(session.id), Number(session.vehicle_id), Number(session.category_id))
        connectDriverSocket()
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
        // Booked-for-someone-else rides route the driver to the actual rider, not the account holder
        if (ride.rider_phone ?? ride.user_phone) activeRideInput.userPhone = (ride.rider_phone ?? ride.user_phone)!
        if (ride.rider_name  ?? ride.user_name)  activeRideInput.userName  = (ride.rider_name  ?? ride.user_name)!
        if (ride.user_rating != null) activeRideInput.userRating    = parseFloat(ride.user_rating)
        if (ride.return_at   != null) activeRideInput.returnAt      = ride.return_at
        if (ride.trip_hours  != null) activeRideInput.tripHours     = ride.trip_hours
        if (ride.started_at  != null) activeRideInput.rideStartedAt = ride.started_at
        if (ride.stops.length > 0) activeRideInput.stops = ride.stops.map(s => ({
          id: s.id, sequence: s.sequence, lat: s.lat, lng: s.lng,
          address: s.address, status: s.status, arrived_at: s.arrived_at, reached_at: s.reached_at,
          stop_charge_applied: s.stop_charge_applied, wait_charge: s.wait_charge,
        }))
        activeRideInput.paymentChannel = ride.payment_channel
        setActiveRide(activeRideInput)
        getDriverSocket().emit('join:ride', ride.id)
        if (ride.status === 'accepted')        navigate('/ride/navigate', { replace: true })
        else if (ride.status === 'driver_arrived') navigate('/ride/otp', { replace: true })
        else if (ride.status === 'in_progress')    navigate('/ride/in-progress', { replace: true })
      } else if (session && session.status === 'online') {
        setOnline(Number(session.id), Number(session.vehicle_id), Number(session.category_id))
        connectDriverSocket()
        clearRide()
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

  // The socket is a module-level singleton reused across logins on the same
  // device — without this, a de-authed socket stays connected and joined to
  // the previous driver's private room, so the next driver to log in on this
  // device receives the previous driver's live notifications instead of
  // their own.
  useEffect(() => {
    if (!isAuthenticated) disconnectDriverSocket()
  }, [isAuthenticated])

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
      stopCount?: number; rideCategoryName?: string;
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
      if (data.rideCategoryName !== undefined) incomingReq.rideCategoryName = data.rideCategoryName
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

  // Ringtone follows incomingRequest as the single source of truth: it starts
  // the instant a request is set and stops on every path that clears it
  // (accept, decline, expire, server-side expiry) without duplicating the
  // stop call at each of those call sites.
  useEffect(() => {
    if (incomingRequest) playRideSound()
    else stopRideSound()
  }, [incomingRequest])

  // Best-effort: keep the screen from sleeping while online, since a sleeping
  // screen is the one case where a backgrounded tab's audio can actually get
  // suspended by the OS. Silently no-ops on browsers without the API
  // (cast to unknown avoids depending on lib.dom's WakeLock typings being
  // present in every TS target this repo might build with).
  useEffect(() => {
    if (!isOnline) return
    const nav = navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }
    let cancelled = false
    let sentinel: { release: () => Promise<void> } | null = null
    nav.wakeLock?.request('screen').then(s => {
      if (cancelled) { s.release().catch(() => {}); return }
      sentinel = s
    }).catch(() => {})
    return () => { cancelled = true; sentinel?.release().catch(() => {}) }
  }, [isOnline])

  // Idle-driver availability follows tab visibility: pause matching the instant
  // the tab backgrounds (screen lock, app switch — the driver app is a browser
  // tab with no background-GPS capability, so this is the primary signal, not
  // just a nicety), resume the instant it's visible again. Silent both ways —
  // no toast, no navigation. Only applies while online with no active ride;
  // mid-trip visibility changes (screen off while driving) are left alone —
  // that's governed entirely by the server-side ride sweep, not this.
  useEffect(() => {
    if (!isOnline || activeRide) return
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        driverRideApi.pause().catch(() => {})
      } else {
        driverRideApi.resume().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [isOnline, activeRide])

  // Tab close / navigate away while idle-online: best-effort pause via
  // sendBeacon, the one API that reliably fires during unload where fetch is
  // not guaranteed to. No body needed — the endpoint reads driverId from the
  // auth cookie/header already attached by the browser for same-origin requests.
  useEffect(() => {
    if (!isOnline || activeRide) return
    const onPageHide = () => {
      navigator.sendBeacon('/api/v1/rides/sessions/pause')
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [isOnline, activeRide])

  // Listen for user-initiated cancellation while a ride is active.
  // Scoped to activeRide.id so it attaches/detaches with the ride lifecycle.
  // Also re-joins the ride room on socket reconnect, since room membership is lost
  // on every reconnect and must be reasserted so cancellation events still arrive.
  useEffect(() => {
    if (!activeRide) return
    const socket = getDriverSocket()
    // Shared by the live socket event AND the reconnect resync below — a ride
    // resolved server-side while this driver's socket was disconnected (e.g.
    // the same network gap that caused a stale-GPS auto-cancel) never fires
    // the live event, since Socket.io doesn't replay missed events on
    // reconnect. Without this being called from both places, the driver's
    // screen would stay stuck showing the trip as active forever.
    const resolveRideExternally = (status: string, resolvedBy?: string) => {
      const isForceResolved = status === 'completed' && !!resolvedBy
      if (status !== 'cancelled' && !isForceResolved) return
      socket.emit('leave:ride', activeRide.id)
      clearRide()
      if (resolvedBy === 'timeout') {
        setForceEndedMessage('This trip was automatically ended due to inactivity')
      } else if (resolvedBy === 'admin') {
        setForceEndedMessage('This trip was ended by support')
      } else {
        setRideCancelled(true)
      }
      navigate('/', { replace: true })
    }
    const onStatusUpdate = (data: { status: string; resolvedBy?: string }) => {
      // resolvedBy is only set by the stuck-ride sweeper/admin force-resolve,
      // normal driver-initiated completion (verifyEndOtp) never sets it, so
      // this doesn't interfere with the driver's own end-of-trip navigation.
      resolveRideExternally(data.status, data.resolvedBy)
    }
    // Re-checks truth from the server on every (re)connect instead of trusting
    // only the live push event — closes the gap above. RideDetail doesn't
    // expose resolvedBy, so this only recognizes plain 'cancelled'; that's
    // the scenario the stale-GPS sweeper actually produces.
    const resyncRideStatus = async () => {
      try {
        const ride = await driverRideApi.getRide(activeRide.id)
        resolveRideExternally(ride.status)
      } catch { /* transient — next reconnect or live event will catch it */ }
    }
    const onConnect = () => {
      socket.emit('join:ride', activeRide.id)
      void resyncRideStatus()
    }
    const onStopUpdated = (data: { sequence: number; status: 'reached' | 'skipped'; reachedAt: string | null }) => {
      updateStop(data.sequence, data.status, data.reachedAt)
    }
    const onStopAdded = (data: { stop: RideStop }) => {
      addStop({ ...data.stop, id: String(data.stop.id) })
    }
    const onChatMessage = (data: { senderType: 'user' | 'driver' }) => {
      if (data.senderType === 'user') incrementUnreadChatCount()
    }
    socket.on('ride:status_update', onStatusUpdate)
    socket.on('connect', onConnect)
    socket.on('stop:updated', onStopUpdated)
    socket.on('stop:added', onStopAdded)
    socket.on('chat:message', onChatMessage)
    void driverRideApi.getUnreadChatCount(activeRide.id).then(setUnreadChatCount).catch(() => {})
    // Session-restore path: socket may already be connected before this effect
    // mounts, so the 'connect' event never fires. Emit join:ride immediately.
    if (socket.connected) {
      socket.emit('join:ride', activeRide.id)
      void resyncRideStatus()
    }
    return () => {
      socket.off('ride:status_update', onStatusUpdate)
      socket.off('connect', onConnect)
      socket.off('stop:updated', onStopUpdated)
      socket.off('stop:added', onStopAdded)
      socket.off('chat:message', onChatMessage)
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
    setAcceptFailed(false)
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
      if (ride.rider_phone ?? ride.user_phone) activeRideInput.userPhone = (ride.rider_phone ?? ride.user_phone)!
      if (ride.rider_name  ?? ride.user_name)  activeRideInput.userName  = (ride.rider_name  ?? ride.user_name)!
      if (ride.user_rating != null) activeRideInput.userRating = parseFloat(ride.user_rating)
      if (ride.return_at  != null) activeRideInput.returnAt  = ride.return_at
      if (ride.trip_hours != null) activeRideInput.tripHours = ride.trip_hours
      if (ride.stops.length > 0) activeRideInput.stops = ride.stops.map(s => ({
        id: s.id, sequence: s.sequence, lat: s.lat, lng: s.lng,
        address: s.address, status: s.status, arrived_at: s.arrived_at, reached_at: s.reached_at,
        stop_charge_applied: s.stop_charge_applied, wait_charge: s.wait_charge,
      }))
      activeRideInput.paymentChannel = ride.payment_channel
      setActiveRide(activeRideInput)
      getDriverSocket().emit('join:ride', rideId)
      setAccepting(false)
      // Confirmation beat before navigating away — see TripRequestCard's
      // `accepted` prop. Short and fixed: never block on it if slow, this is
      // purely the post-success flourish, not a wait for anything.
      setAcceptedBeat(true)
      setTimeout(() => {
        setAcceptedBeat(false)
        clearIncomingRequest()
        navigate('/ride/navigate')
      }, 260)
    } catch {
      setAccepting(false)
      setAcceptFailed(true)
      setTimeout(() => {
        setAcceptFailed(false)
        clearIncomingRequest()
      }, 1400)
    }
  }

  return (
    <>
      <Routes>
            {/* Auth */}
            <Route path="/login" element={<Login />} />

            {/* Main tabs, approved drivers only */}
            <Route element={<MapProviderLayout />}>
              <Route path="/" element={
                <ProtectedRoute requireApproved><Home /></ProtectedRoute>
              } />
              <Route path="/ride/navigate" element={
                <ProtectedRoute requireApproved>
                  <NavigateToPickup />
                </ProtectedRoute>
              } />
              <Route path="/ride/in-progress" element={
                <ProtectedRoute requireApproved>
                  <TripInProgress />
                </ProtectedRoute>
              } />
            </Route>

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
            <Route path="/recharge-package" element={
              <ProtectedRoute requireApproved>
                <RechargePackage />
              </ProtectedRoute>
            } />
            <Route path="/profile" element={
              <ProtectedRoute requireApproved><Profile /></ProtectedRoute>
            } />
            <Route path="/profile/vehicle" element={
              <ProtectedRoute requireApproved><VehicleDetails /></ProtectedRoute>
            } />
            <Route path="/profile/documents" element={
              <ProtectedRoute requireApproved><DriverDocuments /></ProtectedRoute>
            } />
            <Route path="/profile/personal" element={
              <ProtectedRoute requireApproved><PersonalInfo /></ProtectedRoute>
            } />

            <Route path="/daily-verification" element={
              <ProtectedRoute requireApproved><DailyVerification /></ProtectedRoute>
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
            <Route path="/ride/otp" element={
              <ProtectedRoute requireApproved>
                <OTPVerify />
              </ProtectedRoute>
            } />
            <Route path="/ride/chat" element={
              <ProtectedRoute requireApproved>
                <RideChat />
              </ProtectedRoute>
            } />
            <Route path="/ride/end" element={
              <ProtectedRoute requireApproved>
                <TripEnd />
              </ProtectedRoute>
            } />
            <Route path="/ride/collect-cash" element={
              <ProtectedRoute requireApproved>
                <CollectCash />
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

      {/* Global ride request overlay, persists across all tabs, not just Home.
          TripRequestCard embeds a map preview, so it needs its own APIProvider —
          MapProviderLayout only wraps Home/NavigateToPickup/TripInProgress, but
          a request can arrive while the driver is on any route (Wallet, Profile,
          go-online screens, ...). */}
      <AnimatePresence>
        {incomingRequest && (
          <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_KEY} libraries={['places']}>
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
              rideCategoryName={incomingRequest.rideCategoryName}
              pickupLat={incomingRequest.pickupLat}
              pickupLng={incomingRequest.pickupLng}
              isAccepting={accepting}
              accepted={acceptedBeat}
              failed={acceptFailed}
              onAccept={() => void handleAcceptRide(incomingRequest.rideId, incomingRequest.rideType)}
              onDecline={clearIncomingRequest}
            />
          </APIProvider>
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
