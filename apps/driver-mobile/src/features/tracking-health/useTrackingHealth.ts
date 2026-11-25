import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as Location from 'expo-location'
import { isCurrentlyTracking } from '@/services/location/backgroundTask'
import { useDriverPositionStore } from '@/services/location/driverPositionStore'
import { assessTracking, NEEDS_CONFIRMATION, type TrackingIssue } from './trackingHealth'

const CHECK_EVERY_MS = 10_000
const RECOVERED_SHOWN_MS = 2_500

export type TrackingHealth = {
  /** What is wrong right now and has been confirmed; null when location is flowing. */
  issue: TrackingIssue | null
  /** True for a moment after an issue clears, so the driver sees it was fixed. */
  recovered: boolean
  /** Check again now (after the driver comes back from Settings, or taps Restart). */
  recheck: () => void
}

/** While the driver is online, watches whether the phone is really reporting their location, and says why not. Runs only while the app is
 *  open (a background JS timer is not reliable): while it is closed, the server's own silence check and its "You're paused" push cover it.
 *  `startFailed` is the go-online flow's own report that tracking did not start; it counts as "not running" at once. */
export function useTrackingHealth(isOnline: boolean, startFailed: boolean): TrackingHealth {
  const [issue, setIssue] = useState<TrackingIssue | null>(null)
  const [recovered, setRecovered] = useState(false)
  const onlineSince = useRef(Date.now())
  const pending = useRef<TrackingIssue | null>(null)
  const shown = useRef<TrackingIssue | null>(null)
  const recoveredTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startFailedRef = useRef(startFailed)
  startFailedRef.current = startFailed

  const checking = useRef(false)
  const live = useRef(false)

  const check = useCallback(async () => {
    // One read at a time: two overlapping reads (mount, AppState, the timer) must not count as "two checks in a row".
    if (checking.current) return
    checking.current = true
    try {
      const [fg, bg, services, running] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
        Location.hasServicesEnabledAsync(),
        isCurrentlyTracking(),
      ])
      // A fix from before this online session says nothing about now (the store keeps the last one across sessions).
      const stored = useDriverPositionStore.getState().lastUpdatedAt
      const lastAt = stored != null && stored >= onlineSince.current ? stored : null
      // A failed start is usually a permission or the phone's Location switch: name that cause first, and fall back to "not running" (Restart)
      // only when nothing more specific is wrong.
      const assessed = assessTracking({
        foregroundGranted: fg.granted, backgroundGranted: bg.granted, servicesEnabled: services, taskRunning: running,
        lastFixAgeMs: lastAt == null ? null : Date.now() - lastAt, sinceOnlineMs: Date.now() - onlineSince.current,
      })
      const found: TrackingIssue | null = assessed ?? (startFailedRef.current ? 'not_running' : null)
      // A soft issue must be seen twice in a row; a hard one (permission, the phone's switch, a failed start) shows at once.
      if (!live.current) return // the driver went offline while this read was in flight
      const confirmed = found === null || !NEEDS_CONFIRMATION.has(found) || startFailedRef.current || pending.current === found
      pending.current = found
      if (!confirmed) return
      if (found === null && shown.current !== null) {
        setRecovered(true)
        if (recoveredTimer.current) clearTimeout(recoveredTimer.current)
        recoveredTimer.current = setTimeout(() => setRecovered(false), RECOVERED_SHOWN_MS)
      } else if (found !== null) {
        setRecovered(false)
      }
      shown.current = found
      setIssue(found)
    } catch {
      // A failed read says nothing about the driver's location: keep what is shown.
    } finally {
      checking.current = false
    }
  }, [])

  useEffect(() => {
    live.current = isOnline
    if (!isOnline) {
      pending.current = null
      shown.current = null
      setIssue(null)
      setRecovered(false)
      return
    }
    onlineSince.current = Date.now()
    const timer = setInterval(() => { if (AppState.currentState === 'active') void check() }, CHECK_EVERY_MS)
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void check() })
    return () => {
      clearInterval(timer)
      sub.remove()
      if (recoveredTimer.current) clearTimeout(recoveredTimer.current)
    }
  }, [isOnline, check])

  // The first read on going online, and again whenever a start failure is reported or cleared, without waiting for the next tick.
  useEffect(() => { if (isOnline) void check() }, [startFailed, isOnline, check])

  return { issue, recovered, recheck: () => { void check() } }
}
