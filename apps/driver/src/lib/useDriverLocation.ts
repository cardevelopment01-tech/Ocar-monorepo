import { useState, useEffect, useRef } from 'react'
import { bearingDeg, haversineMetres } from './geo'

// Below this movement, raw device heading is too noisy to trust (device sensor
// jitter dominates at near-zero speed) — reject the fix and keep the last known
// heading instead, same threshold the rider app's useInterpolatedPosition.ts uses.
const HEADING_MOVEMENT_THRESHOLD_METRES = 8

export interface DriverLocationState {
  position: [number, number] | null
  heading:  number
  error:    GeolocationPositionError | null
}

interface UseDriverLocationOptions {
  highAccuracy?:   boolean
  /** Drop any fix whose accuracy radius (metres) exceeds this. Default 80 m. */
  maxAccuracyM?:   number
  onSync?:         (lat: number, lng: number, heading: number) => void
  syncIntervalMs?: number
}

/**
 * Continuous GPS tracking via watchPosition.
 * - Updates position/heading on every device fix (typically 1–5 s).
 * - Calls onSync at most once per syncIntervalMs for backend API updates.
 * - Restarts the watch when the tab becomes visible again after backgrounding.
 * - onSync is captured in a ref, so callers can pass inline functions safely.
 */
export function useDriverLocation({
  highAccuracy   = false,
  maxAccuracyM   = 80,
  onSync,
  syncIntervalMs = 30_000,
}: UseDriverLocationOptions = {}): DriverLocationState {
  const [position, setPosition] = useState<[number, number] | null>(null)
  const [heading,  setHeading]  = useState(0)
  const [error,    setError]    = useState<GeolocationPositionError | null>(null)

  const lastSyncAt  = useRef(0)
  const onSyncRef   = useRef(onSync)
  const hasFirstFix = useRef(false)
  const lastHeadingPos = useRef<[number, number] | null>(null)
  const lastHeadingVal = useRef(0)
  onSyncRef.current = onSync

  useEffect(() => {
    let watchId: number

    const handlePosition = (pos: GeolocationPosition) => {
      // Always accept the first fix so position never stays null permanently
      // (browser/WiFi accuracy is often 100–2000 m, which would fail the 80 m
      // gate and leave the driver with no visible car marker at all).
      // After the first fix, discard noisy cell-tower-only updates.
      const passesAccuracyGate = pos.coords.accuracy <= maxAccuracyM
      if (hasFirstFix.current && !passesAccuracyGate) return
      hasFirstFix.current = true
      const lat = pos.coords.latitude
      const lng = pos.coords.longitude
      setPosition([lat, lng])

      // Raw device coords.heading is noisy at near-zero speed (compass jitter),
      // which is what caused the map/marker heading twitch — derive heading from
      // movement between fixes instead, same fix already applied on the rider
      // side (see apps/user/lib/useInterpolatedPosition.ts). Below the movement
      // threshold, keep the last known heading rather than recomputing from noise.
      const prevHeadingPos = lastHeadingPos.current
      if (prevHeadingPos) {
        const dist = haversineMetres(prevHeadingPos, [lat, lng])
        if (dist > HEADING_MOVEMENT_THRESHOLD_METRES) {
          lastHeadingVal.current = bearingDeg(prevHeadingPos, [lat, lng])
          lastHeadingPos.current = [lat, lng]
          setHeading(lastHeadingVal.current)
        }
      } else {
        lastHeadingPos.current = [lat, lng]
        if (pos.coords.heading != null) {
          lastHeadingVal.current = pos.coords.heading
          setHeading(lastHeadingVal.current)
        }
      }
      setError(null)

      // A bad first fix still updates the local display above (better than a
      // stuck blank marker), but must never be uploaded to the backend — it
      // drives dispatch matching and the admin/user-facing live map.
      const now = Date.now()
      if (onSyncRef.current && passesAccuracyGate && now - lastSyncAt.current >= syncIntervalMs) {
        lastSyncAt.current = now
        onSyncRef.current(lat, lng, lastHeadingVal.current)
      }
    }

    const handleError = (err: GeolocationPositionError) => setError(err)

    const startWatch = () => {
      watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
        enableHighAccuracy: highAccuracy,
        timeout:     10_000,
        maximumAge:  3_000,
      })
    }

    startWatch()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        navigator.geolocation.clearWatch(watchId)
        startWatch()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      navigator.geolocation.clearWatch(watchId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [highAccuracy, maxAccuracyM, syncIntervalMs])

  return { position, heading, error }
}
