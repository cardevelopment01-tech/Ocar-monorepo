import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { useRoomJoin } from '@ocar/mobile-shared'
import { socket } from '@/services/socket'
import { fetchRide, fetchRouteLeg, fetchUnreadChatCount } from './api'
import type { DriverCancelInfo, RideDetailExtra } from './types'

type DriverLocationTick = { lat: number; lng: number; heading?: number; speed_kmph?: number }
type StatusUpdatePayload = {
  status?: string; cancelledBy?: string; reasonCode?: string | null
  fareDrift?: { previousFare: number; currentFare: number }
  finalFare?: number
}
type DriverAssignedPayload = {
  bookedCategoryName?: string | null
  assignedCategoryName?: string | null
}
type StopUpdatedPayload = { sequence: number; status: 'reached' | 'skipped'; reachedAt: string | null }
type StopAddedPayload = { stop: RideDetailExtra['stops'][number] }
type ChatMessagePayload = { senderType: 'user' | 'driver' }

type RouteMode = 'pickup-dest' | 'driver-pickup' | 'driver-dest' | 'returning' | 'recap'

function routeModeFor(status: string): RouteMode {
  if (status === 'accepted' || status === 'driver_arrived') return 'driver-pickup'
  if (status === 'returning') return 'returning'
  if (status === 'in_progress') return 'driver-dest'
  if (status === 'completed' || status === 'cancelled') return 'recap'
  return 'pickup-dest'
}

