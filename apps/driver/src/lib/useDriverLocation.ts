import { useState, useEffect, useRef } from 'react'

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
  onSyncRef.current = onSync

  useEffect(() => {
    let watchId: number

    const handlePosition = (pos: GeolocationPosition) => {
      // Discard fixes that are too imprecise to be useful (e.g. cell-tower only).
      if (pos.coords.accuracy > maxAccuracyM) return
      const lat = pos.coords.latitude
      const lng = pos.coords.longitude
      setPosition([lat, lng])
      if (pos.coords.heading != null) setHeading(pos.coords.heading)
      setError(null)

      const now = Date.now()
      if (onSyncRef.current && now - lastSyncAt.current >= syncIntervalMs) {
        lastSyncAt.current = now
        const hdg = pos.coords.heading
        onSyncRef.current(lat, lng, (hdg == null || isNaN(hdg)) ? 0 : hdg)
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
