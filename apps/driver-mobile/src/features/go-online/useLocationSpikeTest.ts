import { useCallback, useEffect, useState } from 'react'
import * as Location from 'expo-location'
import {
  clearLoggedFixes,
  getLoggedFixes,
  startBackgroundTracking,
  stopBackgroundTracking,
} from '@/services/location/backgroundTask'

export type SpikeStatus = 'idle' | 'tracking' | 'foreground_denied' | 'background_denied' | 'error'

export function useLocationSpikeTest() {
  const [status, setStatus] = useState<SpikeStatus>('idle')
  const [showDisclosure, setShowDisclosure] = useState(false)
  const [fixCount, setFixCount] = useState(0)
  const [lastFixAt, setLastFixAt] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const refreshFixes = useCallback(async () => {
    const fixes = await getLoggedFixes()
    setFixCount(fixes.length)
    setLastFixAt(fixes.length > 0 ? fixes[fixes.length - 1]!.timestamp : null)
  }, [])

  useEffect(() => {
    refreshFixes()
    const interval = setInterval(refreshFixes, 5000)
    return () => clearInterval(interval)
  }, [refreshFixes])

  const requestForeground = useCallback(async () => {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync()
    if (fgStatus !== 'granted') {
      setStatus('foreground_denied')
      return
    }
    // Foreground and background can't be requested in one prompt on Android 10+ --
    // the disclosure must precede the background dialog specifically, not this one.
    setShowDisclosure(true)
  }, [])

  const handleDisclosureAccept = useCallback(async () => {
    setShowDisclosure(false)
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync()
    if (bgStatus !== 'granted') {
      setStatus('background_denied')
      return
    }
    try {
      await startBackgroundTracking()
      setStatus('tracking')
      setErrorMessage(null)
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start tracking')
    }
  }, [])

  const handleDisclosureDecline = useCallback(() => {
    setShowDisclosure(false)
    setStatus('background_denied')
  }, [])

  const stop = useCallback(async () => {
    await stopBackgroundTracking()
    setStatus('idle')
  }, [])

  const clearLog = useCallback(async () => {
    await clearLoggedFixes()
    await refreshFixes()
  }, [refreshFixes])

  return {
    status,
    showDisclosure,
    fixCount,
    lastFixAt,
    errorMessage,
    requestForeground,
    handleDisclosureAccept,
    handleDisclosureDecline,
    stop,
    clearLog,
  }
}