export function useRideTracking(rideId: string) {
  const [ride, setRide] = useState<RideDetailExtra | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [socketConnected, setSocketConnected] = useState(socket.connected)
  const [driverCancelled, setDriverCancelled] = useState<DriverCancelInfo | null>(null)
  const [lastLocationAt, setLastLocationAt] = useState<number | null>(null)
  const [driverPos, setDriverPos] = useState<[number, number] | null>(null)
  const [routePoints, setRoutePoints] = useState<[number, number][]>([])
  const [eta, setEta] = useState<{ etaMin: number; distanceKm: number } | null>(null)
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [fareDrift, setFareDrift] = useState<{ previousFare: number; currentFare: number } | null>(null)
  const [upgradeCategory, setUpgradeCategory] = useState<string | null>(null)

  // Ref-driven shared values -- the driver dot's UI-thread animation (see
  // components that consume these directly) never triggers a re-render even
  // though `driverPos` state (for the real map, which must re-render) does.
  const markerLat = useSharedValue(0)
  const markerLng = useSharedValue(0)
  const markerHeading = useSharedValue(0)
  const hasMarkerFix = useRef(false)
  const routeFetchSeq = useRef(0)
  const lastRouteFetch = useRef<{ mode: RouteMode; at: number } | null>(null)

  const loadRide = useCallback(async () => {
    try {
      const detail = await fetchRide(rideId)
      setRide(detail)
      setLoadError(false)
      const fallbackLat = detail.driverCurrentLat ?? detail.originLat
      const fallbackLng = detail.driverCurrentLng ?? detail.originLng
      if (!hasMarkerFix.current && fallbackLat != null && fallbackLng != null) {
        markerLat.value = fallbackLat
        markerLng.value = fallbackLng
        setDriverPos([fallbackLat, fallbackLng])
      }
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [rideId, markerLat, markerLng])

  useEffect(() => {
    setLoading(true)
    loadRide()
  }, [loadRide])

  useEffect(() => {
    fetchUnreadChatCount(rideId).then(setUnreadChatCount).catch(() => {})
  }, [rideId])

  useRoomJoin(socket, rideId, loadRide)

  useEffect(() => {
    function onStatusUpdate(payload: StatusUpdatePayload) {
      if (payload.status === 'cancelled' && payload.cancelledBy === 'driver') {
        setDriverCancelled({ reasonCode: payload.reasonCode ?? null })
      }
      if (payload.fareDrift) {
        setFareDrift(payload.fareDrift)
        setRide((prev) => (prev ? { ...prev, totalEstimated: String(payload.fareDrift!.currentFare) } : prev))
      }
      if (typeof payload.finalFare === 'number') {
        setRide((prev) => (prev ? { ...prev, totalFinal: String(payload.finalFare) } : prev))
      }
      loadRide()
    }

    function onDriverLocation(payload: DriverLocationTick) {
      hasMarkerFix.current = true
      markerLat.value = payload.lat
      markerLng.value = payload.lng
      markerHeading.value = payload.heading ?? 0
      setDriverPos([payload.lat, payload.lng])
      setLastLocationAt(Date.now())
    }

    function onDriverAssigned(payload: DriverAssignedPayload) {
      if (payload.bookedCategoryName && payload.assignedCategoryName && payload.bookedCategoryName !== payload.assignedCategoryName) {
        setUpgradeCategory(payload.assignedCategoryName)
        setTimeout(() => setUpgradeCategory(null), 4000)
      }
      loadRide()
    }

    function onStopUpdated(payload: StopUpdatedPayload) {
      setRide((prev) =>
        prev
          ? { ...prev, stops: prev.stops.map((s) => (s.sequence === payload.sequence ? { ...s, status: payload.status, reachedAt: payload.reachedAt } : s)) }
          : prev
      )
    }

    function onStopAdded(payload: StopAddedPayload) {
      setRide((prev) => (prev && !prev.stops.some((s) => s.sequence === payload.stop.sequence) ? { ...prev, stops: [...prev.stops, payload.stop] } : prev))
    }

    function onChatMessage(payload: ChatMessagePayload) {
      if (payload.senderType === 'driver') setUnreadChatCount((c) => c + 1)
    }

    function onConnect() { setSocketConnected(true) }
    function onDisconnect() { setSocketConnected(false) }

    socket.on('ride:status_update', onStatusUpdate)
    socket.on('driver:location', onDriverLocation)
    socket.on('ride:driver_assigned', onDriverAssigned)
    socket.on('stop:updated', onStopUpdated)
    socket.on('stop:added', onStopAdded)
    socket.on('chat:message', onChatMessage)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    setSocketConnected(socket.connected)

    return () => {
      socket.off('ride:status_update', onStatusUpdate)
      socket.off('driver:location', onDriverLocation)
      socket.off('ride:driver_assigned', onDriverAssigned)
      socket.off('stop:updated', onStopUpdated)
      socket.off('stop:added', onStopAdded)
      socket.off('chat:message', onChatMessage)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [loadRide, markerLat, markerLng, markerHeading])

  // Route + live ETA -- same leg selection as the web tracking page's effect,
  // scoped down (no waypoint detour legs; add-stop still bends the *booking*
  // route on web, but the live-trip route line here stays origin->dest for
  // simplicity, matching the agreed core-parity scope for the map itself).
  const routeMode = ride ? routeModeFor(ride.status) : 'pickup-dest'
  const hasDest = ride?.destLat != null && ride?.destLng != null

  useEffect(() => {
    if (!ride) return
    const pickup: [number, number] = [ride.originLat, ride.originLng]
    const drop: [number, number] | null = hasDest ? [ride.destLat!, ride.destLng!] : null

    let origin: [number, number] | undefined
    let dest: [number, number] | undefined
    if (routeMode === 'driver-pickup' || routeMode === 'returning') {
      if (!driverPos) return
      origin = driverPos
      dest = pickup
    } else if (routeMode === 'driver-dest') {
      if (!driverPos || !drop) return
      origin = driverPos
      dest = drop
    } else if (routeMode === 'pickup-dest') {
      if (!drop) return
      origin = pickup
      dest = drop
    } else {
      setRoutePoints([])
      setEta(null)
      return
    }

    const prev = lastRouteFetch.current
    const modeChanged = !prev || prev.mode !== routeMode
    const stale = prev ? Date.now() - prev.at > 20_000 : true
    if (!modeChanged && !stale) return

    const seq = ++routeFetchSeq.current
    lastRouteFetch.current = { mode: routeMode, at: Date.now() }
    const wantsEta = routeMode === 'driver-pickup' || routeMode === 'driver-dest' || routeMode === 'returning'

    fetchRouteLeg(origin[0], origin[1], dest[0], dest[1], wantsEta)
      .then((leg) => {
        if (routeFetchSeq.current !== seq) return
        setRoutePoints(leg.polyline)
        setEta(wantsEta ? { etaMin: leg.etaMin, distanceKm: leg.distanceKm } : null)
      })
      .catch(() => {
        if (routeFetchSeq.current === seq) { setRoutePoints([]); setEta(null) }
      })
  }, [routeMode, driverPos, ride, hasDest])

  const pickup = useMemo<[number, number]>(() => (ride ? [ride.originLat, ride.originLng] : [0, 0]), [ride])
  const drop = useMemo<[number, number] | null>(() => (hasDest ? [ride!.destLat!, ride!.destLng!] : null), [ride, hasDest])

  return {
    ride,
    loading,
    loadError,
    socketConnected,
    driverCancelled,
    lastLocationAt,
    markerLat,
    markerLng,
    markerHeading,
    driverPos,
    pickup,
    drop,
    routePoints,
    eta,
    unreadChatCount,
    fareDrift,
    dismissFareDrift: () => setFareDrift(null),
    upgradeCategory,
    retry: loadRide,
  }
}
