import { useCallback, useEffect, useState } from 'react'
import { useDriverSessionStore } from '@/store/useDriverSessionStore'
import { connectSocket, disconnectSocket } from '@/services/socket'
import { stopBackgroundTracking } from '@/services/location/backgroundTask'
import { fetchVerificationStatus } from '@/features/verification/api'
import { fetchCurrentSession, fetchMyVehicle, goOffline as apiGoOffline } from './api'
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
  requestGoOnline: () => Promise<'/daily-verification' | '/go-online/mode'>
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
  const setOnline = useDriverSessionStore((s) => s.setOnline)
  const setOffline = useDriverSessionStore((s) => s.setOffline)

  const [sessionCheck, setSessionCheck] = useState<SessionCheckState>('checking')
  const [vehicle, setVehicle] = useState<VehicleInfo | null>(null)
  const [vehicleLoading, setVehicleLoading] = useState(true)
  const [checkingVerification, setCheckingVerification] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMyVehicle()
      .then(setVehicle)
      .catch(() => setError('Could not load vehicle info'))
      .finally(() => setVehicleLoading(false))
  }, [])

  const checkSession = useCallback(() => {
    setSessionCheck('checking')
    fetchCurrentSession()
      .then((session) => {
        if (session) {
          setOnline({ id: session.id, vehicleId: session.vehicleId, categoryId: session.categoryId, mode: session.mode })
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

  const requestGoOnline = useCallback(async (): Promise<'/daily-verification' | '/go-online/mode'> => {
    setError(null)
    if (checkingVerification) return '/go-online/mode' // ignore a stray double-tap
    setCheckingVerification(true)
    try {
      const status = await fetchVerificationStatus()
      return status.complete ? '/go-online/mode' : '/daily-verification'
    } catch {
      // Status check failed -- don't block going online on a network hiccup;
      // the confirm screen's own goOnline() call still enforces server-side.
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
