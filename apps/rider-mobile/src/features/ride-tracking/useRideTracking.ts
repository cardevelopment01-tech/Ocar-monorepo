import { useCallback, useEffect, useRef, useState } from 'react'
import { useSharedValue } from 'react-native-reanimated'
import { useRoomJoin } from '@ocar/mobile-shared'
import { socket } from '@/services/socket'
import { fetchRide } from './api'
import type { DriverCancelInfo, RideDetailExtra } from './types'

type DriverLocationTick = { lat: number; lng: number; heading?: number; speed_kmph?: number }
type StatusUpdatePayload = { status?: string; cancelledBy?: string; reasonCode?: string | null }

export function useRideTracking(rideId: string) {
  const [ride, setRide] = useState<RideDetailExtra | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [socketConnected, setSocketConnected] = useState(socket.connected)
  const [driverCancelled, setDriverCancelled] = useState<DriverCancelInfo | null>(null)
  const [lastLocationAt, setLastLocationAt] = useState<number | null>(null)

  // Ref-driven, not state-driven: the driver dot's position updates directly on each
  // socket tick via these shared values, so a fast GPS stream never triggers a React
  // re-render (matches the plan's binding convention, same pattern as driver-mobile's
  // location work).
  const markerLat = useSharedValue(0)
  const markerLng = useSharedValue(0)
  const markerHeading = useSharedValue(0)
  const hasMarkerFix = useRef(false)

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

  // Joins ride:{rideId} on mount and on every socket 'connect' (including
  // reconnect-after-background); onRejoined pulls a fresh GET /rides/:id snapshot each
  // time, since a bare reconnect doesn't replay whatever status changed while
  // disconnected -- closes the backgrounded-app state gap named in the plan's Eng review.
  useRoomJoin(socket, rideId, loadRide)

  useEffect(() => {
    function onStatusUpdate(payload: StatusUpdatePayload) {
      if (payload.status === 'cancelled' && payload.cancelledBy === 'driver') {
        // Confirmed against rides.service.ts's cancelRideAsDriver: a driver cancel
        // unconditionally sets the ride to 'cancelled' (terminal, no re-broadcast to
        // searching) -- so this ends the booking outright, it does not loop back to
        // "searching for driver".
        setDriverCancelled({ reasonCode: payload.reasonCode ?? null })
      }
      loadRide()
    }

    function onDriverLocation(payload: DriverLocationTick) {
      hasMarkerFix.current = true
      markerLat.value = payload.lat
      markerLng.value = payload.lng
      markerHeading.value = payload.heading ?? 0
      setLastLocationAt(Date.now())
    }

    function onDriverAssigned() {
      loadRide()
    }

    function onConnect() { setSocketConnected(true) }
    function onDisconnect() { setSocketConnected(false) }

    socket.on('ride:status_update', onStatusUpdate)
    socket.on('driver:location', onDriverLocation)
    socket.on('ride:driver_assigned', onDriverAssigned)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    setSocketConnected(socket.connected)

    return () => {
      socket.off('ride:status_update', onStatusUpdate)
      socket.off('driver:location', onDriverLocation)
      socket.off('ride:driver_assigned', onDriverAssigned)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [loadRide, markerLat, markerLng, markerHeading])

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
    retry: loadRide,
  }
}
