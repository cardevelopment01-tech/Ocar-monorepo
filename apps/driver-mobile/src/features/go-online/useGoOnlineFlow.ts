import { useCallback, useEffect, useState } from 'react'
import * as Location from 'expo-location'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { connectSocket, disconnectSocket } from '@/services/socket'
import { startBackgroundTracking, stopBackgroundTracking } from '@/services/location/backgroundTask'
import { fetchCurrentSession, fetchMyVehicle, goOffline as apiGoOffline, goOnline as apiGoOnline } from './api'
import { canTapGoOnline, type SessionCheckState } from './sessionRestoreGuard'
import type { VehicleInfo } from './types'

export type GoOnlineFlowState = {
  sessionCheck: SessionCheckState
  vehicle: VehicleInfo | null
  vehicleLoading: boolean
  goingOnline: boolean
  showDisclosure: boolean
  error: string | null
  canGoOnline: boolean
  retrySessionCheck: () => void
  requestGoOnline: () => void
  handleDisclosureAccept: () => Promise<void>
  handleDisclosureDecline: () => void
  goOffline: () => Promise<void>
}

// Orchestrates the full go-online sequence: restore session state on mount (so a
// relaunch while already online doesn't show a stale "offline" toggle), then on a
// fresh tap: foreground permission -> disclosure -> background permission -> the
// real POST /sessions/online call -> start tracking + connect the socket.
export function useGoOnlineFlow(): GoOnlineFlowState {
  const isOnline = useDriverSessionStore((s) => s.isOnline)
  const setOnline = useDriverSessionStore((s) => s.setOnline)
  const setOffline = useDriverSessionStore((s) => s.setOffline)

  const [sessionCheck, setSessionCheck] = useState<SessionCheckState>('checking')
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null)
  const [vehicleLoading, setVehicleLoading] = useState(true)
  const [goingOnline, setGoingOnline] = useState(false)
  const [showDisclosure, setShowDisclosure] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMyVehicle()
      .then(setVehicle)
      .catch(() => setError('Could not load vehicle info'))
      .finally(() => setVehicleLoading(false))
  }, [])

  // Restore an already-online session on relaunch (GET /sessions/current is the
  // source of truth, per the CEO review decision -- never re-derive from local
  // storage). A failure here must block with a visible retry, not silently
  // resolve as "offline" (Eng review HIGH-severity finding on this exact check).
  const checkSession = useCallback(() => {
    setSessionCheck('checking')
    fetchCurrentSession()
      .then((session) => {
        if (session) {
          setOnline({ id: session.id, vehicleId: session.vehicleId, categoryId: session.categoryId })
          connectSocket()
        }
        setSessionCheck('ready')
      })
      .catch(() => setSessionCheck('failed'))
  }, [setOnline])

  useEffect(() => {
    checkSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount only
  }, [])

  const requestGoOnline = useCallback(() => {
    setError(null)
    Location.requestForegroundPermissionsAsync()
      .then(({ status }) => {
        if (status !== 'granted') {
          setError('Location permission is required to go online.')
          return
        }
        setShowDisclosure(true)
      })
      .catch(() => setError('Could not request location permission.'))
  }, [])

  const handleDisclosureAccept = useCallback(async () => {
    setShowDisclosure(false)
    if (!vehicle) {
      setError('No active vehicle found. Add one in your profile.')
      return
    }
    setGoingOnline(true)
    setError(null)
    try {
      const { status } = await Location.requestBackgroundPermissionsAsync()
      if (status !== 'granted') {
        setError('Background location is required to receive ride requests while online.')
        return
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const session = await apiGoOnline({
        vehicleId: vehicle.id,
        categoryId: vehicle.categoryId,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      })
      setOnline({ id: session.id, vehicleId: session.vehicleId, categoryId: session.categoryId })
      await startBackgroundTracking()
      connectSocket()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to go online. Please try again.')
    } finally {
      setGoingOnline(false)
    }
  }, [vehicle, setOnline])

  const handleDisclosureDecline = useCallback(() => {
    setShowDisclosure(false)
  }, [])

  const goOffline = useCallback(async () => {
    try {
      await apiGoOffline()
    } finally {
      await stopBackgroundTracking()
      disconnectSocket()
      setOffline()
    }
  }, [setOffline])

  return {
    sessionCheck,
    vehicle,
    vehicleLoading,
    goingOnline,
    showDisclosure,
    error,
    canGoOnline: canTapGoOnline(sessionCheck, isOnline, goingOnline),
    retrySessionCheck: checkSession,
    requestGoOnline,
    handleDisclosureAccept,
    handleDisclosureDecline,
    goOffline,
  }
}
