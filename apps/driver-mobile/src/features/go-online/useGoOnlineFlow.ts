import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { getApiErrorMessage, maybeRequestReview } from '@ocar/mobile-shared'
import { fetchDriverStats } from '@/features/profile/api'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { disconnectSocket } from '@/services/socket'
import { stopBackgroundTracking } from '@/services/location/backgroundTask'
import { fetchVerificationStatus } from '@/features/verification/api'
import { fetchMyVehicle, goOffline as apiGoOffline } from './api'
import { resyncSessionFromServer } from './useSessionResync'
import { canTapGoOnline, type SessionCheckState } from './sessionRestoreGuard'
import type { VehicleInfo } from './types'

export type GoOnlineFlowState = {
  sessionCheck: SessionCheckState
  vehicle: VehicleInfo | null
  vehicleLoading: boolean
  checkingVerification: boolean
  error: string | null
  canGoOnline: boolean
  retrySessionCheck: () => void
  requestGoOnline: () => Promise<'/daily-verification' | '/go-online/mode' | null>
  goOffline: () => Promise<void>
}

// Restores session state on mount (so a relaunch while already online doesn't
// show a stale "offline" toggle), and resolves where a fresh tap on the toggle
// should navigate: /daily-verification when today's selfie+plate photo aren't
// both in yet (mirrors web's Home.tsx handleToggle -> driverVerificationApi.
// getStatus()), otherwise straight to /go-online/mode. The actual go-online
// API call now lives in the mode/standard and mode/return-cab confirm screens
// (useConfirmGoOnline), matching how web splits ModeSelection from
// StandardConfirm/ReturnCabSetup.
export function useGoOnlineFlow(): GoOnlineFlowState {
  const isOnline = useDriverSessionStore((s) => s.isOnline)
  const setOffline = useDriverSessionStore((s) => s.setOffline)

  const [sessionCheck, setSessionCheck] = useState<SessionCheckState>('checking')
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null)
  const [vehicleLoading, setVehicleLoading] = useState(true)
  const [checkingVerification, setCheckingVerification] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMyVehicle()
      .then(setVehicle)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load vehicle info')))
      .finally(() => setVehicleLoading(false))
  }, [])

  // Adopts the server's view in BOTH directions. This used to only ever set "online" when the server had a
  // session, so a session the server had already ended (stale-heartbeat sweep) left the toggle on "Online".
  const checkSession = useCallback(() => {
    setSessionCheck('checking')
    resyncSessionFromServer()
      .then(() => setSessionCheck('ready'))
      .catch(() => setSessionCheck('failed'))
  }, [])

  useEffect(() => {
    checkSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount only
  }, [])

  const requestGoOnline = useCallback(async (): Promise<'/daily-verification' | '/go-online/mode' | null> => {
    setError(null)
    if (checkingVerification) return '/go-online/mode' // ignore a stray double-tap
    setCheckingVerification(true)
    try {
      const status = await fetchVerificationStatus()
      return status.complete ? '/go-online/mode' : '/daily-verification'
    } catch (err) {
      // The server refused (e.g. account not approved, suspended): say why and
      // stay put instead of walking the driver into a screen that will fail too.
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      if (status !== undefined && status < 500) {
        setError(getApiErrorMessage(err))
        return null
      }
      // Network hiccup / 5xx -- don't block going online; the confirm screen's
      // own goOnline() call still enforces server-side.
      return '/go-online/mode'
    } finally {
      setCheckingVerification(false)
    }
  }, [checkingVerification])

  const goOffline = useCallback(async () => {
    try {
      await apiGoOffline()
    } finally {
      await stopBackgroundTracking()
      disconnectSocket()
      setOffline()
    }
    // Natural pause: the shift is over. Only reached when the server accepted going offline.
    void maybeRequestReview({ role: 'driver', delayMs: 1500, getLifetimeRides: async () => (await fetchDriverStats()).stats.total_rides })
  }, [setOffline])

  return {
    sessionCheck,
    vehicle,
    vehicleLoading,
    checkingVerification,
    error,
    canGoOnline: canTapGoOnline(sessionCheck, isOnline, checkingVerification),
    retrySessionCheck: checkSession,
    requestGoOnline,
    goOffline,
  }
}
